/**
 * Synapse Kit - Internationalization (i18n) Engine
 * 시스템 OS 로케일(또는 환경변수/CLI 플래그)을 자동 인식하여 한국어와 영어를 자동 분기합니다.
 */

export type SupportedLocale = 'ko' | 'en';

let currentLocale: SupportedLocale = 'en';

const MESSAGES = {
  ko: {
    cliTitle: '🧠 Synapse Kit - AI-Native 통합 컴파일, 빌드 & 패키징 프레임워크',
    cliUsage: '사용법:',
    cliCommands: '핵심 명령어:',
    cmdCheck: '등록된 플러그인 무결성 검증 (기본: AI 인과율 스마트 검사)',
    cmdBuild: '등록된 buildTracks 초고속 인과율 병렬 증분 빌드 (0초대 캐시)',
    cmdPackage: '단일 NSIS + zlib 고속 인스톨러 패키징 번들러',
    cmdSign: '인과율 암호화 서명 엔진 (Minisign / Ed25519)',
    cmdInit: '현재 디렉터리에 최적화된 synapse.config.ts 생성',
    cliOptions: '옵션:',
    optAll: '인과율 스킵을 끄고 전방위 강제 검사',
    optForce: '빌드/서명 시 인과율 캐시를 무시하고 강제 재실행',
    optAgent: 'AI 에이전트(Claude Code, Antigravity 등) 연동용 구조화된 JSON 출력',
    optCompact: 'AI 토큰 극단적 최소화 모드 (성공 시 단 11 토큰)',
    optInteractive: '오류 발생 시 프로세스를 일시정지하고 실시간 코드 수정 대기 (인과 핫픽스)',
    optWatch: '파일 변경 감지 백그라운드 모드',
    optLang: '출력 언어 강제 지정 (ko | en)',
    optHelp: '도움말 표시',
    optVersion: '버전 정보 표시',
    unknownCmd: '알 수 없는 명령어:',
    errPrefix: '🚨 오류:',
    configExists: '이미 설정 파일이 존재합니다:',
    configCreated: 'synapse.config.ts 템플릿이 성공적으로 생성되었습니다.',
    checkHeader: '🧠 [Synapse Kit] AI-Native 통합 컴파일 & 검사 프레임워크',
    causalAll: '인과 메모리 분석: 전체 검사 모드(--all) 요청: 모든 플러그인 검사기를 실행합니다.',
    causalDirty: (count: number, plugins: string) =>
      `인과 메모리 분석: 변경된 ${count}개 파일 인과 분석 완료: [${plugins}] 플러그인만 선별 실행합니다.`,
    causalClean: '인과 메모리 분석: 변경된 파일이 없습니다. 모든 검증 플러그인을 0.00초 스킵합니다.',
    checkPassed: '통과',
    checkSkipped: '생략 (인과율 0초 스킵)',
    checkFailed: '실패',
    checkSuccessSummary: (errs: number, warns: number, skips: number, sec: string) =>
      `✨ 시냅스 검증 성공: ${errs} Errors, ${warns} Warnings, ${skips} Skipped (총 소요 시간: ${sec}초)`,
    checkFailureSummary: (errs: number, warns: number, sec: string) =>
      `❌ 시냅스 검증 실패: ${errs}개 검사기 오류 발생 (총 소요 시간: ${sec}초)`,
    interactivePause: '⏸️  에러 발생으로 일시정지되었습니다. 파일을 수정한 뒤 저장하면 0.05초 만에 핫 재검증합니다. (종료: Ctrl+C)',
    interactiveReload: '⚡ 파일 변경 감지! 인메모리 핫 재검증을 즉시 가동합니다...',
    buildHeader: '⚡ [Synapse Build] 인과율 멀티트랙 병렬 증분 빌더',
    buildSkipped: '⏭️ 소스 미변경 감지: 0.00초 스킵',
    buildSuccess: '✅ 빌드 완결',
    buildFailed: '❌ 빌드 실패',
    buildAllUpToDate: '✨ 모든 빌드 트랙이 최신 상태입니다. (전체 빌드 생략: 0.00초)',
    buildComplete: (sec: string) => `✨ 전체 인과율 증분 빌드 완결 (총 소요 시간: ${sec}초)`,
    packageHeader: '📦 [Synapse Package] 초고속 인스톨러 번들러',
    packageSuccess: (sec: string) => `✨ 인스톨러 패키징 성공 (소요 시간: ${sec}초)`,
    packageFailed: (sec: string) => `❌ 인스톨러 패키징 실패 (소요 시간: ${sec}초)`,
    signHeader: '🔐 [Synapse Sign] 인과율 암호화 서명 파이프라인',
    signSkipped: '⏭️ 인스톨러 바이너리 해시 불변: 서명 0.00초 스킵',
    signSuccess: (sec: string) => `✨ 인스톨러 Ed25519 디지털 서명 발행 완료 (소요 시간: ${sec}초)`,
    signFailed: (sec: string) => `❌ 서명 생성 실패 (소요 시간: ${sec}초)`,
    statusSuccess: '통과',
    statusSkipped: '스킵 (인과율 생략)',
    statusWarning: '경고',
    statusError: '실패',
    causalAnalysis: '인과 메모리 분석',
    trackSkipped: '스킵 [인과율 캐시 적중]',
    trackComplete: '빌드 완료',
    trackFailed: '빌드 실패',
    noBuildTracks: '❌ 등록된 빌드 트랙(buildTracks)이 없습니다. synapse.config.ts를 확인해 주세요.',
    buildSuccessSummary: (tracks: number, sec: string) =>
      `✨ 인과율 병렬 빌드 성공: 전체 ${tracks}개 트랙 완료 (총 소요 시간: ${sec}초)`,
    buildFailureSummary: '🚨 병렬 빌드 실패: 하나 이상의 트랙에서 오류가 발생했습니다.',
    packagingPreBuild: 'ℹ️  사전 아티팩트 인과율 빌드 확인 중...',
    packagingStart: '🚀 Tauri 인스톨러 번들링 시작...',
    packagingGuide: '⚠️  [패키징 가이드] tauri.conf.json의 targets가 "all"로 설정되어 있습니다.\n   ↳ WiX MSI 중복 빌드로 시간이 소요됩니다. targets: ["nsis"] 설정을 권장합니다.',
  },
  en: {
    cliTitle: '🧠 Synapse Kit - AI-Native Unified Compiler, Build & Packaging Framework',
    cliUsage: 'Usage:',
    cliCommands: 'Core Commands:',
    cmdCheck: 'Run multi-track verification with AI causal smart skipping',
    cmdBuild: 'Fast incremental multi-track build (0.00s skip on unchanged sources)',
    cmdPackage: 'Single NSIS + zlib high-speed installer packager',
    cmdSign: 'Causal cryptographic signing engine (Minisign / Ed25519)',
    cmdInit: 'Generate optimized synapse.config.ts template in current directory',
    cliOptions: 'Options:',
    optAll: 'Disable causal skipping and force full verification',
    optForce: 'Ignore cache and force re-execution of build and signing',
    optAgent: 'Structured JSON output for AI coding agents (Claude, Cursor, Antigravity)',
    optCompact: 'Extreme token-diet mode for AI agents (only 11 tokens on pass)',
    optInteractive: 'Pause on error and wait for live code modification (0.05s live-fix)',
    optWatch: 'Background file-watcher mode',
    optLang: 'Force display language (ko | en)',
    optHelp: 'Display help information',
    optVersion: 'Display version information',
    unknownCmd: 'Unknown command:',
    errPrefix: '🚨 Error:',
    configExists: 'Configuration file already exists:',
    configCreated: 'synapse.config.ts template created successfully.',
    checkHeader: '🧠 [Synapse Kit] AI-Native Unified Compiler & Verification Framework',
    causalAll: 'Causal Analysis: Full check requested (--all): Executing all registered checkers.',
    causalDirty: (count: number, plugins: string) =>
      `Causal Analysis: ${count} modified files detected: Running [${plugins}] plugins only.`,
    causalClean: 'Causal Analysis: No source changes detected. All checkers skipped in 0.00s.',
    checkPassed: 'PASSED',
    checkSkipped: 'SKIPPED (Causal 0.00s)',
    checkFailed: 'FAILED',
    checkSuccessSummary: (errs: number, warns: number, skips: number, sec: string) =>
      `✨ Verification Passed: ${errs} Errors, ${warns} Warnings, ${skips} Skipped (Total: ${sec}s)`,
    checkFailureSummary: (errs: number, warns: number, sec: string) =>
      `❌ Verification Failed: ${errs} check failures (Total: ${sec}s)`,
    interactivePause: '⏸️  Paused due to errors. Save modified files to hot-recheck in 0.05s. (Exit: Ctrl+C)',
    interactiveReload: '⚡ File changes detected! Launching in-memory hot-recheck...',
    buildHeader: '⚡ [Synapse Build] Causal Multi-Track Parallel Incremental Builder',
    buildSkipped: '⏭️ Unchanged source detected: 0.00s skipped',
    buildSuccess: '✅ Build completed',
    buildFailed: '❌ Build failed',
    buildAllUpToDate: '✨ All build tracks are up-to-date. (Skipped all tracks: 0.00s)',
    buildComplete: (sec: string) => `✨ Causal incremental build completed (Total: ${sec}s)`,
    packageHeader: '📦 [Synapse Package] High-Speed Installer Bundler',
    packageSuccess: (sec: string) => `✨ Installer package bundled successfully (Elapsed: ${sec}s)`,
    packageFailed: (sec: string) => `❌ Installer packaging failed (Elapsed: ${sec}s)`,
    signHeader: '🔐 [Synapse Sign] Causal Cryptographic Signing Pipeline',
    signSkipped: '⏭️ Binary SHA-256 unchanged: Signature skipped in 0.00s',
    signSuccess: (sec: string) => `✨ Ed25519 digital signature generated (Elapsed: ${sec}s)`,
    signFailed: (sec: string) => `❌ Signature generation failed (Elapsed: ${sec}s)`,
    statusSuccess: 'PASSED',
    statusSkipped: 'SKIPPED (Causal skip)',
    statusWarning: 'WARNING',
    statusError: 'FAILED',
    causalAnalysis: 'Causal Analysis',
    trackSkipped: 'SKIPPED [Causal Cache Hit]',
    trackComplete: 'Build Passed',
    trackFailed: 'Build Failed',
    noBuildTracks: '❌ No buildTracks found in synapse.config.ts.',
    buildSuccessSummary: (tracks: number, sec: string) =>
      `✨ Causal Parallel Build Passed: All ${tracks} tracks completed (Total: ${sec}s)`,
    buildFailureSummary: '🚨 Parallel Build Failed: Errors occurred in one or more tracks.',
    packagingPreBuild: 'ℹ️  Verifying prerequisite artifact causal builds...',
    packagingStart: '🚀 Starting Tauri installer bundling...',
    packagingGuide: '⚠️  [Packaging Notice] tauri.conf.json has targets set to "all".\n   ↳ WiX MSI adds redundant delay. Recommended setting: targets: ["nsis"].',
  },
};

export type MessageKey = keyof typeof MESSAGES['ko'];

/**
 * 환경 변수, OS 시스템 로케일 또는 CLI 플래그로부터 로케일을 자동 감지합니다.
 */
export function detectLocale(explicitLang?: string): SupportedLocale {
  if (explicitLang === 'ko' || explicitLang === 'en') {
    currentLocale = explicitLang;
    return currentLocale;
  }

  const envLang =
    process.env.SYNAPSE_LANG ||
    process.env.LANG ||
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    '';

  if (envLang.toLowerCase().includes('ko')) {
    currentLocale = 'ko';
    return 'ko';
  }

  try {
    const sysLocale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    if (sysLocale.startsWith('ko')) {
      currentLocale = 'ko';
      return 'ko';
    }
  } catch {
    // ignore
  }

  currentLocale = 'en';
  return 'en';
}

export function setLocale(locale: SupportedLocale): void {
  currentLocale = locale;
}

export function getLocale(): SupportedLocale {
  return currentLocale;
}

/**
 * 현재 로케일에 맞는 번역 메시지를 가져옵니다.
 */
export function t(key: MessageKey, ...args: any[]): any {
  const dict = MESSAGES[currentLocale] || MESSAGES.en;
  const val = dict[key] ?? MESSAGES.en[key] ?? key;
  if (typeof val === 'function') {
    return (val as any)(...args);
  }
  return val;
}
