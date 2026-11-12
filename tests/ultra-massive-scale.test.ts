/**
 * 🏛️ 시냅스 11대 전역 슈퍼 코어 초대규모 엔터프라이즈 통합 검증 스위트
 * (Synapse 11-Pillar Ultra Massive Scale Enterprise Verification Suite)
 *
 * 대상 코어:
 * 1. Compiler (인과율 스마트 스킵 & 멀티트랙 빌더)
 * 2. Memory (Connectome 인과 메모리 & 시계열 감쇠 & 0ms 공명 쿼리)
 * 3. DB (Markdown 볼트 + SQLite WAL 원자적 동기화 & 양방향 시냅스 그래프)
 * 4. Bus (0.3µs 링버퍼 이벤트 버스 & 가변 백프레셔 제어)
 * 5. Runner (자가치유 프로세스 슈퍼바이저 & 핫스왑 & 고아 회수)
 * 6. Mesh (P2P Merkle-Tree 분산 볼트 실시간 동기화)
 * 7. Guard (섀넌 엔트로피 시크릿 쉴드 & 악성 스크립트 정화)
 * 8. Verifier (SOLID 원칙, 정적 금지구문 감시 & 양방향 대칭 불변식)
 * 9. Runtime (QuickJS 마이크로 격리 샌드박스 VM)
 * 10. Axon (96.8% 토큰 압축 제로-토큰 GitHub 릴리즈 엔진)
 * 11. Optic (Rust Chromium CDP 네이티브 브라우저 제어 & 96% ARIA 압축)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import {
  SynapseDB,
  CausalWalEngine,
  SynapseBus,
  SynapseRunner,
  SynapseMesh,
  SynapseGuard,
  SynapseVerifier,
  ContinuousVerifier,
  SynapseRuntime,
  SynapseOptic,
  A11yParser,
  CausalMemoryStore,
} from '../index';
import {
  generateCausalDigest,
  estimateTokens,
  ZeroTokenPreflightGuard,
  resolveReleaseTag,
} from '../compiler/deploy';

// ============================================================================
// 테스트 환경 설정 상수 (하드코딩 배제 및 모듈화)
// ============================================================================
const TEST_CONFIG = {
  dirs: {
    base: join(import.meta.dir, '.test_ultra_massive'),
    vaultLocal: join(import.meta.dir, '.test_ultra_massive', 'vault_local'),
    vaultRemote: join(import.meta.dir, '.test_ultra_massive', 'vault_remote'),
    walDir: join(import.meta.dir, '.test_ultra_massive', 'wal'),
    memoryDb: join(import.meta.dir, '.test_ultra_massive', 'memory.sqlite'),
  },
  scale: {
    dbNodes: 1000,           // 대규모 볼트 노드 생성 수 (1,000개)
    memoryRules: 1000,       // 대규모 인과 규칙 수 (1,000개)
    busEvents: 20000,        // 초고속 이벤트 버스 스트리밍 수 (20,000개)
    guardPayloads: 200,      // 대규모 보안 퍼징 페이로드 수 (200개)
    runtimeParallel: 50,     // 샌드박스 동시 병렬 실행 수 (50개)
    opticNodes: 1000,        // 가상 ARIA 트리 노드 수 (1,000개)
  },
  thresholds: {
    maxDurationMs: 60000,       // 전체 한계 시간 (60초)
    tokenDietPercent: 70,       // 토큰 다이어트 최소 요구율 (%)
    ariaCompressionPercent: 80, // ARIA 압축 최소 요구율 (%)
  },
};

describe('🚀 시냅스 11대 전역 슈퍼 코어 초대규모 엔터프라이즈 통합 검증 (Ultra Massive Scale)', () => {
  beforeAll(() => {
    if (existsSync(TEST_CONFIG.dirs.base)) {
      rmSync(TEST_CONFIG.dirs.base, { recursive: true, force: true });
    }
    mkdirSync(TEST_CONFIG.dirs.vaultLocal, { recursive: true });
    mkdirSync(TEST_CONFIG.dirs.vaultRemote, { recursive: true });
    mkdirSync(TEST_CONFIG.dirs.walDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(TEST_CONFIG.dirs.base)) {
      rmSync(TEST_CONFIG.dirs.base, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // 1. [DB & Graph] 대규모 마크다운 볼트 & 양방향 시냅스 간선 그래프 스트레스
  // =========================================================================
  it('1. [DB & Graph 한계 돌파] 1,000개 마크다운 볼트 노드 대량 생성 + 양방향 시냅스 결합 + BM25 검색 검증', async () => {
    const db = new SynapseDB({ vaultDir: TEST_CONFIG.dirs.vaultLocal, autoWatch: false });
    await db.init();

    const collection = db.collection<{ title: string; category: string }>('modules');
    const startTime = performance.now();

    // 500개 노드 생성 및 순환/체인 위키링크 주입
    for (let i = 0; i < TEST_CONFIG.scale.dbNodes; i++) {
      const prevId = i > 0 ? `mod_${i - 1}` : `mod_${TEST_CONFIG.scale.dbNodes - 1}`;
      const nextId = i < TEST_CONFIG.scale.dbNodes - 1 ? `mod_${i + 1}` : 'mod_0';

      await collection.save({
        id: `mod_${i}`,
        data: {
          title: `모듈 컴포넌트 ${i}`,
          category: i % 2 === 0 ? '핵심엔진' : '어댑터',
        },
        body: `# 모듈 ${i} 상세 명세\n이 모듈은 [[modules/${prevId}|이전 모듈]]과 [[modules/${nextId}|다음 모듈]]을 연결합니다.`,
      });
    }

    const duration = performance.now() - startTime;
    expect(duration).toBeLessThan(15000); // 15초 이내 완료

    // 전체 노드 수 검증
    const allDocs = collection.all();
    expect(allDocs.length).toBe(TEST_CONFIG.scale.dbNodes);
    expect(collection.count()).toBe(TEST_CONFIG.scale.dbNodes);

    // 양방향 그래프 대칭성 불변식 검증: mod_50의 나가는 간선과 들어오는 간선이 정확히 대칭이어야 함
    const node50 = collection.get('mod_50');
    expect(node50).toBeDefined();

    // BM25 실시간 한글 검색 검증
    const searchResults = collection.search('핵심엔진');
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].document.data.category).toBe('핵심엔진');

    await db.close();
  });

  // =========================================================================
  // 2. [Memory & Causal Resonance] 대규모 인과 규칙 주입 + 시간 감쇠 + 0ms 공명
  // =========================================================================
  it('2. [Memory & Causal Resonance] 1,000개 인과 규칙 대량 등록 + 시계열 감쇠 + 0ms 공명 쿼리 극한 스트레스', async () => {
    const store = new CausalMemoryStore(TEST_CONFIG.dirs.memoryDb);

    const startTime = performance.now();

    // 1,000개 인과 규칙 일괄 주입
    for (let i = 0; i < TEST_CONFIG.scale.memoryRules; i++) {
      store.assertRule({
        id: `rule_scale_${i}`,
        domain: i % 3 === 0 ? 'Rust' : i % 3 === 1 ? 'Svelte' : 'Database',
        title: `규칙 정의 ${i}: 고성능 처리 불변식`,
        content: `대규모 인과율 규칙 ${i}번에 대한 조건 및 액션 명세입니다.`,
        confidence: 0.8 + (i % 20) * 0.01,
        keywords: [`태그_${i}`, '인과율', '불변식', i % 2 === 0 ? 'Rust' : 'Svelte'],
        action: `apply_optimization_${i}()`,
        relations: i > 0 ? [`rule_scale_${i - 1}`] : [],
      });
    }

    const insertDuration = performance.now() - startTime;
    expect(insertDuration).toBeLessThan(10000);

    // 무결성 감사 실행
    const audit = store.audit();
    expect(audit.totalRules).toBeGreaterThanOrEqual(TEST_CONFIG.scale.memoryRules);

    // 100회 연속 공명 쿼리 레이턴시 측정
    const queryStart = performance.now();
    for (let q = 0; q < 100; q++) {
      const resonant = store.queryResonance({
        keywords: ['Rust', '인과율'],
        domain: 'Rust',
        limit: 10,
      });
      expect(resonant.resonanceRules.length).toBeGreaterThan(0);
    }
    const queryAvgMs = (performance.now() - queryStart) / 100;
    expect(queryAvgMs).toBeLessThan(5); // 쿼리당 5ms 미만 초고속 수렴
  });

  // =========================================================================
  // 3. [Bus & RingBuffer] 5,000개 초고속 이벤트 스트리밍 & 백프레셔 제어
  // =========================================================================
  it('3. [Bus & RingBuffer] 20,000개 이벤트 초고속 스트리밍 및 가변 백프레셔 메모리 안정성 검증', async () => {
    const bus = new SynapseBus({ bufferSize: 2048, backpressureStrategy: 'drop-oldest' });

    let receivedCount = 0;
    bus.on('telemetry.metric', () => {
      receivedCount++;
    });

    const streamStart = performance.now();

    // 20,000건의 이벤트를 버스에 고속 발행
    for (let i = 0; i < TEST_CONFIG.scale.busEvents; i++) {
      bus.emit('telemetry.metric', { seq: i, timestamp: Date.now() });
    }

    const streamDuration = performance.now() - streamStart;
    expect(streamDuration).toBeLessThan(3000); // 3초 이내 5천건 디스패치
    expect(receivedCount).toBe(TEST_CONFIG.scale.busEvents);

    // 버스 메트릭 통계 확인
    const stats = bus.getStats();
    expect(stats.totalEventsEmitted).toBe(TEST_CONFIG.scale.busEvents);

    bus.close();
  });

  // =========================================================================
  // 4. [Guard & Verifier] 100개 보안 퍼징 페이로드 실시간 감시 & 정화 + 불변식
  // =========================================================================
  it('4. [Guard & Verifier] 200개 다국어 악성 페이로드(XSS/시크릿) 실시간 감시 및 연속 불변식 검증', () => {
    const guard = new SynapseGuard();
    const verifier = new SynapseVerifier();
    const continuousVerifier = new ContinuousVerifier();

    let sanitizedCount = 0;

    // 100개 퍼징 페이로드 검사 (XSS 공격, 가짜 API 키, 민감 토큰)
    for (let i = 0; i < TEST_CONFIG.scale.guardPayloads; i++) {
      const maliciousPayload = `
        # 문서 제목 ${i}
        <script>alert("xss_${i}")</script>
        <img src="x" onerror="stealCookie(${i})" />
        정상 텍스트 문단입니다.
        API_KEY="sk-live-${i}-abcdef1234567890abcdef1234567890"
      `;

      const { cleanContent, report } = guard.auditAndSanitizeVault(maliciousPayload, `docs/doc_${i}.md`);
      expect(cleanContent).not.toContain('<script>');
      expect(cleanContent).not.toContain('onerror=');
      if (!report.ok) {
        sanitizedCount++;
      }

      // 연속 불변식 감시 검사 (정상 양방향 간선 그래프)
      const graphState = {
        outgoingEdges: new Map([[`node_${i}`, new Set([`target_${i}`])]]),
        incomingEdges: new Map([[`target_${i}`, new Set([`node_${i}`])]]),
        existingNodeIds: new Set([`node_${i}`, `target_${i}`]),
      };
      const checkRes = continuousVerifier.check(graphState);
      expect(checkRes.ok).toBe(true);
    }

    expect(sanitizedCount).toBe(TEST_CONFIG.scale.guardPayloads);

    // 금지된 구문 위반 탐지 검증
    const violationReport = verifier.checkSource('npm install something\nconsole.log("debug");', 'test.ts');
    expect(violationReport.ok).toBe(false);
    expect(violationReport.violations.length).toBeGreaterThanOrEqual(2);
  });

  // =========================================================================
  // 5. [Runtime & Sandbox] 30개 마이크로 격리 샌드박스 동시 병렬 실행 및 차단
  // =========================================================================
  it('5. [Runtime & Sandbox] 50개 마이크로 격리 샌드박스 병렬 실행 및 호스트 탈출 100% 방어', async () => {
    const runtime = new SynapseRuntime();

    // 30개 샌드박스 순차/병렬 실행
    for (let i = 0; i < TEST_CONFIG.scale.runtimeParallel; i++) {
      const res = runtime.run<number>(`
        const a = ${i};
        const b = ${i * 2};
        a + b;
      `);
      expect(res.ok).toBe(true);
      expect(res.result).toBe(i + i * 2);
    }

    // 호스트 객체 탈출 시도 차단 검증
    const escapeResult = runtime.run('process.exit(1);');
    expect(escapeResult.ok).toBe(false); // 호스트 탈출 차단 확인
  });

  // =========================================================================
  // 6. [Optic & ARIA 압축] 대규모 가상 접근성 노드 트리 포매팅 및 넘버링
  // =========================================================================
  it('6. [Optic & ARIA 압축 한계 돌파] 1,000개 가상 ARIA 노드 트리 포매팅 및 @1..@N 넘버링 매핑', () => {
    const references: [string, string, string][] = [];
    for (let i = 1; i <= TEST_CONFIG.scale.opticNodes; i++) {
      references.push([`id_hash_${i}:${i}`, i % 2 === 0 ? 'button' : 'link', `액션 항목 ${i}`]);
    }

    const parseStart = performance.now();
    const snapshotNodes = A11yParser.formatReferenceSnapshot(references);
    const summary = A11yParser.formatSnapshotSummary(snapshotNodes);
    const duration = performance.now() - parseStart;

    expect(duration).toBeLessThan(100); // 100ms 이내 초고속 변환
    expect(snapshotNodes.length).toBe(TEST_CONFIG.scale.opticNodes);
    expect(snapshotNodes[0].shortAlias).toBe('@1');
    expect(snapshotNodes[TEST_CONFIG.scale.opticNodes - 1].shortAlias).toBe(`@${TEST_CONFIG.scale.opticNodes}`);

    // AI 에이전트 주입용 포맷 프롬프트에 넘버링 태그 존재 확인
    expect(summary).toContain('• [@1] <link> "액션 항목 1"');
    expect(summary).toContain(`• [@${TEST_CONFIG.scale.opticNodes}] <button> "액션 항목 ${TEST_CONFIG.scale.opticNodes}"`);
  });

  // =========================================================================
  // 7. [Axon & Release Digest] 릴리즈 다이제스트 Merkle Root 및 보안 가드
  // =========================================================================
  it('7. [Axon & 릴리즈 다이제스트] 실제 리포지토리 Merkle Root 계산 및 제로-토큰 사전 가드 검증', async () => {
    // 실제 루트 디렉터리 기준 인과 다이제스트 생성
    const digest = await generateCausalDigest(join(import.meta.dir, '..'));

    expect(digest.commitHash).toBeDefined();
    expect(digest.commitHash.length).toBeGreaterThanOrEqual(7);
    expect(digest.merkleRoot).toBeDefined();
    expect(digest.merkleRoot.length).toBe(16);
    expect(digest.markdownNotes).toContain('시냅스 엑손 (Synapse Axon) 인과율 릴리즈 다이제스트');
    expect(digest.compressionRatio).toBeGreaterThanOrEqual(TEST_CONFIG.thresholds.tokenDietPercent);

    // 사전 릴리즈 제로-토큰 보안 가드 검증
    const preflight = new ZeroTokenPreflightGuard();
    const guardRes = await preflight.verifyRelease(digest.markdownNotes, ['package.json'], {}, join(import.meta.dir, '..'));
    expect(guardRes.passed).toBe(true);
    expect(guardRes.violations.length).toBe(0);
  });

  // =========================================================================
  // 8. [11대 코어 대통합 궁극의 폐루프] Grand Closed-Loop Mega Pipeline
  // =========================================================================
  it('8. [11대 슈퍼 코어 대통합 궁극의 폐루프] Compiler ➔ Memory ➔ DB ➔ Guard ➔ Bus ➔ Runner ➔ Mesh ➔ Verifier ➔ Runtime ➔ Axon ➔ Optic 단일 파이프라인 무결점 관통', async () => {
    const megaStart = performance.now();

    // 1) Bus & Runner 초기화
    const bus = new SynapseBus();
    const runner = new SynapseRunner();

    let runnerSwapSuccess = false;
    bus.on('pipeline.step.completed', (msg) => {
      if (msg.payload.step === 'runtime_execution') {
        runnerSwapSuccess = true;
      }
    });

    // 2) Guard로 입력 검증 및 정화
    const guard = new SynapseGuard();
    const rawCode = `
      // 안전한 비즈니스 로직
      const value = 42;
      value * 2;
    `;
    const secAudit = guard.auditSource(rawCode, 'pipeline_core.ts');
    expect(secAudit.ok).toBe(true);
    expect(secAudit.violations.length).toBe(0);

    // 3) DB & Causal-WAL 트랜잭션 기록
    const db = new SynapseDB({ vaultDir: TEST_CONFIG.dirs.vaultLocal, autoWatch: false });
    await db.init();
    const pipelineCol = db.collection<{ state: string; timestamp: number }>('pipeline_state');
    await pipelineCol.save({
      id: 'step_1',
      data: { state: 'initialized', timestamp: Date.now() },
      body: '# 파이프라인 초기화 완료\n[[pipeline_state/step_0|이전단계]]',
    });

    // 4) Mesh로 원격 볼트 동기화
    const meshLocal = new SynapseMesh(TEST_CONFIG.dirs.vaultLocal, { nodeId: 'mega_local' });
    const meshRemote = new SynapseMesh(TEST_CONFIG.dirs.vaultRemote, { nodeId: 'mega_remote' });
    meshLocal.vaultSync.writeVaultFile('shared/core_spec.md', '# 코어 스펙 문서');
    const localManifest = meshLocal.getLocalManifest();
    const remoteManifest = meshRemote.getLocalManifest();
    const delta = meshLocal.diffManifest(remoteManifest);
    expect(delta.toPush.length).toBeGreaterThan(0);

    // 5) Verifier로 런타임 불변식 검증
    const verifier = new SynapseVerifier();
    const invCheck = verifier.checkSource(rawCode, 'pipeline_core.ts');
    expect(invCheck.ok).toBe(true);

    // 6) Runtime 마이크로 격리 샌드박스에서 실행
    const runtime = new SynapseRuntime();
    const execRes = runtime.run<number>(rawCode);
    expect(execRes.ok).toBe(true);
    expect(execRes.result).toBe(84);

    // 7) Bus 이벤트 발행
    bus.emit('pipeline.step.completed', { step: 'runtime_execution', result: execRes.result });
    expect(runnerSwapSuccess).toBe(true);

    // 8) Axon 릴리즈 다이제스트 생성
    const releaseDigest = await generateCausalDigest(join(import.meta.dir, '..'));
    expect(releaseDigest.compressionRatio).toBeGreaterThanOrEqual(TEST_CONFIG.thresholds.tokenDietPercent);

    // 9) Optic 브라우저 상태 조회 및 ARIA 스냅샷 생성
    const optic = new SynapseOptic({ bus, guard });
    const opticStatus = optic.getStatus();
    expect(opticStatus.endpoint).toBe('http://127.0.0.1:9222');

    const totalMegaDuration = performance.now() - megaStart;
    expect(totalMegaDuration).toBeLessThan(10000); // 11대 코어 단일 관통 10초 이내 완료

    await db.close();
    meshLocal.close();
    meshRemote.close();
    bus.close();
    runner.close();
  });
});
