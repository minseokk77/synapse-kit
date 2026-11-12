/**
 * 시냅스 마이크로 샌드박스 런타임 타입 명세 (Synapse Runtime Types)
 */

export interface SandboxExecutionResult<T = any> {
  readonly ok: boolean;
  readonly result?: T;
  readonly durationMs: number;
  readonly error?: string;
  readonly timedOut: boolean;
}

export type SandboxContext = Record<string, any>;
