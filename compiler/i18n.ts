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
    cmdRelease: 'Synapse Axon(시냅스 엑손) - 초경량 제로-토큰 GitHub 릴리즈 엔진 (gh CLI 의무 연동, 토큰 99% 절감)',
    cmdInit: '현재 디렉터리에 최적화된 synapse.config.ts 생성',
    cmdMemory: '인과율 메모리(Causal Memory) 초경량 공명 조회, 관리 및 로컬 데몬 구동',
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
    causalAll: '전체 검사 모드(--all) 요청: 모든 플러그인 검사기를 실행합니다.',
    causalDirty: (count: number, plugins: string) =>
      `변경된 ${count}개 파일 인과 분석 완료: [${plugins}] 플러그인만 선별 실행합니다.`,
    causalClean: '변경된 파일이 없습니다. 모든 검증 플러그인을 0.00초 스킵합니다.',
    causalCleanCacheHit: '작업 트리에 변경 파일이 없으며 이전 검증 통과 커밋과 일치하여 0.00초 스킵합니다.',
    causalBaseline: '작업 트리에 변경된 파일이 없어 전체 베이스라인 검증을 수행합니다.',
    causalUnrelated: (count: number) =>
      `변경된 ${count}개 파일이 등록된 검사 플러그인의 영향 범위에 속하지 않아 전체 검사를 스킵합니다.`,
    causalGitFail: 'Git 변경 추적 불가로 안전 모드(전체 검사)를 실행합니다.',
    checkPassed: '통과',
    checkSkipped: '생략 (인과율 0초 스킵)',
    checkFailed: '실패',
    checkSuccessSummary: (errs: number, warns: number, skips: number, sec: string) =>
      `✨ 시냅스 검증 성공: ${errs} Errors, ${warns} Warnings, ${skips} Skipped (총 소요 시간: ${sec}초)`,
    checkFailureSummary: (errs: number, warns: number, sec: string) =>
      `❌ 시냅스 검증 실패: ${errs}개 검사기 오류 발생 (총 소요 시간: ${sec}초)`,
    interactivePause: '⏸️  에러 발생으로 일시정지되었습니다. 파일을 수정한 뒤 저장하면 0.05초 만에 핫 재검증합니다. (종료: Ctrl+C)',
    interactiveReload: '⚡ 파일 변경 감지! 인메모리 핫 재검증을 즉시 가동합니다...',
    interactiveTitle: '⏸️  [대화형 인과 핫픽스 모드] 오류 발생으로 프로세스를 일시정지했습니다.',
    interactiveTarget: '대상 플러그인',
    interactiveWatching: '감시 상태     : 👀 소스 코드 수정 대기 중... (저장 시 0.05초 만에 핫 재컴파일)',
    interactiveExit: '세션 종료     : 터미널에서 Ctrl+C 입력',
    interactiveDetected: (time: string, file: string) => `⚡ [저장 감지 ${time}] ${file} 수정 감지 ➜ 핫 재컴파일 실행 중...`,
    interactivePassed: (sec: string) => `✨ [핫 재컴파일 통과] (${sec}s) 결함이 완전히 해결되었습니다!`,
    interactiveResumed: '▶️  [파이프라인 재개] 모든 검증 통과 완료. 프로세스를 정상 종료합니다.',
    interactiveFailed: '❌ [재검증 실패] 여전히 오류가 남아있습니다. 코드를 다시 수정하고 저장해 주세요.',
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
    signNoConfig: '❌ 서명 설정(sign.privateKeyPath)이 synapse.config.ts에 지정되지 않았습니다.',
    signNoKey: (p: string) => `❌ 서명 개인키 파일을 찾을 수 없습니다: ${p}`,
    signNoInstaller: '❌ 서명 대상 인스톨러(.exe) 파일을 찾을 수 없습니다.',
    signTarget: '대상 인스톨러',
    signStatus: '서명 상태',
    signFile: '서명 파일',
    signReasonLabel: '서명 사유',
    signEngineLabel: '서명 엔진',
    signCacheHit: '스킵 [인과율 캐시 적중: 바이너리 해시 불변]',
    signExistingKeep: (p: string) => `기존 서명 파일 유지 (${p})`,
    signIntegrityPass: '✨ 서명 무결성 확인 완료 (0.00초)',
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
    
    // 플러그인 타이틀 및 결과 메시지
    pluginRustTitle: 'Rust 백엔드 워크스페이스 (Check & Clippy)',
    pluginRustSuccess: 'Rust 워크스페이스 컴파일 및 Clippy 무결성 확인 완료 (0 Warnings, 0 Errors)',
    pluginRustClippyWarn: (count: number) => `컴파일 통과 완료 (${count}개 Clippy 권장사항 감지됨)`,
    pluginRustCompileFail: 'Rust 워크스페이스 컴파일에 실패했습니다.',
    pluginRustExecFail: (msg: string) => `Rust 검사 도구 실행 실패: ${msg}`,

    pluginSvelteTitle: 'Svelte 5 & TypeScript (svelte-check)',
    pluginSvelteSuccess: 'Svelte 5 Runes 및 TS 타입 무결성 검증 완료 (0 Errors, 0 Warnings)',
    pluginSvelteError: 'Svelte 템플릿 또는 TypeScript 타입 오류가 발생했습니다.',
    pluginSvelteExecFail: (msg: string) => `Svelte 검사 도구 실행 실패: ${msg}`,

    pluginJavaTitle: 'Java 엔터프라이즈 컴파일러 (javac)',
    pluginJavaSuccess: (count: number) => `Java ${count}개 소스 파일 바이트코드 컴파일 무결성 검증 완료`,
    pluginJavaNoFiles: '검증할 Java 소스 파일(.java)이 존재하지 않습니다.',
    pluginJavaError: 'javac 컴파일 실패',

    pluginCppTitle: 'C/C++ 네이티브 커널 검증기 (g++/clang++)',
    pluginCppSuccess: (count: number) => `C/C++ ${count}개 소스 파일 구문 및 헤더 무결성 검증 완료`,
    pluginCppNoFiles: '검증할 C/C++ 소스 파일이 존재하지 않습니다.',
    pluginCppError: 'C/C++ 구문 오류가 발생했습니다.',

    pluginCsharpTitle: 'C# .NET 솔루션 검증기 (dotnet build)',
    pluginCsharpSuccess: 'C# .NET 프로젝트 빌드 및 타입 무결성 검증 완료',
    pluginCsharpError: 'C# .NET 빌드 중 오류가 발생했습니다.',

    pluginGoTitle: 'Go 백엔드 패키지 검증기 (go vet)',
    pluginGoSuccess: 'Go 동시성 루틴 및 패키지 정적 분석 통과',
    pluginGoError: 'Go 정적 분석 중 오류가 발생했습니다.',

    pluginPythonTitle: 'Python 바이트코드 검증기 (py_compile)',
    pluginPythonSuccess: (count: number) => `Python ${count}개 모듈 바이트코드 무결성 검증 완료`,
    pluginPythonNoFiles: '검증할 Python 소스 파일이 존재하지 않습니다.',
    pluginPythonError: 'Python 구문 분석 중 오류가 발생했습니다.',

    pluginTypescriptTitlePure: '순수 TypeScript 공식 컴파일러 (tsc)',
    pluginTypescriptTitleNative: 'TypeScript 네이티브 Rust Oxc (tsrs)',
    pluginTypescriptSuccess: (mode: string) => `TypeScript 타입 무결성 검증 완료 (${mode})`,
    pluginTypescriptError: 'TypeScript 타입 오류가 발생했습니다.',

    pluginSchemaTitle: '데이터 및 설정 스키마 무결성 검사',
    pluginSchemaSuccess: (count: number) => `${count}개 스키마/데이터 파일 정상 확인 완료`,
    pluginSchemaParseFail: (path: string, err: string) => `${path} 파싱 실패: ${err}`,

    pluginNativeTitle: '네이티브 바이너리 & 에셋 검사',
    pluginNativeSuccess: (count: number) => `${count}개 바이너리 및 리소스 무결성 확인 완료`,
    pluginNativeMissing: (path: string) => `필수 바이너리가 누락되었습니다: ${path}`,
    pluginNativeNotPe: (path: string) => `${path}: 올바른 PE 포맷(MZ 시그니처 누락)이 아닙니다.`,
    pluginNativeInvalidPe: (path: string) => `${path}: 유효하지 않은 PE 시그니처입니다.`,
    pluginNativeInvalidArch: (path: string, code: string) => `${path}: 64비트(x64) 바이너리가 아닙니다 (머신 코드: 0x${code}).`,

    pluginNsisTitle: 'NSIS 인스톨러 템플릿 구문 검사',
    pluginNsisSuccess: (path: string) => `${path} 구문 및 필수 지시문 확인 완료`,
    pluginNsisMissing: (path: string) => `NSIS 템플릿 파일이 누락되었습니다: ${path}`,
    pluginNsisCorrupt: 'NSIS 템플릿 파일 내용이 비어 있거나 손상되었습니다.',
    pluginNsisDirectiveMissing: (dir: string) => `NSIS 필수 지시문 누락: '${dir}' 구문이 발견되지 않았습니다.`,
  },
  en: {
    cliTitle: '🧠 Synapse Kit - AI-Native Unified Compiler, Build & Packaging Framework',
    cliUsage: 'Usage:',
    cliCommands: 'Core Commands:',
    cmdCheck: 'Run multi-track verification with AI causal smart skipping',
    cmdBuild: 'Fast incremental multi-track build (0.00s skip on unchanged sources)',
    cmdPackage: 'Single NSIS + zlib high-speed installer packager',
    cmdSign: 'Causal cryptographic signing engine (Minisign / Ed25519)',
    cmdRelease: 'Synapse Axon - Ultra-compact zero-token GitHub release pipeline (gh CLI mandatory, 99% token diet)',
    cmdInit: 'Generate optimized synapse.config.ts template in current directory',
    cmdMemory: 'Query, manage and serve zero-cost Causal Memory & Local Daemon',
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
    causalAll: 'Full check requested (--all): Executing all registered checkers.',
    causalDirty: (count: number, plugins: string) =>
      `${count} modified files detected: Running [${plugins}] plugins only.`,
    causalClean: 'No source changes detected. All checkers skipped in 0.00s.',
    causalCleanCacheHit: 'No file changes and matches last verified commit. Skipped in 0.00s.',
    causalBaseline: 'No changes detected; performing baseline verification for initial state.',
    causalUnrelated: (count: number) =>
      `${count} modified files do not affect registered plugins. Skipping all checkers.`,
    causalGitFail: 'Cannot track Git changes; running full verification in safe mode.',
    checkPassed: 'PASSED',
    checkSkipped: 'SKIPPED (Causal 0.00s)',
    checkFailed: 'FAILED',
    checkSuccessSummary: (errs: number, warns: number, skips: number, sec: string) =>
      `✨ Verification Passed: ${errs} Errors, ${warns} Warnings, ${skips} Skipped (Total: ${sec}s)`,
    checkFailureSummary: (errs: number, warns: number, sec: string) =>
      `❌ Verification Failed: ${errs} check failures (Total: ${sec}s)`,
    interactivePause: '⏸️  Paused due to errors. Save modified files to hot-recheck in 0.05s. (Exit: Ctrl+C)',
    interactiveReload: '⚡ File changes detected! Launching in-memory hot-recheck...',
    interactiveTitle: '⏸️  [Interactive Causal Hotfix] Process paused due to verification errors.',
    interactiveTarget: 'Target Plugins',
    interactiveWatching: 'Watch Status  : 👀 Waiting for code changes... (hot-rechecks in 0.05s on save)',
    interactiveExit: 'Exit Session  : Press Ctrl+C in terminal',
    interactiveDetected: (time: string, file: string) => `⚡ [Save Detected ${time}] ${file} changed ➜ Running hot-recheck...`,
    interactivePassed: (sec: string) => `✨ [Hot-recheck Passed] (${sec}s) All issues resolved!`,
    interactiveResumed: '▶️  [Pipeline Resumed] All verifications passed. Exiting cleanly.',
    interactiveFailed: '❌ [Hot-recheck Failed] Errors remain. Please edit and save again.',
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
    signNoConfig: '❌ Signing configuration (sign.privateKeyPath) is missing in synapse.config.ts.',
    signNoKey: (p: string) => `❌ Signing private key not found: ${p}`,
    signNoInstaller: '❌ Target installer (.exe) not found for signing.',
    signTarget: 'Target Installer',
    signStatus: 'Signing Status',
    signFile: 'Signature File',
    signReasonLabel: 'Reason',
    signEngineLabel: 'Signing Engine',
    signCacheHit: 'SKIPPED [Causal Cache Hit: Binary hash identical]',
    signExistingKeep: (p: string) => `Keeping existing signature file (${p})`,
    signIntegrityPass: '✨ Signature integrity verified (0.00s)',
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

    // Plugins
    pluginRustTitle: 'Rust Backend Workspace (Check & Clippy)',
    pluginRustSuccess: 'Rust workspace compilation & Clippy integrity verified (0 Warnings, 0 Errors)',
    pluginRustClippyWarn: (count: number) => `Compilation passed (${count} Clippy recommendations detected)`,
    pluginRustCompileFail: 'Rust workspace compilation failed.',
    pluginRustExecFail: (msg: string) => `Failed to execute Rust checker tool: ${msg}`,

    pluginSvelteTitle: 'Svelte 5 & TypeScript (svelte-check)',
    pluginSvelteSuccess: 'Svelte 5 Runes & TS type integrity verified (0 Errors, 0 Warnings)',
    pluginSvelteError: 'Errors detected in Svelte template or TypeScript types.',
    pluginSvelteExecFail: (msg: string) => `Failed to execute Svelte checker tool: ${msg}`,

    pluginJavaTitle: 'Java Enterprise Compiler (javac)',
    pluginJavaSuccess: (count: number) => `Java bytecode compilation verified for ${count} source files`,
    pluginJavaNoFiles: 'No Java source files (*.java) found to verify.',
    pluginJavaError: 'javac compilation failed',

    pluginCppTitle: 'C/C++ Native Kernel Checker (g++/clang++)',
    pluginCppSuccess: (count: number) => `C/C++ syntax & header integrity verified for ${count} files`,
    pluginCppNoFiles: 'No C/C++ source files found to verify.',
    pluginCppError: 'C/C++ compilation syntax errors detected.',

    pluginCsharpTitle: 'C# .NET Solution Checker (dotnet build)',
    pluginCsharpSuccess: 'C# .NET project build and type integrity verified',
    pluginCsharpError: 'Errors detected during C# .NET build.',

    pluginGoTitle: 'Go Backend Package Checker (go vet)',
    pluginGoSuccess: 'Go concurrency routines and packages passed static analysis',
    pluginGoError: 'Errors detected during Go static analysis.',

    pluginPythonTitle: 'Python Bytecode Checker (py_compile)',
    pluginPythonSuccess: (count: number) => `Python bytecode integrity verified for ${count} modules`,
    pluginPythonNoFiles: 'No Python source files found to verify.',
    pluginPythonError: 'Syntax errors detected in Python source.',

    pluginTypescriptTitlePure: 'Pure TypeScript Official Compiler (tsc)',
    pluginTypescriptTitleNative: 'TypeScript Native Rust Oxc (tsrs)',
    pluginTypescriptSuccess: (mode: string) => `TypeScript type integrity verified (${mode})`,
    pluginTypescriptError: 'TypeScript type errors detected.',

    pluginSchemaTitle: 'Data & Config Schema Integrity Checker',
    pluginSchemaSuccess: (count: number) => `Verified ${count} schema/data files successfully`,
    pluginSchemaParseFail: (path: string, err: string) => `${path} parse failure: ${err}`,

    pluginNativeTitle: 'Native Binary & Asset Checker',
    pluginNativeSuccess: (count: number) => `Verified ${count} binaries & resources successfully`,
    pluginNativeMissing: (path: string) => `Required binary is missing: ${path}`,
    pluginNativeNotPe: (path: string) => `${path}: Not a valid PE format (MZ signature missing).`,
    pluginNativeInvalidPe: (path: string) => `${path}: Invalid PE signature.`,
    pluginNativeInvalidArch: (path: string, code: string) => `${path}: Not a 64-bit (x64) binary (Machine code: 0x${code}).`,

    pluginNsisTitle: 'NSIS Installer Template Checker',
    pluginNsisSuccess: (path: string) => `${path} syntax & required directives verified`,
    pluginNsisMissing: (path: string) => `NSIS template file is missing: ${path}`,
    pluginNsisCorrupt: 'NSIS template content is empty or corrupted.',
    pluginNsisDirectiveMissing: (dir: string) => `Required NSIS directive missing: '${dir}'.`,
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
