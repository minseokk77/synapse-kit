/**
 * 시냅스 러너 프로세스 슈퍼바이저 타입 명세 (Synapse Runner Types)
 */
import type { ProcessSpec } from "./config";

export type ProcessStatus =
  | "STOPPED"
  | "STARTING"
  | "RUNNING"
  | "RESTARTING"
  | "CRASHED"
  | "BACKOFF_LIMIT";

/**
 * 프로세스 실시간 런타임 상태
 */
export interface ProcessState {
  readonly spec: ProcessSpec;
  status: ProcessStatus;
  pid: number | null;
  startedAtMs: number | null;
  restartCount: number;
  lastCrashError: string | null;
  lastExitCode: number | null;
}

/**
 * 러너 전체 통계 지표
 */
export interface RunnerStats {
  readonly totalManagedProcesses: number;
  readonly runningCount: number;
  readonly crashedCount: number;
  readonly totalRestartsTriggered: number;
  readonly processStates: readonly {
    readonly id: string;
    readonly status: ProcessStatus;
    readonly pid: number | null;
    readonly uptimeMs: number;
    readonly restartCount: number;
  }[];
}

/**
 * 수집된 크래시 이벤트 메타데이터
 */
export interface CrashHarvestRecord {
  readonly processId: string;
  readonly timestampMs: number;
  readonly exitCode: number | null;
  readonly errorSignature: string;
  readonly tailStderr: string;
}
