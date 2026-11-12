/**
 * 시냅스 마이크로 샌드박스 런타임 설정 및 기본 상수 (Synapse Runtime Configuration)
 */

export interface SandboxConfig {
  /** 스크립트 실행 최대 허용 시간 (ms, 기본: 1000) */
  readonly timeoutMs?: number;
  /** 허용되지 않는 위험 전역 식별자 목록 */
  readonly disallowedGlobals?: readonly string[];
}

export const RUNTIME_DEFAULTS = {
  TIMEOUT_MS: 1000,
  DISALLOWED_GLOBALS: [
    "process",
    "require",
    "module",
    "global",
    "globalThis",
    "Bun",
    "eval",
    "Function",
  ],
} as const;
