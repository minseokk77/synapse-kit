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
    readonly triggers: readonly string[];
    readonly check: (ctx: SynapseContext) => Promise<CheckResult>;
}
export interface BuildTrack {
    readonly name: string;
    readonly command: readonly string[];
    readonly cwd?: string;
    readonly sources?: readonly string[];
    readonly artifacts?: readonly string[];
}
export interface PackageConfig {
    readonly framework?: 'tauri' | 'custom';
    readonly targets?: readonly string[];
    readonly compression?: 'zlib' | 'bzip2' | 'lzma' | 'off';
    readonly tauriConfPath?: string;
}
export interface SignConfig {
    readonly privateKeyPath: string;
    readonly targetInstaller?: string;
    readonly passwordEnv?: string;
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
    readonly agentMode: boolean;
    readonly compactMode: boolean;
    readonly watch: boolean;
    readonly interactive?: boolean;
    readonly force?: boolean;
}
export interface CausalDecision {
    readonly runAll: boolean;
    readonly activePluginNames: ReadonlySet<string>;
    readonly reason: string;
    readonly modifiedFiles: readonly string[];
}
