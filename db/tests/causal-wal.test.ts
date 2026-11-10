/**
 * 🦀 Synapse-DB Causal-WAL (링 버퍼 · 아레나 · 시계열 Time-Travel · SQLite WAL 복구) 심층 검증 스위트
 * 1. Zero-GC 순환 링 버퍼 고정 용량 덮어쓰기(FIFO) 및 O(1) LSN 탐색 검증
 * 2. Bump 아레나 트랜잭션 원자적 커밋 및 예외 발생 시 0ns 무오염 롤백 검증
 * 3. LSN 및 타임스탬프 기반 시점 복원(asOf / asOfLsn)과 위키링크 대칭 불변식 검증
 * 4. SQLite WAL (journal_mode=WAL + mmap) 크래시 시뮬레이션 및 100% 무손실 복구 검증
 * 5. 컴파일러 시계열 메트릭 연동 및 대량 트랜잭션 초저지연 벤치마크
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { SynapseDB, TemporalRingBuffer, CausalWalEventType } from "../index";

const TEST_WAL_VAULT = resolve(import.meta.dir, ".test_causal_wal_vault");

function safeCleanDir(dirPath: string): void {
  try {
    if (existsSync(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {
    // Windows SQLite EBUSY 잠금 지연 방어 (Graveyard 불변 규칙 준수)
  }
}

describe("🦀 Synapse Causal-WAL (러스트 메모리 방식 + 시계열 + SQLite WAL) 종합 검증", () => {
  beforeEach(() => {
    safeCleanDir(TEST_WAL_VAULT);
  });

  afterEach(() => {
    safeCleanDir(TEST_WAL_VAULT);
  });

  it("1. [Zero-GC 순환 링 버퍼] 고정 용량 초과 시 메모리 팽창 없이 FIFO 덮어쓰기 및 O(1) LSN 조회", () => {
    const capacity = 32;
    const ring = new TemporalRingBuffer(capacity);

    // 용량(32)의 3배인 96개 엔트리를 연속 주입
    for (let i = 1; i <= 96; i++) {
      ring.append({
        eventType: CausalWalEventType.DOC_UPSERT,
        collection: "metrics",
        docId: `doc_${i}`,
        prevDoc: null,
        nextDoc: null,
        edgesAdded: [],
        edgesRemoved: [],
      });
    }

    const stats = ring.getStats();
    expect(stats.capacity).toBe(32);
    expect(stats.size).toBe(32); // 절대 32개를 초과하지 않음 (Memory Ceiling 고정)
    expect(stats.currentLsn).toBe(96);
    expect(stats.oldestLsn).toBe(65); // 1~64번은 자연 덮어쓰기(Drop)됨
    expect(stats.overwrittenCount).toBe(64);
    expect(stats.utilizationRatio).toBe(1);

    // 이미 덮어써진 과거 LSN(10)은 null 반환
    expect(ring.getByLsn(10)).toBeNull();

    // 살아있는 슬롯 LSN(70, 96)은 O(1) 오프셋 계산으로 정확히 반환
    const entry70 = ring.getByLsn(70);
    expect(entry70).not.toBeNull();
    expect(entry70?.docId).toBe("doc_70");

    const entry96 = ring.getByLsn(96);
    expect(entry96?.docId).toBe("doc_96");
  });

  it("2. [Bump 아레나 트랜잭션] 원자적 일괄 커밋 및 예외 발생 시 0ns 무오염 롤백 보장", async () => {
    const db = new SynapseDB({
      vaultDir: TEST_WAL_VAULT,
      autoWatch: false,
      wal: { ringCapacity: 128, arenaCapacity: 16 },
    });
    await db.init();

    const notes = db.collection<{ title: string; step: number }>("notes");

    // 초기 기준 문서 1건 저장
    await notes.save({
      id: "base_note",
      data: { title: "초기 문서", step: 1 },
      body: "기초 상태입니다.",
    });

    const lsnBeforeFail = db.walStats().ringBuffer.currentLsn;
    expect(lsnBeforeFail).toBe(1);

    // [실패 시나리오] 트랜잭션 도중 3건 저장 후 의도적 예외 발생 ➔ 완벽 롤백 검증
    let caughtError = false;
    try {
      await db.transaction(async () => {
        await notes.save({
          id: "tx_doc_1",
          data: { title: "트랜잭션 문서 1", step: 2 },
          body: "[[notes/base_note]] 연결 시도",
        });
        await notes.save({
          id: "base_note",
          data: { title: "변조된 초기 문서", step: 99 },
          body: "이 내용은 롤백되어야 합니다.",
        });
        throw new Error("의도적 트랜잭션 중단 (Simulated Panic)");
      });
    } catch {
      caughtError = true;
    }

    expect(caughtError).toBe(true);

    // 롤백 후 커넥톰 및 링 버퍼 오염 0건 확인
    expect(notes.get("tx_doc_1")).toBeNull();
    expect(notes.get("base_note")?.data.title).toBe("초기 문서");
    expect(notes.get("base_note")?.data.step).toBe(1);
    expect(db.walStats().ringBuffer.currentLsn).toBe(1);
    expect(db.walStats().arena.totalTransactionsRolledBack).toBe(1);
    expect(db.walStats().arena.activeCursor).toBe(0);

    // [성공 시나리오] 정상 트랜잭션 수행 시 일괄 커밋 및 아레나 슬롯 재사용 검증
    await db.transaction(async () => {
      await notes.save({
        id: "tx_doc_1",
        data: { title: "정상 커밋 문서 1", step: 2 },
        body: "참조: [[notes/base_note]]",
      });
      await notes.save({
        id: "tx_doc_2",
        data: { title: "정상 커밋 문서 2", step: 3 },
        body: "참조: [[notes/tx_doc_1]]",
      });
    });

    expect(notes.get("tx_doc_1")?.data.title).toBe("정상 커밋 문서 1");
    expect(notes.get("tx_doc_2")?.data.title).toBe("정상 커밋 문서 2");
    expect(db.walStats().ringBuffer.currentLsn).toBe(3);
    expect(db.walStats().arena.totalSlotReuses).toBeGreaterThan(0);

    db.close();
  });

  it("3. [시계열 Time-Travel (asOfLsn / asOf)] 과거 시점의 커넥톰·위키링크·검색 역색인 무손실 복원", async () => {
    const db = new SynapseDB({
      vaultDir: TEST_WAL_VAULT,
      autoWatch: false,
      wal: { ringCapacity: 256 },
    });
    await db.init();

    const docs = db.collection<{ version: string }>("docs");

    // LSN 1: core 문서 생성
    await docs.save({
      id: "core",
      data: { version: "1.0" },
      body: "# 코어 엔진 v1.0 초기 설계",
    });

    // LSN 2: app 문서가 core를 위키링크로 참조
    await docs.save({
      id: "app",
      data: { version: "1.0" },
      body: "앱은 [[docs/core]] 모듈에 의존합니다.",
    });
    const lsnAtV1 = db.walStats().ringBuffer.currentLsn; // LSN = 2

    // LSN 3: core 문서가 v2.0으로 수정됨
    await docs.save({
      id: "core",
      data: { version: "2.0" },
      body: "# 코어 엔진 v2.0 아레나 메모리 개편",
    });

    // LSN 4: app 문서가 core 링크를 끊고 plugin을 참조하도록 변경
    await docs.save({
      id: "app",
      data: { version: "2.0" },
      body: "앱은 이제 [[docs/plugin]] 모듈만 참조합니다.",
    });

    // LSN 5: core 문서 삭제
    await docs.delete("core");
    const lsnAtLatest = db.walStats().ringBuffer.currentLsn; // LSN = 5

    // 현재 시점(LSN 5) 확인: core는 삭제되어 없음
    expect(docs.get("core")).toBeNull();
    expect(docs.get("app")?.data.version).toBe("2.0");

    // ⏪ LSN 2 시점으로 시간 여행 (Time-Travel asOfLsn(2))
    const snapshotV1 = db.asOfLsn(lsnAtV1);

    // 1) 삭제되었던 core 문서가 v1.0 상태로 완벽히 살아있음
    const restoredCore = snapshotV1.getDocument<{ version: string }>("docs", "core");
    expect(restoredCore).not.toBeNull();
    expect(restoredCore?.data.version).toBe("1.0");
    expect(restoredCore?.body).toContain("초기 설계");

    // 2) LSN 2 당시의 위키링크 시냅스(app -> core)가 양방향 모두 정확히 복원됨
    const incomingToCoreAtV1 = snapshotV1.getIncomingDocuments("docs", "core");
    expect(incomingToCoreAtV1.length).toBe(1);
    expect(incomingToCoreAtV1[0].id).toBe("app");

    // 3) 복원된 스냅샷의 그래프 대칭 불변식 무결성 100% 보장
    const invariantCheck = snapshotV1.verifyGraphInvariants();
    expect(invariantCheck.ok).toBe(true);

    // 4) 복원된 스냅샷에서 한국어 BM25 전문 검색도 정상 작동
    const searchAtV1 = snapshotV1.search("초기 설계");
    expect(searchAtV1.length).toBe(1);
    expect(searchAtV1[0].document.id).toBe("core");

    // 5) LSN 2 ~ LSN 5 구간의 시계열 Diff 검증
    const diff = db.diffBetweenLsn(lsnAtV1, lsnAtLatest);
    expect(diff.deletedDocuments).toContain("docs/core");
    expect(diff.modifiedDocuments).toContain("docs/app");
    expect(diff.edgesLinked).toContain("docs/app->docs/plugin");
    expect(diff.edgesUnlinked).toContain("docs/app->docs/core");

    db.close();
  });

  it("4. [SQLite WAL + mmap 영속화 & 크래시 복구] 마크다운 디스크 플러시 전 강제 종료 시 100% 무손실 복구", async () => {
    const sqliteWalPath = join(TEST_WAL_VAULT, ".synapse_wal", "crash_test.sqlite");

    // 1단계: 디스크 마크다운 쓰기 디바운스를 60초(60,000ms)로 길게 설정하여
    // 마크다운 파일이 디스크에 쓰이기 전에 크래시가 발생하는 상황 시뮬레이션
    const db1 = new SynapseDB({
      vaultDir: TEST_WAL_VAULT,
      autoWatch: false,
      persistDebounceMs: 60000,
      wal: {
        persistSqlite: true,
        sqlitePath: sqliteWalPath,
        syncMode: "NORMAL",
      },
    });
    await db1.init();

    const rules = db1.collection<{ priority: number }>("rules");
    await rules.save({
      id: "rule_alpha",
      data: { priority: 1 },
      body: "인과율 제1법칙: [[rules/rule_beta]]와 공명한다.",
    });
    await rules.save({
      id: "rule_beta",
      data: { priority: 2 },
      body: "인과율 제2법칙: 제로-GC 아레나 수명을 준수한다.",
    });

    // 컴파일러 시계열 메트릭도 1건 기록
    db1.recordCompilerMetric({
      targetFile: "src/wal/ringBuffer.ts",
      language: "typescript",
      durationMs: 4.2,
      binarySizeBytes: 28440,
      symbolCount: 12,
      success: true,
    });

    const walStats1 = db1.walStats();
    expect(walStats1.sqlite.enabled).toBe(true);
    expect(walStats1.sqlite.journalMode.toLowerCase()).toBe("wal");
    expect(walStats1.sqlite.persistedCount).toBe(3);

    // 💥 [크래시 시뮬레이션] 마크다운 파일 플러시(flushPendingWrites)를 건너뛰고 SQLite 핸들만 닫음
    if ((db1.engine as any).writeTimer) {
      clearTimeout((db1.engine as any).writeTimer);
      (db1.engine as any).writeTimer = null;
    }
    (db1.engine as any).pendingWriteQueue.clear();
    db1.engine.wal.close();

    // 디스크에 .md 파일이 전혀 생성되지 않았음을 확인 (실제 전원 차단/강제 종료와 동일한 상태)
    const mdPathAlpha = join(TEST_WAL_VAULT, "rules", "rule_alpha.md");
    expect(existsSync(mdPathAlpha)).toBe(false);

    // 2단계: 신규 DB 인스턴스 재기동 ➔ SQLite Causal-WAL 자동 리플레이를 통한 100% 무손실 복구 검증
    const db2 = new SynapseDB({
      vaultDir: TEST_WAL_VAULT,
      autoWatch: false,
      wal: {
        persistSqlite: true,
        sqlitePath: sqliteWalPath,
      },
    });
    await db2.init();

    const recoveredRules = db2.collection<{ priority: number }>("rules");
    expect(recoveredRules.count()).toBe(2);
    expect(recoveredRules.get("rule_alpha")?.data.priority).toBe(1);
    expect(recoveredRules.get("rule_beta")?.data.priority).toBe(2);

    // 위키링크 양방향 간선까지 완벽히 복구되었는지 검증
    const incomingToBeta = recoveredRules.synapses("rule_beta").incoming();
    expect(incomingToBeta.length).toBe(1);
    expect(incomingToBeta[0].id).toBe("rule_alpha");

    // 링 버퍼의 LSN 및 컴파일러 메트릭도 복구되었는지 확인
    expect(db2.walStats().ringBuffer.currentLsn).toBe(3);
    const fullDiff = db2.diffBetweenLsn(0, 3);
    expect(fullDiff.compilerMetrics.length).toBe(1);
    expect(fullDiff.compilerMetrics[0].targetFile).toBe("src/wal/ringBuffer.ts");

    db2.close();
  });

  it("5. [고성능 벤치마크] 2,000회 연속 WAL 기록 + 아레나 리셋 평균 지연시간 < 0.05ms 검증", async () => {
    const db = new SynapseDB({
      vaultDir: TEST_WAL_VAULT,
      autoWatch: false,
      persistDebounceMs: 60000,
      wal: { ringCapacity: 2048, arenaCapacity: 64 },
    });
    await db.init();

    const benchCol = db.collection<{ idx: number }>("bench");
    const iterations = 2000;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await benchCol.save({
        id: `item_${i % 200}`,
        data: { idx: i },
        body: `벤치마크 데이터 #${i} 참조: [[bench/item_${(i + 1) % 200}]]`,
      });
    }
    const elapsedMs = performance.now() - start;
    const avgMsPerOp = elapsedMs / iterations;

    // 1회(문서 파싱 + 커넥톰 인덱싱 + 아레나 할당/리셋 + 링 버퍼 기록) 평균 0.05ms 이하 검증
    expect(avgMsPerOp).toBeLessThan(0.05);
    expect(db.walStats().ringBuffer.currentLsn).toBe(iterations);
    expect(db.engine.connectome.verifyGraphInvariants().ok).toBe(true);

    // 디스크 쓰기 큐 비우기 후 종료
    (db.engine as any).pendingWriteQueue.clear();
    db.close();
  });
});
