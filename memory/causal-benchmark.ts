import { CausalMemoryStore, type CausalMemoryDatabase, type CausalRelation, type CausalRule } from './causal-store';
import { startCausalServer } from './causal-server';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';

export interface OverloadBenchmarkConfig {
  readonly ruleScale: number;
  readonly relationScale: number;
  readonly concurrency: number;
  readonly totalRequests: number;
  readonly fileInputScale: number;
  readonly crudIterations: number;
}

export interface ScenarioMetrics {
  readonly name: string;
  readonly passed: boolean;
  readonly details: Record<string, string | number>;
}

export interface OverloadBenchmarkReport {
  readonly timestamp: string;
  readonly config: OverloadBenchmarkConfig;
  readonly allPassed: boolean;
  readonly totalDurationMs: number;
  readonly scenarios: readonly ScenarioMetrics[];
}

function calcPercentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx] * 1000) / 1000;
}

/**
 * 대규모 합성 인과율 데이터베이스 생성기 (10,000 Rules + 20,000 Relations + 5-Hop & Circular Chains)
 */
export function generateSyntheticDatabase(ruleCount: number, relationCount: number): CausalMemoryDatabase {
  const domains = [
    'Project_POE2_AutoFilter',
    'Project_Vesper_DSP',
    'Project_Synapse_Kit',
    'BioPhys_Research_And_Architecture',
    'Hardware_And_PCB',
    'Knowledge_Base',
  ];

  const rules: CausalRule[] = [
    {
      id: 'rule-always-1',
      domain: 'User_Preferences_And_Rules',
      title: 'Global_Preference_1',
      triggers: { alwaysActive: true },
      invariants: ['항상 한국어 우선 출력', 'bun 필수 사용'],
      actions: [],
      context: [],
    },
    {
      id: 'rule-always-2',
      domain: 'User_Preferences_And_Rules',
      title: 'Global_Preference_2',
      triggers: { alwaysActive: true },
      invariants: ['console.log 디버그 코드 금지', '하드코딩 금지'],
      actions: [],
      context: [],
    },
    {
      id: 'rule-always-3',
      domain: 'User_Preferences_And_Rules',
      title: 'Global_Preference_3',
      triggers: { alwaysActive: true },
      invariants: ['100% 순수 Rust 백엔드 원칙'],
      actions: [],
      context: [],
    },
    {
      id: 'rule-always-4',
      domain: 'User_Preferences_And_Rules',
      title: 'Global_Preference_4',
      triggers: { alwaysActive: true },
      invariants: ['검증 최우선 원칙 준수'],
      actions: [],
      context: [],
    },
  ];

  for (let i = 4; i < ruleCount; i++) {
    const dom = domains[i % domains.length];
    const moduleIdx = i % 500;
    rules.push({
      id: `rule-synth-${i}`,
      domain: dom,
      title: `Synth_Node_${i}`,
      triggers: {
        files: [`packages/mod_${moduleIdx}/src/file_${i}.rs`],
        keywords: [`kw_${i}`, `topic_${i % 250}`],
        commands: i % 20 === 0 ? ['build'] : i % 20 === 1 ? ['release'] : ['check'],
      },
      invariants: [`불변 계약 #${i}: 메모리 안전성 및 타입 경계 보장`],
      actions: [`1. 모듈 ${moduleIdx} 정적 검증 수행`],
      context: [`합성 벤치마크 노드 컨텍스트 데이터 #${i}`],
      lastVerified: '2026-11-01',
    });
  }

  const relations: CausalRelation[] = [];

  // 5-Hop 다중 체인 및 순환 참조(Circular Loop) 테스트용 간선 구성
  relations.push(
    { from: 'Synth_Node_10', to: 'Synth_Node_11', relationType: 'triggers_hop_1' },
    { from: 'Synth_Node_11', to: 'Synth_Node_12', relationType: 'triggers_hop_2' },
    { from: 'Synth_Node_12', to: 'Synth_Node_13', relationType: 'triggers_hop_3' },
    { from: 'Synth_Node_13', to: 'Synth_Node_14', relationType: 'triggers_hop_4' },
    { from: 'Synth_Node_14', to: 'Synth_Node_15', relationType: 'triggers_hop_5' },
    { from: 'Synth_Node_15', to: 'Synth_Node_10', relationType: 'circular_feedback_edge' }
  );

  for (let j = relations.length; j < relationCount; j++) {
    const fromIdx = 4 + (j % (ruleCount - 10));
    const toIdx = fromIdx + 1 + (j % 5);
    relations.push({
      from: `Synth_Node_${fromIdx}`,
      to: `Synth_Node_${toIdx}`,
      relationType: 'causal_impact_on',
    });
  }

  return {
    version: '2.1.0',
    updatedAt: new Date().toISOString(),
    totalRules: rules.length,
    totalRelations: relations.length,
    rules,
    relations,
  };
}

/**
 * 차세대 인과율 메모리(Causal Memory 2.1) 4대 차원 과부하 벤치마크 실행기
 */
export async function executeOverloadBenchmark(
  customConfig?: Partial<OverloadBenchmarkConfig>,
  silent: boolean = false
): Promise<OverloadBenchmarkReport> {
  const config: OverloadBenchmarkConfig = {
    ruleScale: customConfig?.ruleScale ?? 10000,
    relationScale: customConfig?.relationScale ?? 20000,
    concurrency: customConfig?.concurrency ?? 50,
    totalRequests: customConfig?.totalRequests ?? 5000,
    fileInputScale: customConfig?.fileInputScale ?? 10000,
    crudIterations: customConfig?.crudIterations ?? 5000,
  };

  const log = (msg: string) => {
    if (!silent) process.stdout.write(msg);
  };

  const benchStart = performance.now();
  const scenarios: ScenarioMetrics[] = [];

  const isExtreme = config.ruleScale >= 100000;
  const modeTitle = isExtreme
    ? '옵션 2 극한 한계 돌파 스트레스 벤치마크 (Stress Max)'
    : '옵션 1 표준 과부하 스트레스 벤치마크';

  const sloP50Ms = isExtreme ? 2.0 : 0.8;
  const sloP99Ms = isExtreme ? 5.0 : 1.5;
  const sloRps = isExtreme ? 3000 : 5000;
  const sloHopMs = isExtreme ? 100.0 : 30.0;
  const sloHeapDeltaMB = isExtreme ? 8.0 : 3.0;

  log(`\n${BOLD}${CYAN}🔥 [Causal Memory 2.1] ${modeTitle} 가동${RESET}\n`);
  log(
    `${GRAY}• 스펙: 규칙 ${config.ruleScale.toLocaleString()}개 | 간선 ${config.relationScale.toLocaleString()}개 | 동시성 ${config.concurrency} 워커 | 요청 ${config.totalRequests.toLocaleString()}회 | 변경파일 ${config.fileInputScale.toLocaleString()}개${RESET}\n`
  );
  log(`${GRAY}${'━'.repeat(84)}${RESET}\n\n`);

  // =========================================================================
  // 시나리오 1: 대규모 데이터 적재 및 O(1) 공명 레이턴시
  // =========================================================================
  log(`${BOLD}${YELLOW}📌 [시나리오 1] ${config.ruleScale.toLocaleString()}개 규칙 & ${config.relationScale.toLocaleString()}개 간선 적재 및 O(1) 역인덱스 공명 테스트${RESET}\n`);

  const genStart = performance.now();
  const synthDb = generateSyntheticDatabase(config.ruleScale, config.relationScale);
  const genDurationMs = Math.round((performance.now() - genStart) * 100) / 100;

  const indexStart = performance.now();
  const scaleStore = new CausalMemoryStore(undefined, synthDb);
  const indexBuildMs = Math.round((performance.now() - indexStart) * 100) / 100;

  const queryLatencies: number[] = [];
  let lastResonance = scaleStore.queryResonance({ keywords: ['kw_10'] });

  for (let i = 0; i < 1000; i++) {
    const targetKw = `kw_${10 + (i % 5000)}`;
    const qStart = performance.now();
    lastResonance = scaleStore.queryResonance({ keywords: [targetKw] });
    queryLatencies.push(performance.now() - qStart);
  }

  queryLatencies.sort((a, b) => a - b);
  const s1P50 = calcPercentile(queryLatencies, 50);
  const s1P95 = calcPercentile(queryLatencies, 95);
  const s1P99 = calcPercentile(queryLatencies, 99);
  const s1Passed = s1P50 <= sloP50Ms && s1P99 <= sloP99Ms && parseFloat(lastResonance.tokenDietSavingsRatio) >= 99.0;

  scenarios.push({
    name: '시나리오 1: 대규모 볼륨 적재 및 O(1) 공명 쿼리',
    passed: s1Passed,
    details: {
      totalRules: config.ruleScale,
      totalRelations: config.relationScale,
      syntheticGenMs: genDurationMs,
      indexBuildMs,
      p50Ms: s1P50,
      p95Ms: s1P95,
      p99Ms: s1P99,
      tokenSavings: lastResonance.tokenDietSavingsRatio,
    },
  });

  log(`  • 역인덱스 구축 시간 : ${BOLD}${GREEN}${indexBuildMs}ms${RESET} (${config.ruleScale.toLocaleString()} Rules + ${config.relationScale.toLocaleString()} Relations)\n`);
  log(`  • 공명 쿼리 레이턴시 : ${BOLD}p50=${s1P50}ms | p95=${s1P95}ms | p99=${s1P99}ms${RESET} (목표: p50≤${sloP50Ms}ms, p99≤${sloP99Ms}ms)\n`);
  log(`  • 토큰 절감률        : ${BOLD}${GREEN}${lastResonance.tokenDietSavingsRatio}${RESET} (${lastResonance.matchedCount}/${config.ruleScale}개만 정밀 공명)\n`);
  log(`  • 판정               : ${s1Passed ? `${BOLD}${GREEN}✅ PASS${RESET}` : `${BOLD}${RED}❌ FAIL${RESET}`}\n\n`);

  // =========================================================================
  // 시나리오 2: 고동시성(50 Workers) 5,000회 연속 HTTP & MCP 데몬 폭격 테스트
  // =========================================================================
  log(`${BOLD}${YELLOW}📌 [시나리오 2] 동시 ${config.concurrency} 클라이언트 × ${config.totalRequests.toLocaleString()}회 HTTP/MCP 데몬 폭격 테스트${RESET}\n`);

  const benchPort = 4288;
  const server = startCausalServer({ port: benchPort });

  let successCount = 0;
  let errorCount = 0;
  const httpLatencies: number[] = [];
  const requestsPerWorker = Math.floor(config.totalRequests / config.concurrency);

  for (let w = 0; w < 10; w++) {
    await fetch(`http://127.0.0.1:${benchPort}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: ['poe2'], format: 'compact' }),
    });
  }

  const concStart = performance.now();

  try {
    const workerPromises = Array.from({ length: config.concurrency }, async (_, workerId) => {
      const sampleQueries = [
        { keywords: ['poe2', 'updater'], format: 'compact' },
        { files: ['crates/vesper-audio-core/src/lib.rs'], format: 'compact' },
        { keywords: ['synapse', 'causal'], format: 'compact' },
        { keywords: ['pcb', 'kicad'], format: 'compact' },
      ];

      for (let r = 0; r < requestsPerWorker; r++) {
        const qPayload = sampleQueries[(workerId + r) % sampleQueries.length];
        const reqT0 = performance.now();
        try {
          const resp = await fetch(`http://127.0.0.1:${benchPort}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(qPayload),
          });
          if (resp.ok) {
            await resp.text();
            successCount++;
          } else {
            errorCount++;
          }
        } catch {
          errorCount++;
        }
        httpLatencies.push(performance.now() - reqT0);
      }
    });

    await Promise.all(workerPromises);
  } finally {
    server.stop();
  }

  const concTotalSec = (performance.now() - concStart) / 1000;
  const rps = Math.round(successCount / concTotalSec);
  httpLatencies.sort((a, b) => a - b);
  const s2P50 = calcPercentile(httpLatencies, 50);
  const s2P95 = calcPercentile(httpLatencies, 95);
  const s2P99 = calcPercentile(httpLatencies, 99);
  const s2Passed = errorCount === 0 && successCount === config.totalRequests && rps >= sloRps;

  scenarios.push({
    name: '시나리오 2: 고동시성 데몬 처리량',
    passed: s2Passed,
    details: {
      concurrency: config.concurrency,
      totalRequests: config.totalRequests,
      successCount,
      errorCount,
      durationSec: Math.round(concTotalSec * 100) / 100,
      rps,
      httpP50Ms: s2P50,
      httpP95Ms: s2P95,
      httpP99Ms: s2P99,
    },
  });

  log(`  • 총 처리 요청       : ${BOLD}${GREEN}${successCount.toLocaleString()} / ${config.totalRequests.toLocaleString()} 성공${RESET} (오류율: ${errorCount === 0 ? '0.00%' : errorCount})\n`);
  log(`  • 초당 처리량 (RPS)  : ${BOLD}${CYAN}${rps.toLocaleString()} req/sec${RESET} (총 소요: ${concTotalSec.toFixed(2)}s, 목표: ≥${sloRps.toLocaleString()} req/s)\n`);
  log(`  • HTTP 왕복 레이턴시 : ${BOLD}p50=${s2P50}ms | p95=${s2P95}ms | p99=${s2P99}ms${RESET}\n`);
  log(`  • 판정               : ${s2Passed ? `${BOLD}${GREEN}✅ PASS${RESET}` : `${BOLD}${RED}❌ FAIL${RESET}`}\n\n`);

  // =========================================================================
  // 시나리오 3: 대규모 변경 파일 동시 입력 & 5-Hop 다중 인과 전파 / 순환 참조 방어
  // =========================================================================
  log(`${BOLD}${YELLOW}📌 [시나리오 3] ${config.fileInputScale.toLocaleString()}개 변경 파일 동시 입력 & 5-Hop 다중 체인/순환 참조 스트레스${RESET}\n`);

  const massiveFiles: string[] = [];
  for (let f = 0; f < config.fileInputScale; f++) {
    massiveFiles.push(`services/microservice_${f % 100}/src/handler_${f}.ts`);
  }
  massiveFiles[Math.floor(config.fileInputScale / 2)] = 'packages/mod_10/src/file_10.rs';

  const hopStart = performance.now();
  const multiHopRes = scaleStore.queryResonance({
    files: massiveFiles,
    propagateRelations: true,
    maxHops: 5,
  });
  const hopDurationMs = Math.round((performance.now() - hopStart) * 100) / 100;

  const matchedTitles = new Set(multiHopRes.resonanceRules.map((r) => r.title));
  const all5HopsPropagated =
    matchedTitles.has('Synth_Node_10') &&
    matchedTitles.has('Synth_Node_11') &&
    matchedTitles.has('Synth_Node_12') &&
    matchedTitles.has('Synth_Node_13') &&
    matchedTitles.has('Synth_Node_14') &&
    matchedTitles.has('Synth_Node_15');

  const s3Passed = all5HopsPropagated && hopDurationMs <= sloHopMs;

  scenarios.push({
    name: '시나리오 3: 대규모 파일 & 5-Hop 다중 인과 전파',
    passed: s3Passed,
    details: {
      inputFilesCount: config.fileInputScale,
      maxHops: 5,
      traversalDurationMs: hopDurationMs,
      matchedRulesCount: multiHopRes.matchedCount,
      activeRelationsCount: multiHopRes.activeRelations.length,
      all5HopsResolved: all5HopsPropagated ? 'YES (Circular Loop Safe)' : 'NO',
      tokenSavings: multiHopRes.tokenDietSavingsRatio,
    },
  });

  log(`  • 대량 파일 + 5-Hop 소요 : ${BOLD}${GREEN}${hopDurationMs}ms${RESET} (목표: ≤${sloHopMs}ms)\n`);
  log(`  • 5단계 연쇄 전파 검증  : ${BOLD}${all5HopsPropagated ? `${GREEN}Node_10 ➔ Node_15 (5-Hop) 및 순환 참조 방어 100% 성공` : `${RED}실패`}${RESET}\n`);
  log(`  • 정밀 격리 절감률      : ${BOLD}${GREEN}${multiHopRes.tokenDietSavingsRatio}${RESET} (${multiHopRes.matchedCount}/${config.ruleScale}개만 활성화)\n`);
  log(`  • 판정                  : ${s3Passed ? `${BOLD}${GREEN}✅ PASS${RESET}` : `${BOLD}${RED}❌ FAIL${RESET}`}\n\n`);

  // =========================================================================
  // 시나리오 4: 연속 CRUD 트랜잭션 내구도 및 힙 메모리 누수 감사
  // =========================================================================
  log(`${BOLD}${YELLOW}📌 [시나리오 4] ${config.crudIterations.toLocaleString()}회 연속 CRUD 트랜잭션 & 힙 메모리 누수 감사 (Zero-Leak Audit)${RESET}\n`);

  if (typeof Bun !== 'undefined' && typeof Bun.gc === 'function') {
    Bun.gc(true);
  }
  const baseMem = process.memoryUsage();
  const baseHeapMB = baseMem.heapUsed / (1024 * 1024);

  const crudStore = new CausalMemoryStore(undefined, {
    version: '2.1.0',
    updatedAt: new Date().toISOString(),
    totalRules: 0,
    totalRelations: 0,
    rules: [],
    relations: [],
  });

  const crudStart = performance.now();
  for (let c = 0; c < config.crudIterations; c++) {
    const tempName = `Ephemeral_Entity_${c % 50}`;
    crudStore.createEntities(
      [
        {
          name: tempName,
          entityType: 'StressTest',
          observations: [`절대 규칙 #${c}`, `1. 실행 단계 #${c}`],
        },
      ],
      false
    );
    crudStore.addObservations(
      [{ entityName: tempName, contents: [`추가 관찰 #${c}`] }],
      false
    );
    crudStore.queryResonance({ keywords: [tempName] });
    crudStore.deleteEntities([tempName], false);
  }
  const crudDurationMs = Math.round((performance.now() - crudStart) * 100) / 100;

  if (typeof Bun !== 'undefined' && typeof Bun.gc === 'function') {
    Bun.gc(true);
  }
  const afterMem = process.memoryUsage();
  const afterHeapMB = afterMem.heapUsed / (1024 * 1024);
  const rssMB = Math.round((afterMem.rss / (1024 * 1024)) * 100) / 100;
  const heapDeltaMB = Math.round(Math.max(0, afterHeapMB - baseHeapMB) * 100) / 100;
  const s4Passed = heapDeltaMB <= sloHeapDeltaMB && crudStore.getAllRules().length === 0;

  scenarios.push({
    name: '시나리오 4: 연속 CRUD 내구도 및 힙 누수 감사',
    passed: s4Passed,
    details: {
      crudCycles: config.crudIterations,
      totalOperations: config.crudIterations * 4,
      durationMs: crudDurationMs,
      baseHeapMB: Math.round(baseHeapMB * 100) / 100,
      afterHeapMB: Math.round(afterHeapMB * 100) / 100,
      heapDeltaMB,
      rssMB,
      residualRules: crudStore.getAllRules().length,
    },
  });

  log(`  • 총 수행 연산 수    : ${BOLD}${(config.crudIterations * 4).toLocaleString()}회 CRUD 연산${RESET} (소요: ${crudDurationMs}ms)\n`);
  log(`  • 힙 메모리 변화량   : ${BOLD}${GREEN}Δ ${heapDeltaMB} MB${RESET} (시작: ${baseHeapMB.toFixed(2)}MB ➔ 종료: ${afterHeapMB.toFixed(2)}MB, 목표: ≤${sloHeapDeltaMB.toFixed(1)}MB)\n`);
  log(`  • 프로세스 RSS 점유  : ${BOLD}${rssMB} MB${RESET}\n`);
  log(`  • 판정               : ${s4Passed ? `${BOLD}${GREEN}✅ PASS${RESET}` : `${BOLD}${RED}❌ FAIL${RESET}`}\n\n`);

  const totalDurationMs = Math.round((performance.now() - benchStart) * 100) / 100;
  const allPassed = scenarios.every((s) => s.passed);

  log(`${GRAY}${'━'.repeat(84)}${RESET}\n`);
  log(
    `${BOLD}${allPassed ? GREEN : RED}🏆 [최종 벤치마크 결과] 4대 과부하 차원 전수 ${allPassed ? 'ALL PASS (100% 합격)' : '일부 미달'} (총 소요 시간: ${(totalDurationMs / 1000).toFixed(2)}s)${RESET}\n\n`
  );

  return {
    timestamp: new Date().toISOString(),
    config,
    allPassed,
    totalDurationMs,
    scenarios,
  };
}
