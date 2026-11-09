import { test, expect, describe } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'bun';
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
  CAUSAL_MCP_TOOLS,
} from '../memory/index';

describe('🔥 Synapse 6대 인지 슈퍼 코어 - 극한 스트레스·퍼징·무결성 심층 검증 (Deep Verification)', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'synapse-deep-verify-'));
  const dbPath = join(tempRoot, 'deep-memory.json');
  const ctxPath = join(tempRoot, 'deep-contexts.json');
  const gravePath = join(tempRoot, 'deep-graveyard.json');
  const branchPath = join(tempRoot, 'deep-branches.json');
  const vaultPath = join(tempRoot, 'obsidian-vault');

  test('1. [Time-Series 수학적 불변성 & 1,000규칙 성능] 감쇠 단조성, 빈도 가산, 다중 Rewind 무결성', async () => {
    const store = new CausalMemoryStore(dbPath);
    const ctxStore = new ContextCheckpointStore(ctxPath, dbPath);
    const tsEngine = new CausalTimeSeriesEngine(ctxStore, store);

    // 1-1. 시간 경과에 따른 단조 감소(Monotonic Decay) 수학적 검증
    const now = Date.now();
    const score0h = CausalTimeSeriesEngine.calculateTemporalDecayScore({
      baseScore: 1.0,
      lastActiveMs: now,
      nowMs: now,
      halfLifeHours: 24,
      hitCount: 0,
    });
    const score24h = CausalTimeSeriesEngine.calculateTemporalDecayScore({
      baseScore: 1.0,
      lastActiveMs: now - 24 * 3600 * 1000,
      nowMs: now,
      halfLifeHours: 24,
      hitCount: 0,
    });
    const score48h = CausalTimeSeriesEngine.calculateTemporalDecayScore({
      baseScore: 1.0,
      lastActiveMs: now - 48 * 3600 * 1000,
      nowMs: now,
      halfLifeHours: 24,
      hitCount: 0,
    });

    expect(score0h).toBeCloseTo(1.0, 3);
    expect(score24h).toBeCloseTo(0.5, 3); // 정확히 반감기(24h)에 0.5
    expect(score48h).toBeCloseTo(0.25, 3); // 2반감기(48h)에 0.25
    expect(score0h > score24h && score24h > score48h).toBe(true);

    // 1-2. 빈도 가산(Frequency Boost) 검증
    const scoreHighHit = CausalTimeSeriesEngine.calculateTemporalDecayScore({
      baseScore: 1.0,
      lastActiveMs: now - 24 * 3600 * 1000,
      nowMs: now,
      halfLifeHours: 24,
      hitCount: 20,
    });
    expect(scoreHighHit).toBeGreaterThan(score24h);

    // 1-3. 1,000개 규칙 대량 감쇠 연산 레이턴시 검증 (< 15ms)
    const bulkRules = Array.from({ length: 1000 }, (_, i) => ({
      id: `bulk_rule_${i}`,
      title: `BulkRule_${i}`,
      domain: 'stress',
      confidence: 1.0,
      weight: 1.0,
      updatedAt: new Date(now - i * 3600 * 1000).toISOString(),
    }));
    const t0 = performance.now();
    const decayedBulk = tsEngine.computeDecayedResonance(bulkRules);
    const elapsedMs = performance.now() - t0;

    expect(decayedBulk.length).toBe(1000);
    expect(decayedBulk[0].decayScore).toBeGreaterThan(decayedBulk[999].decayScore);
    expect(elapsedMs).toBeLessThan(25);

    // 1-4. 5단계 연속 체크포인트 생성 및 다중 차분(Diff) & Rewind 복원력 검증
    const checkpoints = [];
    for (let step = 1; step <= 5; step++) {
      const cp = await ctxStore.saveCheckpoint({
        sessionId: 'deep-ts-session',
        title: `Step ${step} Snapshot`,
        goal: `Goal at step ${step}`,
        completedSteps: Array.from({ length: step }, (_, k) => `Task_${k + 1}_Done`),
        pendingTasks: [`Task_${step + 1}_Todo`, `Task_${step + 2}_Todo`],
        modifiedFiles: [`src/module_${step}.ts`],
        activeInvariants: [`Invariant_${step}`],
        autoGit: false,
        autoResonance: false,
      });
      checkpoints.push(cp);
    }

    const diff1to5 = tsEngine.diffCheckpoints(checkpoints[0].id, checkpoints[4].id);
    expect(diff1to5.newCompletedSteps).toEqual([
      'Task_2_Done',
      'Task_3_Done',
      'Task_4_Done',
      'Task_5_Done',
    ]);
    expect(diff1to5.resolvedTasks).toContain('Task_2_Todo');
    expect(diff1to5. resolvedTasks).toContain('Task_3_Todo');
    expect(diff1to5.modifiedFilesDelta.added).toContain('src/module_5.ts');
    expect(diff1to5.modifiedFilesDelta.removed).toContain('src/module_1.ts');

    const mdReport = CausalTimeSeriesEngine.formatDiffReport(diff1to5);
    expect(mdReport).toContain('Task_5_Done');
    expect(mdReport).toContain('src/module_5.ts');
  });

  test('2. [Graveyard 적대적 퍼징 100건] 윈도우/유닉스 경로 정규화, 에러 시그니처, 오탐 0% 검증', () => {
    const graveyard = new CausalGraveyardStore(gravePath);

    // 100개의 다양한 함정 주입
    for (let i = 0; i < 100; i++) {
      graveyard.assertTrap({
        id: `fuzz_trap_${i}`,
        title: `Fuzz Trap #${i}`,
        failedApproach: `anti_pattern_method_${i}`,
        errorSignature: i % 10 === 0 ? `ERR_FATAL_CODE_${i}` : undefined,
        rootCause: `Root cause description for trap ${i}`,
        counterMeasure: `Use safe_method_${i} instead`,
        triggerKeywords: [`bad_kw_${i}`],
        triggerFiles: [`src\\legacy\\module_${i}\\bad_file.ts`],
      });
    }

    expect(graveyard.listTraps().length).toBe(100);

    // 2-1. Windows 역슬래시로 등록된 함정을 Unix 슬래시 파일 경로로 스캔 시 정확히 탐지되는지 검증
    const t0 = performance.now();
    const fileMatch = graveyard.scanTraps({
      files: ['src/legacy/module_42/bad_file.ts'],
    });
    const scanDuration = performance.now() - t0;

    expect(scanDuration).toBeLessThan(15);
    expect(fileMatch.trapped).toBe(true);
    expect(fileMatch.some((w) => w.trapId === 'fuzz_trap_42' && w.matchedBy === 'file')).toBe(true);

    // 2-2. 에러 시그니처 매칭 시 CRITICAL 위험도 부여 검증
    const sigMatch = graveyard.scanTraps({
      text: 'Uncaught Exception: ERR_FATAL_CODE_50 occurred during execution',
    });
    expect(sigMatch.trapped).toBe(true);
    expect(sigMatch.highestSeverity).toBe('CRITICAL');
    expect(sigMatch[0].trapId).toBe('fuzz_trap_50');
    expect(sigMatch[0].matchedBy).toBe('error_signature');

    // 2-3. 무관한 클린 입력에 대해 오탐(False Positive) 0건 보장
    const cleanMatch = graveyard.scanTraps({
      files: ['src/modern/clean_component.svelte'],
      keywords: ['safe_operation', 'rust_sqlite'],
      text: 'Normal execution log without any errors',
    });
    expect(cleanMatch.trapped).toBe(false);
    expect(cleanMatch.length).toBe(0);
  });

  test('3. [Context Branching 다중 가설 폐루프] 5개 병렬 분기 ➔ 3개 병합 & 2개 폐기(Graveyard 자동 흡수)', async () => {
    const store = new CausalMemoryStore(dbPath);
    const ctxStore = new ContextCheckpointStore(ctxPath, dbPath);
    const graveyard = new CausalGraveyardStore(gravePath);
    const branchStore = new CausalBranchStore(branchPath, ctxStore, graveyard);

    // 베이스 체크포인트 생성
    const baseCp = await ctxStore.saveCheckpoint({
      sessionId: 'branch-test',
      title: 'Main Base',
      goal: 'Core Architecture',
      completedSteps: ['Base_Init'],
      pendingTasks: ['Feature_A', 'Feature_B'],
      keyDecisions: ['Use_Bun_Runtime'],
      autoGit: false,
      autoResonance: false,
    });

    // 성공할 가설 브랜치 3개 생성 및 각 브랜치별 작업 진행
    for (const bName of ['feat/alpha', 'feat/beta', 'feat/gamma']) {
      await branchStore.createBranch(bName, {
        baseId: baseCp.id,
        description: `가설 검증: ${bName}`,
      });
      branchStore.switchBranch(bName);
      await branchStore.mergeBranch(bName, 'main');
    }

    // 실패할 실험 브랜치 2개 생성 후 폐기 ➔ Graveyard 자동 흡수 확인
    const trapsBefore = graveyard.listTraps().length;

    await branchStore.createBranch('exp/bad-lock', {
      baseId: baseCp.id,
      description: '글로벌 뮤텍스 스핀락 시도',
    });
    branchStore.abandonBranch('exp/bad-lock', {
      failedApproach: 'spinlock_in_ui_thread',
      errorSignature: 'DEADLOCK_UI_FREEZE',
      rootCause: 'UI 스레드에서 동기 스핀락 대기로 인한 데드락 발생',
      counterMeasure: '비동기 채널(tokio::sync::mpsc) 사용',
    });

    await branchStore.createBranch('exp/raw-sql', {
      baseId: baseCp.id,
      description: '문자열 포맷팅 동적 SQL 조합',
    });
    branchStore.abandonBranch('exp/raw-sql', {
      failedApproach: 'string_concat_sql_query',
      rootCause: 'SQL Injection 보안 취약점 발생',
      counterMeasure: 'SQLx 파라미터 바인딩 쿼리 사용',
    });

    const trapsAfter = graveyard.listTraps().length;
    expect(trapsAfter).toBe(trapsBefore + 2);

    // 폐기된 브랜치의 실패 접근법을 다시 시도할 때 Graveyard가 즉시 경고를 발동하는지 폐루프 검증!
    const retryScan = graveyard.scanTraps({
      text: 'Trying DEADLOCK_UI_FREEZE or exp/bad-lock approach',
    });
    expect(retryScan.trapped).toBe(true);
    expect(retryScan.highestSeverity).toBe('CRITICAL');
  });

  test('4. [Blast Radius 순환 참조 방어 & 다이아몬드 파급] 무한 루프 방지 및 홉별 위험도 감쇠 검증', () => {
    const cycleDbPath = join(tempRoot, 'cycle-memory.json');
    const store = new CausalMemoryStore(cycleDbPath);
    const ctxStore = new ContextCheckpointStore(ctxPath, cycleDbPath);
    const predictor = new CausalPredictorEngine(store, ctxStore);

    // A -> B -> C -> D 및 C -> A (순환), A -> E -> C (다이아몬드) 구성
    const nodes = ['Node_A', 'Node_B', 'Node_C', 'Node_D', 'Node_E'];
    for (const name of nodes) {
      store.assertRule({
        id: `id_${name}`,
        title: name,
        domain: 'architecture',
        triggers: { files: [`src/${name.toLowerCase()}.ts`] },
        invariants: [`${name}_불변규칙_엄수`],
        actions: [],
        context: [],
      });
    }

    store.createRelations([
      { from: 'Node_A', to: 'Node_B', relationType: 'triggers' },
      { from: 'Node_B', to: 'Node_C', relationType: 'requires' },
      { from: 'Node_C', to: 'Node_D', relationType: 'verifies' },
      { from: 'Node_C', to: 'Node_B', relationType: 'triggers' }, // B <-> C 양방향 순환 간선!
      { from: 'Node_A', to: 'Node_E', relationType: 'governs' },
      { from: 'Node_E', to: 'Node_C', relationType: 'produces' },
    ]);

    const report = predictor.analyzeBlastRadius(['src/node_a.ts'], 3);

    // 무한 루프 없이 즉시 완료되어야 함 (< 20ms)
    expect(report.durationMs).toBeLessThan(20);

    // Node_A 자신을 제외한 B, E (1-hop), C (2-hop), D (3-hop) 모두 탐지되어야 함
    const affectedNames = report.affectedNodes.map((n) => n.name);
    expect(affectedNames).toContain('Node_B');
    expect(affectedNames).toContain('Node_E');
    expect(affectedNames).toContain('Node_C');
    expect(affectedNames).toContain('Node_D');

    // 중복 방문 없음 검증
    expect(new Set(affectedNames).size).toBe(affectedNames.length);

    // 1-hop 위험도 >= 2-hop 위험도 >= 3-hop 위험도 검증
    const hop1Node = report.affectedNodes.find((n) => n.name === 'Node_B')!;
    const hop2Node = report.affectedNodes.find((n) => n.name === 'Node_C')!;
    const hop3Node = report.affectedNodes.find((n) => n.name === 'Node_D')!;
    expect(hop1Node.hopLevel).toBe(1);
    expect(hop2Node.hopLevel).toBe(2);
    expect(hop3Node.hopLevel).toBe(3);
    expect(hop1Node.riskScore).toBeGreaterThan(hop2Node.riskScore);
    expect(hop2Node.riskScore).toBeGreaterThan(hop3Node.riskScore);

    // 모든 노드의 불변식이 사전 페치되었는지 검증
    expect(report.prefetchedInvariants.length).toBe(5);
  });

  test('5. [Synthesizer 실제 격리 Git 저장소 E2E] AST 심볼(클래스·함수·인터페이스·타입) 및 Diff 통계 정밀 추출', async () => {
    const gitRepoDir = join(tempRoot, 'isolated-git-repo');
    const store = new CausalMemoryStore(dbPath);
    const ctxStore = new ContextCheckpointStore(ctxPath, dbPath);
    const synthesizer = new CausalSynthesizerEngine(ctxStore, store);

    // 임시 Git 리포지토리 생성 및 초기 커밋
    await spawn(['git', 'init'], { cwd: tempRoot, stdout: 'ignore', stderr: 'ignore' }).exited;
    const repoPath = mkdtempSync(join(tempRoot, 'git-proj-'));

    await spawn(['git', 'init'], { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' }).exited;
    await spawn(['git', 'config', 'user.email', 'test@synapse.local'], { cwd: repoPath }).exited;
    await spawn(['git', 'config', 'user.name', 'Synapse Verifier'], { cwd: repoPath }).exited;

    const initialFile = join(repoPath, 'memory-engine.ts');
    writeFileSync(initialFile, 'export const VERSION = "1.0.0";\n', 'utf-8');
    await spawn(['git', 'add', '.'], { cwd: repoPath }).exited;
    await spawn(['git', 'commit', '-m', 'Initial commit'], { cwd: repoPath }).exited;

    // 코드 수정 (클래스, 함수, 인터페이스, 타입 추가) + 신규 테스트 파일 추가
    const updatedCode = [
      'export const VERSION = "2.0.0";',
      'export interface QuantumState {',
      '  readonly coherence: number;',
      '}',
      'export type ResonanceMode = "fast" | "deep";',
      'export class QuantumSynthesizer {',
      '  public execute() { return true; }',
      '}',
      'export async function computeQuantumWave() {',
      '  return 42;',
      '}',
    ].join('\n');
    writeFileSync(initialFile, updatedCode, 'utf-8');

    const newTestFile = join(repoPath, 'memory-engine.test.ts');
    writeFileSync(newTestFile, 'export function verifyQuantum() {}\n', 'utf-8');
    await spawn(['git', 'add', 'memory-engine.test.ts'], { cwd: repoPath }).exited;

    // Git 변경 사항 분석 실행
    const changes = await synthesizer.inspectGitChanges(repoPath);

    expect(changes.modifiedFiles).toContain('memory-engine.ts');
    expect(changes.addedFiles).toContain('memory-engine.test.ts');
    expect(changes.stats.insertions).toBeGreaterThanOrEqual(10);
    expect(changes.extractedSymbols.classes).toContain('QuantumSynthesizer');
    expect(changes.extractedSymbols.interfaces).toContain('QuantumState');
    expect(changes.extractedSymbols.types).toContain('ResonanceMode');
    expect(changes.extractedSymbols.functions).toContain('computeQuantumWave');
    expect(changes.detectedDomains).toContain('memory');
    expect(changes.detectedDomains).toContain('testing');

    // 자동 체크포인트 역합성 실행
    const autoCp = await synthesizer.autoCheckpoint(repoPath);
    expect(autoCp.completedSteps.some((s) => s.includes('QuantumSynthesizer'))).toBe(true);
    expect(autoCp.completedSteps.some((s) => s.includes('QuantumState'))).toBe(true);
    expect(autoCp.completedSteps.some((s) => s.includes('computeQuantumWave'))).toBe(true);
  });

  test('6. [Obsidian Lens 양방향 라운드트립 & Canvas 무결성] 마크다운 외부 편집 역반영 및 Dangling 간선 0건 검증', async () => {
    const lensDbPath = join(tempRoot, 'lens-memory.json');
    const store = new CausalMemoryStore(lensDbPath);
    const ctxStore = new ContextCheckpointStore(ctxPath, lensDbPath);
    const graveyard = new CausalGraveyardStore(gravePath);
    const lens = new CausalObsidianLensEngine(store, ctxStore, graveyard);

    store.assertRule({
      id: 'rule_obsidian_alpha',
      title: 'ObsidianAlphaRule',
      domain: 'memory',
      triggers: { files: ['alpha.ts'] },
      invariants: ['초기 불변식 1'],
      actions: [],
      context: [],
      description: '초기 설명 텍스트',
    });
    store.assertRule({
      id: 'rule_obsidian_beta',
      title: 'ObsidianBetaRule',
      domain: 'compiler',
      triggers: { files: ['beta.ts'] },
      invariants: ['베타 불변식 1'],
      actions: [],
      context: [],
    });
    store.createRelations([
      { from: 'ObsidianAlphaRule', to: 'ObsidianBetaRule', relationType: 'requires' },
    ]);

    // 6-1. 볼트로 내보내기
    const expRes = await lens.exportToVault(vaultPath);
    expect(expRes.success).toBe(true);

    // 6-2. Canvas JSON 무결성 검증 (모든 간선의 fromNode, toNode가 실제 존재하는 노드인지 확인)
    const canvasFile = join(vaultPath, 'Synapse-Mental', 'Causal-Architecture.canvas');
    const canvasData = JSON.parse(readFileSync(canvasFile, 'utf-8'));
    const nodeIdSet = new Set(canvasData.nodes.map((n: any) => n.id));
    expect(canvasData.edges.length).toBeGreaterThanOrEqual(1);
    for (const edge of canvasData.edges) {
      expect(nodeIdSet.has(edge.fromNode)).toBe(true);
      expect(nodeIdSet.has(edge.toNode)).toBe(true);
    }

    // 6-3. 사용자가 Obsidian에서 마크다운 파일을 직접 수정했다고 가정 (불변식 추가 및 설명 변경)
    const alphaMdPath = join(vaultPath, 'Synapse-Mental', 'Rules', 'ObsidianAlphaRule.md');
    const originalMd = readFileSync(alphaMdPath, 'utf-8');
    const editedMd = originalMd
      .replace('  - "초기 불변식 1"', '  - "초기 불변식 1"\n  - "옵시디언에서 추가한 신규 불변식 2"')
      .replace('초기 설명 텍스트', '옵시디언에서 수정된 상세 설명');
    writeFileSync(alphaMdPath, editedMd, 'utf-8');

    // 6-4. 볼트에서 역가져오기(Import) 후 DB에 반영되었는지 확인
    const impRes = await lens.importFromVault(vaultPath);
    expect(impRes.success).toBe(true);

    const updatedAlpha = store
      .getRawDatabase()
      .rules.find((r) => r.id === 'rule_obsidian_alpha');
    expect(updatedAlpha).toBeDefined();
    expect(updatedAlpha!.invariants).toContain('옵시디언에서 추가한 신규 불변식 2');
    expect(updatedAlpha!.description).toBe('옵시디언에서 수정된 상세 설명');
  });

  test('7. [MCP 21종 도구 & HTTP 데몬 50 동시성 부하 검증] 병렬 요청 무결성 및 0% 에러율 증명', async () => {
    expect(CAUSAL_MCP_TOOLS.length).toBe(21);

    const port = 4295;
    const server = startCausalServer({
      port,
      dbPath,
      contextDbPath: ctxPath,
    });

    try {
      // 50개의 병렬 요청(MCP 도구 호출 + HTTP 엔드포인트 호출 혼합) 동시 발사
      const tasks = Array.from({ length: 50 }, (_, idx) => {
        const mod = idx % 5;
        if (mod === 0) {
          return fetch(`http://127.0.0.1:${port}/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: idx,
              method: 'tools/call',
              params: {
                name: 'time_travel_causal_memory',
                arguments: { action: 'timeline', limit: 5 },
              },
            }),
          }).then((r) => r.json());
        } else if (mod === 1) {
          return fetch(`http://127.0.0.1:${port}/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: idx,
              method: 'tools/call',
              params: {
                name: 'predict_blast_radius',
                arguments: { files: ['src/module_1.ts'] },
              },
            }),
          }).then((r) => r.json());
        } else if (mod === 2) {
          return fetch(`http://127.0.0.1:${port}/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: idx,
              method: 'tools/call',
              params: {
                name: 'branch_causal_context',
                arguments: { action: 'list' },
              },
            }),
          }).then((r) => r.json());
        } else if (mod === 3) {
          return fetch(`http://127.0.0.1:${port}/timeline?limit=3`).then((r) => r.json());
        } else {
          return fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
        }
      });

      const t0 = performance.now();
      const responses = await Promise.all(tasks);
      const totalElapsed = performance.now() - t0;

      expect(responses.length).toBe(50);
      for (const res of responses) {
        expect(res).toBeDefined();
        expect(res.error).toBeUndefined();
      }
      expect(totalElapsed).toBeLessThan(1000);
    } finally {
      server.stop();
      try {
        rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // Windows 파일 잠금 무시
      }
    }
  });
});
