/**
 * 시냅스 러너 프로세스 슈퍼바이저 설정 및 기본 상수 정의 (Synapse Runner Configuration)
 */

export interface ProcessSpec {
  /** 프로세스 고유 식별자 (예: "discord-bot", "mcp-server", "db-watcher") */
  readonly id: string;
  /** 실행할 명령어 및 인자 (예: ["bun", "run", "bot.ts"]) */
  readonly command: readonly string[];
  /** 작업 디렉터리 (기본값: 현재 디렉터리) */
  readonly cwd?: string;
  /** 추가 환경 변수 */
  readonly env?: Record<string, string>;
  /** 최대 연속 재시작 허용 횟수 (기본: 5) */
  readonly maxRestarts?: number;
  /** 재시작 대기 기본 딜레이 (ms, 기본: 1000) */
  readonly restartDelayMs?: number;
  /** 프로세스 정상 기동 판정 최소 유지 시간 (ms, 기본: 3000) */
  readonly minUptimeMs?: number;
}

export interface RunnerConfig {
  /** 관리할 프로세스 목록 */
  readonly processes?: readonly ProcessSpec[];
  /** 자동 재시작 활성화 여부 (기본: true) */
  readonly autoRestart?: boolean;
  /** 크래시 에러 메모리 자동 수집 활성화 여부 (기본: true) */
  readonly autoHarvestCrash?: boolean;
  /** OS 종료 시그널(SIGINT/SIGTERM) 감지 시 DB 안전 플러시 콜백 */
  readonly onShutdownFlush?: () => Promise<void> | void;
}

export const RUNNER_DEFAULTS = {
  MAX_RESTARTS: 5,
  RESTART_DELAY_MS: 1000,
  MIN_UPTIME_MS: 3000,
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: 3000,
} as const;
