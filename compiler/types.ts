/**
 * 프로젝트 시냅스(Project Synapse) 프레임워크 핵심 타입 시스템
 */

export type CheckStatus = 'success' | 'warning' | 'error' | 'skipped';

export interface DiagnosticItem {
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

export interface CheckResult {
  readonly name: string;
  readonly title: string;
  readonly status: CheckStatus;
  readonly durationMs: number;
  readonly details: string;
  readonly diagnostics?: readonly DiagnosticItem[];
}

export interface SynapseContext {
  readonly rootDir: string;
  readonly options: SynapseOptions;
}

export interface CheckerPlugin {
  readonly name: string;
  readonly title: string;
  readonly triggers: readonly string[]; // 인과율 감지 패턴 (예: ['src-tauri/**/*.rs', 'Cargo.toml'])
  readonly check: (ctx: SynapseContext) => Promise<CheckResult>;
}

export interface BuildTrack {
  readonly name: string;
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly sources?: readonly string[]; // 인과율 감지 소스 디렉터리/파일 (예: ['src/', 'static/'])
  readonly artifacts?: readonly string[]; // 산출물 파일 경로 (예: ['build/index.html'])
}

export interface PackageConfig {
  readonly framework?: 'tauri' | 'custom';
  readonly targets?: readonly string[]; // 기본값: ['nsis']
  readonly compression?: 'zlib' | 'bzip2' | 'lzma' | 'off';
  readonly tauriConfPath?: string;
}

export interface SignConfig {
  readonly privateKeyPath: string;
  readonly targetInstaller?: string; // 미지정 시 최신 nsis 번들 자동 탐색
  readonly passwordEnv?: string; // 기본값: TAURI_KEY_PASSWORD
}

export interface SynapseConfig {
  readonly rootDir?: string;
  readonly aiMemory?: {
    readonly enabled?: boolean;
    readonly smartSkipping?: boolean;
  };
  readonly plugins: readonly CheckerPlugin[];
  readonly buildTracks?: readonly BuildTrack[];
  readonly package?: PackageConfig;
  readonly sign?: SignConfig;
}

export interface SynapseOptions {
  readonly mode: 'smart' | 'all';
  readonly agentMode: boolean; // AI 에이전트 연동용 구조화된 JSON 모드
  readonly compactMode: boolean; // 초극단적 토큰 압축 모드 (--compact)
  readonly watch: boolean;
  readonly interactive?: boolean; // 에러 발생 시 일시정지 및 실시간 수정 루프 (--interactive, -i)
  readonly force?: boolean; // 빌드/서명 시 인과율 캐시 무시하고 강제 실행 (--force, -f)
}

export interface CausalDecision {
  readonly runAll: boolean;
  readonly activePluginNames: ReadonlySet<string>;
  readonly reason: string;
  readonly modifiedFiles: readonly string[];
}
