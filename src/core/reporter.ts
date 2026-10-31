import type { CausalDecision, CheckResult, SynapseOptions } from '../types';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';

/**
 * 프로젝트 시냅스(Project Synapse) 프레임워크 대시보드 리포터
 */
export function reportResults(
  decision: CausalDecision,
  results: readonly CheckResult[],
  totalDurationMs: number,
  options: SynapseOptions
): void {
  const totalSeconds = (totalDurationMs / 1000).toFixed(2);
  const errorResults = results.filter((r) => r.status === 'error');
  const warningResults = results.filter((r) => r.status === 'warning');
  const skippedResults = results.filter((r) => r.status === 'skipped');
  const successResults = results.filter((r) => r.status === 'success');

  // 1. AI 에이전트 연동용 초고효율 압축 JSON 모드 (--agent 또는 --compact)
  if (options.agentMode || options.compactMode) {
    const isCleanPass = errorResults.length === 0 && warningResults.length === 0;

    // A. 에러/경고가 전무한 완전 통과 시: 극단적 압축 (단 10~20 토큰)
    if (isCleanPass && options.compactMode) {
      const minimalPayload = {
        ok: true,
        duration: `${totalSeconds}s`,
        skipped: skippedResults.map((r) => r.name),
      };
      process.stdout.write(`${JSON.stringify(minimalPayload)}\n`);
      return;
    }

    // B. 구조화된 지능형 다이어트 페이로드 (불필요한 파일 경로 배열 및 스킵 객체 제거)
    const payload: Record<string, unknown> = {
      ok: errorResults.length === 0,
      duration: `${totalSeconds}s`,
      summary: {
        pass: successResults.length,
        warn: warningResults.length,
        err: errorResults.length,
        skip: skippedResults.length,
      },
    };

    if (errorResults.length > 0) {
      payload.errors = errorResults.map((r) => ({
        plugin: r.name,
        details: r.details,
        diagnostics: r.diagnostics,
      }));
    }

    if (warningResults.length > 0) {
      payload.warnings = warningResults.map((r) => ({
        plugin: r.name,
        details: r.details,
        diagnostics: r.diagnostics,
      }));
    }

    if (skippedResults.length > 0) {
      payload.skipped = skippedResults.map((r) => r.name);
    }

    // compactMode면 한 줄 minified JSON, 일반 agentMode면 인덴트 포맷
    const outputString = options.compactMode
      ? JSON.stringify(payload)
      : JSON.stringify(payload, null, 2);

    process.stdout.write(`${outputString}\n`);
    return;
  }

  // 2. 인간 개발자용 터미널 ANSI 대시보드 모드
  const line = '━'.repeat(68);
  process.stdout.write(`\n${BOLD}${CYAN}🧠 [Synapse Kit] AI-Native 통합 컴파일 & 검사 프레임워크${RESET}\n`);
  process.stdout.write(`${GRAY}${line}${RESET}\n`);
  process.stdout.write(`${GRAY}💡 인과 메모리 분석: ${decision.reason}${RESET}\n`);
  process.stdout.write(`${GRAY}${line}${RESET}\n`);

  for (const result of results) {
    const duration = (result.durationMs / 1000).toFixed(2);
    let statusBadge = '';

    switch (result.status) {
      case 'success':
        statusBadge = `${GREEN}✅ 통과 (${duration}s)${RESET}`;
        break;
      case 'skipped':
        statusBadge = `${GRAY}⏭️  스킵 (인과율 생략)${RESET}`;
        break;
      case 'warning':
        statusBadge = `${YELLOW}⚠️  경고 (${duration}s)${RESET}`;
        break;
      case 'error':
        statusBadge = `${RED}❌ 실패 (${duration}s)${RESET}`;
        break;
    }

    const titlePadded = result.title.padEnd(36, ' ');
    process.stdout.write(` • ${BOLD}${titlePadded}${RESET} : ${statusBadge}\n`);

    if (result.status !== 'skipped' && result.details) {
      process.stdout.write(`   ${GRAY}└─ ${result.details}${RESET}\n`);
    }

    if (result.diagnostics && result.diagnostics.length > 0) {
      for (const diag of result.diagnostics) {
        process.stdout.write(`   ${RED}▶ ${diag.message}${RESET}\n`);
      }
    }
  }

  process.stdout.write(`${GRAY}${line}${RESET}\n`);

  if (errorResults.length === 0) {
    process.stdout.write(
      `${BOLD}${GREEN}✨ 시냅스 검증 성공:${RESET} 0 Errors, ${warningResults.length} Warnings, ${skippedResults.length} Skipped ${GRAY}(총 소요 시간: ${totalSeconds}초)${RESET}\n\n`
    );
  } else {
    process.stdout.write(
      `${BOLD}${RED}🚨 시냅스 검증 실패:${RESET} ${errorResults.length}개 플러그인에서 결함이 감지되었습니다. ${GRAY}(총 소요 시간: ${totalSeconds}초)${RESET}\n\n`
    );
  }
}
