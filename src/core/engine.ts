import { spawn } from 'bun';
import type { CheckResult, SynapseConfig, SynapseOptions } from '../types';
import { analyzeCausalGraph } from '../memory/causal-graph';
import { reportResults } from './reporter';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';

/**
 * 플러그인 단위 검사 실행기
 */
async function runPluginChecker(
  plugin: SynapseConfig['plugins'][number],
  isActive: boolean,
  rootDir: string,
  options: SynapseOptions
): Promise<CheckResult> {
  if (!isActive) {
    return {
      name: plugin.name,
      title: plugin.title,
      status: 'skipped',
      durationMs: 0,
      details: '인과 메모리 추론에 의해 검사 생략됨',
    };
  }

  try {
    return await plugin.check({ rootDir, options });
  } catch (error) {
    return {
      name: plugin.name,
      title: plugin.title,
      status: 'error',
      durationMs: 0,
      details: `플러그인 실행 중 치명적 오류 발생: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 시냅스 검사 엔진 구동 루틴
 */
export async function executeChecks(config: SynapseConfig, options: SynapseOptions): Promise<number> {
  const rootDir = config.rootDir || process.cwd();
  const startTime = performance.now();

  // 1. AI 인과율 메모리 분석
  const decision = await analyzeCausalGraph(rootDir, config.plugins, options);

  // 2. 등록된 모든 플러그인 동시 병렬 실행
  const results = await Promise.all(
    config.plugins.map((plugin) =>
      runPluginChecker(plugin, decision.activePluginNames.has(plugin.name), rootDir, options)
    )
  );

  const totalDurationMs = performance.now() - startTime;

  // 3. 결과 리포팅
  reportResults(decision, results, totalDurationMs, options);

  const hasError = results.some((r) => r.status === 'error');
  return hasError ? 1 : 0;
}

/**
 * 시냅스 초고속 병렬 빌드 엔진 구동 루틴
 */
export async function executeBuild(config: SynapseConfig): Promise<number> {
  const rootDir = config.rootDir || process.cwd();
  const tracks = config.buildTracks || [];

  if (tracks.length === 0) {
    process.stderr.write(`${RED}❌ 등록된 빌드 트랙(buildTracks)이 없습니다. synapse.config.ts를 확인해 주세요.${RESET}\n`);
    return 1;
  }

  const startTime = performance.now();
  const line = '━'.repeat(68);

  process.stdout.write(`\n${BOLD}${CYAN}⚡ [Synapse Kit] ${tracks.length}개 트랙 동시 병렬 빌드 시작${RESET}\n`);
  process.stdout.write(`${GRAY}${line}${RESET}\n`);

  const taskPromises = tracks.map(async (track) => {
    const trackStart = performance.now();
    const proc = spawn(track.command, {
      cwd: track.cwd || rootDir,
      stdout: 'inherit',
      stderr: 'inherit',
    });

    const exitCode = await proc.exited;
    const durationMs = performance.now() - trackStart;
    return {
      name: track.name,
      durationMs,
      exitCode,
    };
  });

  const taskResults = await Promise.all(taskPromises);
  const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);
  const hasFailed = taskResults.some((t) => t.exitCode !== 0);

  process.stdout.write(`${GRAY}${line}${RESET}\n`);
  for (const t of taskResults) {
    const sec = (t.durationMs / 1000).toFixed(2);
    const badge = t.exitCode === 0 ? `${GREEN}✅ 완료 (${sec}s)${RESET}` : `${RED}❌ 실패 (${sec}s)${RESET}`;
    process.stdout.write(` • ${BOLD}${t.name.padEnd(40, ' ')}${RESET} : ${badge}\n`);
  }
  process.stdout.write(`${GRAY}${line}${RESET}\n`);

  if (!hasFailed) {
    process.stdout.write(
      `${BOLD}${GREEN}✨ 병렬 빌드 완료:${RESET} 전체 ${tracks.length}개 트랙 성공 ${GRAY}(총 소요 시간: ${totalDuration}초)${RESET}\n\n`
    );
    return 0;
  } else {
    process.stdout.write(`${BOLD}${RED}🚨 병렬 빌드 실패: 하나 이상의 트랙에서 오류가 발생했습니다.${RESET}\n\n`);
    return 1;
  }
}
