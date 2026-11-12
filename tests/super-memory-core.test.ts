import { test, expect, describe } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CausalMemoryStore,
  ContextCheckpointStore,
  CausalTimeSeriesEngine,
  CausalGraveyardStore,
  CausalBranchStore,
  CausalPredictorEngine,
  CausalSynthesizerEngine,
  CausalObsidianLensEngine,
  startCausalServer,
} from '../memory/index';

describe('6대 인지 슈퍼 코어 (Super Cognitive Cores) 정밀 검증 스위트', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'synapse-super-core-test-'));
  const testDbPath = join(tempDir, 'causal-memory.json');
  const testContextDbPath = join(tempDir, 'causal-contexts.json');
  const testGraveyardPath = join(tempDir, 'causal-graveyard.json');
  const testBranchPath = join(tempDir, 'causal-branches.json');
  const testVaultDir = join(tempDir, 'test-vault');

  // 1. Time-Series Engine 검증
  test('1. Causal Time-Series Engine - 감쇠 가중치, Diff, Rewind, Timeline 검증', async () => {
    const memoryStore = new CausalMemoryStore(testDbPath);
    const contextStore = new ContextCheckpointStore(testContextDbPath, testDbPath);
    const timeSeries = new CausalTimeSeriesEngine(contextStore);

    // 샘플 체크포인트 2개 생성
    const cp1 = await contextStore.saveCheckpoint({
      title: 'Phase 1 Init',
      goal: '기본 골격 구축',
      completedSteps: ['모듈 뼈대 생성'],
      pendingTasks: ['테스트 코드 작성', '빌드 검증'],
      activeFiles: ['src/core.ts'],
      modifiedFiles: ['src/core.ts'],
    });

    const cp2 = await contextStore.saveCheckpoint({
      title: 'Phase 2 Test & Build',
      goal: '테스트 및 빌드 완성',
      completedSteps: ['모듈 뼈대 생성', '테스트 코드 작성'],
      pendingTasks: ['빌드 검증', '배포 준비'],
      activeFiles: ['src/core.ts', 'tests/core.test.ts'],
      modifiedFiles: ['tests/core.test.ts'],
    });

    // 1-1. Diff 검증
    const diff = timeSeries.diffCheckpoints(cp1.id, cp2.id);
    expect(diff).not.toBeNull();
    expect(diff.fromId).toBe(cp1.id);
    expect(diff.toId).toBe(cp2.id);
    expect(diff.newlyCompletedSteps).toContain('테스트 코드 작성');
    expect(diff.resolvedPendingTasks).toContain('테스트 코드 작성');
    expect(diff.addedModifiedFiles).toContain('tests/core.test.ts');

    // 1-2. Timeline 검증
    const timeline = timeSeries.generateTimeline(10);
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(timeline[0].checkpointId).toBe(cp2.id); // 최신순

    // 1-3. Rewind 검증
    const rolledBackCp = await timeSeries.rewindToCheckpoint(cp1.id);
    expect(rolledBackCp.id).toBeDefined();
    expect(rolledBackCp.title).toContain('Rewind');
    const latestAfterRewind = contextStore.getLatestCheckpoint();
    expect(latestAfterRewind?.id).toBe(rolledBackCp.id);

    // 1-4. 감쇠 가중치 검증
    const dummyRules = [
      {
        id: 'r_old',
        title: 'OldRule',
        name: 'OldRule',
        domain: 'core',
        confidence: 1.0,
        weight: 1.0,
        invariants: [],
        updatedAt: new Date(Date.now() - 30 * 86400000).toISOString(), // 30일 전
      },
      {
        id: 'r_fresh',
        title: 'FreshRule',
        name: 'FreshRule',
        domain: 'core',
        confidence: 1.0,
        weight: 1.0,
        invariants: [],
        updatedAt: new Date().toISOString(), // 방금
      },
    ];
    const decayed = timeSeries.computeDecayedResonance(dummyRules);
    // 최신 규칙이 오래된 규칙보다 높은 점수
    expect(decayed[1].decayScore).toBeGreaterThan(decayed[0].decayScore);
  });

  // 2. Negative Memory / Graveyard 검증
  test('2. Causal Graveyard - 실패 안티패턴 등록 및 실시간 함정 스캔 차단 검증', () => {
    const graveyard = new CausalGraveyardStore(testGraveyardPath);

    // 2-1. 안티패턴 함정 등록
    const trap = graveyard.assertTrap({
      trapPattern: 'npm install bypass',
      triggerKeywords: ['npm install', 'bypass npm'],
      domain: 'security',
      severity: 'CRITICAL',
      reason: 'npm 사용 시 전역 룰 위반 및 잠금 충돌 유발',
      safeAlternative: '항상 bun을 사용하세요',
      avoidFiles: ['package-lock.json'],
    });

    expect(trap.id).toContain('trap_');
    expect(trap.severity).toBe('CRITICAL');

    // 2-2. 정상 케이스 스캔 (미트랩)
    const cleanScan = graveyard.scanTraps({
      files: ['src/index.ts'],
      keywords: ['clean', 'bun'],
    });
    expect(cleanScan.trapped).toBe(false);
    expect(cleanScan.triggeredTraps.length).toBe(0);

    // 2-3. 함정 트리거 스캔 (트랩 검출)
    const trappedScan = graveyard.scanTraps({
      files: ['package-lock.json'],
      keywords: ['npm', 'bypass'],
    });
    expect(trappedScan.trapped).toBe(true);
    expect(trappedScan.triggeredTraps.length).toBeGreaterThan(0);
    expect(trappedScan.highestSeverity).toBe('CRITICAL');

    const warningText = CausalGraveyardStore.formatTrapWarnings(trappedScan);
    expect(warningText).toContain('안티패턴');
    expect(warningText).toContain('CRITICAL');
  });

  // 3. Context Branching & Merging 검증
  test('3. Causal Branch - 맥락 분기(Fork), 병합(Merge), 폐기 ➔ Graveyard 자동 이관 검증', async () => {
    const memoryStore = new CausalMemoryStore(testDbPath);
    const contextStore = new ContextCheckpointStore(testContextDbPath, testDbPath);
    const graveyard = new CausalGraveyardStore(testGraveyardPath);
    const branchStore = new CausalBranchStore(testBranchPath, contextStore, graveyard);

    // 3-1. 초기 상태 및 기본 브랜치 검증
    expect(branchStore.getCurrentBranch().name).toBe('main');

    // 3-2. 실험 브랜치 생성 및 전환
    const expBranch = await branchStore.createBranch('experiment/opt-v2', {
      description: '최적화 실험',
    });
    expect(expBranch.name).toBe('experiment/opt-v2');

    branchStore.switchBranch('experiment/opt-v2');
    expect(branchStore.getCurrentBranch().name).toBe('experiment/opt-v2');

    // 3-3. 실패 실험 폐기 ➔ Graveyard 자동 이관 검증
    const trapsBefore = graveyard.listTraps().length;

    const abandonResult = branchStore.abandonBranch('experiment/opt-v2', {
      failedApproach: 'O(N^2) 전체 루프 스캔',
      rootCause: '알고리즘 복잡도가 O(N^2)로 치솟아 성능 저하 발생',
      counterMeasure: '기존 O(1) 인덱스 맵 캐시를 유지할 것',
    });
    expect(abandonResult.branch.status).toBe('abandoned');
    expect(branchStore.getCurrentBranch().name).toBe('main');

    const trapsAfter = graveyard.listTraps().length;
    expect(trapsAfter).toBe(trapsBefore + 1);

    // 3-4. 성공 브랜치 생성 및 병합(Merge)
    await branchStore.createBranch('feature/fast-cache');
    branchStore.switchBranch('feature/fast-cache');
    const mergeResult = await branchStore.mergeBranch('feature/fast-cache', 'main');
    expect(mergeResult.mergedBranch.status).toBe('merged');
    expect(branchStore.getCurrentBranch().name).toBe('main');
  });

  // 4. Predictive Impact / Blast Radius Analyzer 검증
  test('4. Causal Predictor - 다단계 파급 영향 및 Blast Radius 분석 검증', () => {
    const memoryStore = new CausalMemoryStore(testDbPath);
    const contextStore = new ContextCheckpointStore(testContextDbPath, testDbPath);
    const predictor = new CausalPredictorEngine(memoryStore, contextStore);

    // 테스트용 인과 규칙 및 간선 등록
    memoryStore.assertRule({
      id: 'rule_auth_core',
      title: 'AuthCore',
      name: 'AuthCore',
      domain: 'security',
      confidence: 1.0,
      weight: 1.0,
      invariants: ['비밀번호 평문 저장 금지', 'JWT 서명 필수 검증'],
      triggers: { files: ['src/auth/jwt.ts'] },
      updatedAt: new Date().toISOString(),
    });

    memoryStore.assertRule({
      id: 'rule_session_guard',
      title: 'SessionGuard',
      name: 'SessionGuard',
      domain: 'security',
      confidence: 1.0,
      weight: 1.0,
      invariants: ['세션 만료 30분 엄수'],
      triggers: { files: ['src/auth/session.ts'] },
      updatedAt: new Date().toISOString(),
    });

    memoryStore.createRelations([
      { from: 'AuthCore', to: 'SessionGuard', relationType: 'requires' },
    ]);

    // Blast Radius 분석
    const report = predictor.analyzeBlastRadius(['src/auth/jwt.ts'], 3);
    expect(report.triggerFiles).toContain('src/auth/jwt.ts');
    expect(report.affectedNodes.length).toBeGreaterThan(0);
    expect(report.prefetchedInvariants).toContain('비밀번호 평문 저장 금지');
    expect(report.maxRiskScore).toBeGreaterThanOrEqual(50);
  });

  // 5. Auto-Intent Reverse Synthesizer 검증
  test('5. Causal Synthesizer - Git 상태 분석 및 의도 자동 역합성 검증', async () => {
    const memoryStore = new CausalMemoryStore(testDbPath);
    const contextStore = new ContextCheckpointStore(testContextDbPath, testDbPath);
    const synthesizer = new CausalSynthesizerEngine(contextStore, memoryStore);

    // Git 변경 검사
    const changes = await synthesizer.inspectGitChanges(process.cwd());
    expect(changes.cwd).toBe(process.cwd());
    expect(changes.stats).toBeDefined();

    // 의도 역합성
    const intent = synthesizer.synthesizeIntent(changes, '테스트 역합성 세션');
    expect(intent.title).toBe('테스트 역합성 세션');
    expect(intent.completedSteps.length).toBeGreaterThan(0);
    expect(intent.pendingTasks.length).toBeGreaterThan(0);

    // 원클릭 자동 체크포인트 저장
    const cp = await synthesizer.autoCheckpoint(process.cwd(), {
      title: '자동 역합성 검증 스냅샷',
    });
    expect(cp.id).toContain('ctx_');
    expect(cp.title).toBe('자동 역합성 검증 스냅샷');
    expect(cp.completedSteps.length).toBeGreaterThan(0);
  });

  // 6. Obsidian Bi-directional Lens 검증
  test('6. Causal Obsidian Lens - Vault 마크다운/캔버스 내보내기 및 양방향 동기화 검증', async () => {
    const memoryStore = new CausalMemoryStore(testDbPath);
    const contextStore = new ContextCheckpointStore(testContextDbPath, testDbPath);
    const graveyard = new CausalGraveyardStore(testGraveyardPath);
    const lens = new CausalObsidianLensEngine(memoryStore, contextStore, graveyard);

    // 6-1. 볼트로 내보내기 (Export)
    const exportRes = await lens.exportToVault(testVaultDir);
    expect(exportRes.success).toBe(true);
    expect(exportRes.canvasGenerated).toBe(true);
    expect(exportRes.timelineGenerated).toBe(true);

    const mentalDir = join(testVaultDir, 'Synapse-Mental');
    expect(existsSync(join(mentalDir, 'Timeline.md'))).toBe(true);
    expect(existsSync(join(mentalDir, 'Causal-Architecture.canvas'))).toBe(true);

    // Canvas JSON 파일 유효성 검증
    const canvasRaw = readFileSync(join(mentalDir, 'Causal-Architecture.canvas'), 'utf-8');
    const canvasDoc = JSON.parse(canvasRaw);
    expect(Array.isArray(canvasDoc.nodes)).toBe(true);
    expect(Array.isArray(canvasDoc.edges)).toBe(true);

    // 6-2. 볼트에서 역가져오기 (Import)
    const importRes = await lens.importFromVault(testVaultDir);
    expect(importRes.success).toBe(true);
    expect(importRes.importedRules).toBeGreaterThanOrEqual(1);

    // 6-3. 양방향 동기화 (Sync)
    const syncRes = await lens.syncWithVault(testVaultDir);
    expect(syncRes.success).toBe(true);
  });

  // 7. MCP & HTTP Server 신규 6종 도구 통합 검증
  test('7. MCP Daemon & HTTP API - 21종 도구 및 6대 슈퍼 코어 엔드포인트 E2E 호출 검증', async () => {
    const testPort = 4288;
    const server = startCausalServer({
      port: testPort,
      dbPath: testDbPath,
      contextDbPath: testContextDbPath,
    });

    try {
      // 7-1. tools/list 21개 도구 노출 검증
      const listRes = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 100, method: 'tools/list' }),
      });
      const listData: any = await listRes.json();
      expect(listData.result.tools.length).toBe(21);

      // 7-2. MCP tools/call predict_blast_radius
      const predictRes = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 101,
          method: 'tools/call',
          params: {
            name: 'predict_blast_radius',
            arguments: { files: ['src/auth/jwt.ts'] },
          },
        }),
      });
      const predictData: any = await predictRes.json();
      const predictReport = JSON.parse(predictData.result.content[0].text);
      expect(predictReport.overallRisk).toBeDefined();

      // 7-3. MCP tools/call scan_causal_graveyard
      const scanRes = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 102,
          method: 'tools/call',
          params: {
            name: 'scan_causal_graveyard',
            arguments: { action: 'scan', files: ['package-lock.json'] },
          },
        }),
      });
      const scanData: any = await scanRes.json();
      expect(scanData.result.content[0].text).toBeDefined();

      // 7-4. HTTP REST /timeline
      const tlRes = await fetch(`http://127.0.0.1:${testPort}/timeline?limit=5`);
      const tlData: any = await tlRes.json();
      expect(tlData.ok).toBe(true);
      expect(tlData.timeline).toBeDefined();

      // 7-5. HTTP REST /branch
      const branchRes = await fetch(`http://127.0.0.1:${testPort}/branch`);
      const branchData: any = await branchRes.json();
      expect(branchData.ok).toBe(true);
      expect(branchData.current.name).toBe('main');
    } finally {
      server.stop();
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Windows 파일 잠금 지연 무시
      }
    }
  });
});
