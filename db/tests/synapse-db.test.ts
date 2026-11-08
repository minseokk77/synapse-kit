/**
 * Synapse-DB 종합 검증 테스트 스위트 (Bun Test Runner)
 * 1. CRUD 및 원자적 마크다운 파일 저장
 * 2. 위키링크 기반 시냅스 간선 자동 형성 및 양방향 탐색
 * 3. 한국어 전문 검색 (BM25 형태소 검색)
 * 4. 옵시디언 캔버스(.canvas) 자동 내보내기
 * 5. 인메모리 O(1) 조회 지연율 및 대량 데이터 벤치마크
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { SynapseDB } from "../index";

const TEST_VAULT_DIR = resolve(import.meta.dir, ".test_vault");

describe("🧠 Synapse-DB 범용 마크다운 시냅스 데이터베이스 검증", () => {
  let db: SynapseDB;

  beforeAll(async () => {
    if (existsSync(TEST_VAULT_DIR)) {
      rmSync(TEST_VAULT_DIR, { recursive: true, force: true });
    }

    db = new SynapseDB({
      vaultDir: TEST_VAULT_DIR,
      autoWatch: false,
      persistDebounceMs: 10,
    });

    await db.init();
  });

  afterAll(() => {
    db.close();
    if (existsSync(TEST_VAULT_DIR)) {
      rmSync(TEST_VAULT_DIR, { recursive: true, force: true });
    }
  });

  it("1. 컬렉션 생성 및 문서 저장/조회 (CRUD)", async () => {
    interface ClipData {
      title: string;
      views: number;
      tags: string[];
    }

    const clips = db.collection<ClipData>("clips");

    // 저장
    const saved = await clips.save({
      id: "clip_001",
      data: {
        title: "침착맨의 전설적인 명장면",
        views: 12500,
        tags: ["게임", "하이라이트"],
      },
      body: "이 영상은 치지직 방송에서 추출된 레전드 클립입니다.",
    });

    expect(saved.id).toBe("clip_001");
    expect(saved.collection).toBe("clips");
    expect(saved.data.title).toBe("침착맨의 전설적인 명장면");

    // O(1) 조회
    const loaded = clips.get("clip_001");
    expect(loaded).not.toBeNull();
    expect(loaded?.data.views).toBe(12500);

    // 디스크 플러시 후 실제 마크다운 파일 존재 확인
    db.flush();
    const diskPath = join(TEST_VAULT_DIR, "clips", "clip_001.md");
    expect(existsSync(diskPath)).toBe(true);

    const fileContent = readFileSync(diskPath, "utf-8");
    expect(fileContent).toContain("title: \"침착맨의 전설적인 명장면\"");
    expect(fileContent).toContain("views: 12500");
    expect(fileContent).toContain("이 영상은 치지직 방송에서 추출된 레전드 클립입니다.");
  });

  it("2. 옵시디언 위키링크 시냅스 자동 결합 (Wikilink Auto-Wiring)", async () => {
    const streamers = db.collection("streamers");
    const guilds = db.collection("guilds");
    const clips = db.collection("clips");

    // 스트리머 등록
    await streamers.save({
      id: "ch_calmdown",
      data: { name: "침착맨", followers: 500000 },
      body: "# 침착맨 프로필",
    });

    // 디스코드 길드 등록 (위키링크로 스트리머 시냅스 연결)
    await guilds.save({
      id: "guild_main",
      data: { serverName: "메인 디스코드" },
      body: "구독 중인 스트리머: [[streamers/ch_calmdown|침착맨 공식 방송]]",
    });

    // 클립 등록 (위키링크로 스트리머와 길드 시냅스 연결)
    await clips.save({
      id: "clip_002",
      data: { title: "침착맨 롤 승급전", views: 25000 },
      body: "스트리머: [[streamers/ch_calmdown]] | 발행 서버: [[guilds/guild_main]]",
    });

    db.flush();

    // 클립 ➔ 나가는 시냅스(Outgoing) 검증
    const clipDoc = clips.get("clip_002");
    expect(clipDoc).not.toBeNull();
    expect(clipDoc?.wikilinks.length).toBe(2);

    const outgoingStreamers = clips.synapses("clip_002").outgoing("streamers");
    expect(outgoingStreamers.length).toBe(1);
    expect(outgoingStreamers[0].id).toBe("ch_calmdown");

    const outgoingGuilds = clips.synapses("clip_002").outgoing("guilds");
    expect(outgoingGuilds.length).toBe(1);
    expect(outgoingGuilds[0].id).toBe("guild_main");

    // 스트리머 ➔ 들어오는 시냅스(Incoming) 역방향 탐색 검증
    const incomingToStreamer = streamers.synapses("ch_calmdown").incoming();
    // 길드 1개 + 클립 1개 ➔ 총 2곳에서 침착맨을 참조
    expect(incomingToStreamer.length).toBe(2);
    const referencingIds = incomingToStreamer.map((d) => d.id);
    expect(referencingIds).toContain("guild_main");
    expect(referencingIds).toContain("clip_002");
  });

  it("3. 한국어 N-gram 전문 검색 (BM25 Full-Text Search)", async () => {
    const clips = db.collection("clips");

    await clips.save({
      id: "search_test_1",
      data: { title: "오버워치 에이펙스 하이라이트 영상", category: "오버워치" },
      body: "센티넬 아이언사이트 조준 사격 명장면입니다.",
    });

    await clips.save({
      id: "search_test_2",
      data: { title: "롤 칼바람 나락 티모 펜타킬", category: "리그오브레전드" },
      body: "버섯을 밟고 전멸하는 적들의 눈물겨운 장면.",
    });

    db.flush();

    // 단어 검색
    const results1 = clips.search("아이언사이트");
    expect(results1.length).toBeGreaterThan(0);
    expect(results1[0].document.id).toBe("search_test_1");

    // 2-gram 부분 문자열 검색
    const results2 = clips.search("펜타킬");
    expect(results2.length).toBeGreaterThan(0);
    expect(results2[0].document.id).toBe("search_test_2");
  });

  it("4. 옵시디언 캔버스(.canvas) 자동 내보내기 검증", () => {
    const canvasPath = join(TEST_VAULT_DIR, "synapse_overview.canvas");
    const canvas = db.exportCanvas(canvasPath);

    expect(existsSync(canvasPath)).toBe(true);
    expect(canvas.nodes.length).toBeGreaterThanOrEqual(5);
    expect(canvas.edges.length).toBeGreaterThanOrEqual(3);

    const canvasRaw = readFileSync(canvasPath, "utf-8");
    const parsed = JSON.parse(canvasRaw);
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.edges)).toBe(true);
  });

  it("5. JSON 마이그레이터 동작 검증", async () => {
    const migrator = db.createMigrator();
    const mockUsers = [
      { userId: "user_1", name: "홍길동", role: "admin" },
      { userId: "user_2", name: "김철수", role: "user" },
    ];

    const count = await migrator.migrateFromJsonArray("users", mockUsers, (item) => ({
      id: item.userId,
      data: { name: item.name, role: item.role },
      body: `# ${item.name} (${item.role})`,
    }));

    expect(count).toBe(2);

    const usersCol = db.collection("users");
    expect(usersCol.count()).toBe(2);
    expect(usersCol.get("user_1")?.data.name).toBe("홍길동");
  });

  it("6. 인메모리 O(1) 쿼리 속도 실측 (1,000회 연속 조회 벤치마크)", () => {
    const clips = db.collection("clips");
    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const doc = clips.get("clip_001");
      expect(doc).not.toBeNull();
    }

    const duration = performance.now() - start;
    const avgPerQueryUs = (duration / iterations) * 1000; // 마이크로초

    // 1회 조회당 50마이크로초(0.05ms) 이하의 초저지연 검증
    expect(avgPerQueryUs).toBeLessThan(50);
  });
});
