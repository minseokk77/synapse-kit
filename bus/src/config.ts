/**
 * 시냅스 신경망 버스 전역 설정 및 기본 상수 정의 (Synapse Bus Configuration)
 */

export type BackpressureStrategy = 'drop-oldest' | 'reject';

export interface BusConfig {
  /** 인메모리 링 버퍼 고정 슬롯 용량 (2의 거듭제곱 권장, 기본: 4096) */
  readonly ringCapacity?: number;
  /** 버퍼 용량 초과 시 백프레셔 전략 ('drop-oldest' | 'reject', 기본: 'drop-oldest') */
  readonly backpressure?: BackpressureStrategy;
  /** 단일 RPC 호출 기본 타임아웃 (ms, 기본: 5000) */
  readonly defaultRpcTimeoutMs?: number;
  /** 최대 토픽 구독자 수 한도 (기본: 256) */
  readonly maxSubscribersPerTopic?: number;
  /** IPC 소켓 또는 네임드 파이프 경로 (지정 시 프로세스 간 IPC 활성화) */
  readonly socketPath?: string;
  /** IPC 서버 모드 여부 */
  readonly isServer?: boolean;
}

export const BUS_DEFAULTS = {
  RING_CAPACITY: 4096,
  DEFAULT_RPC_TIMEOUT_MS: 5000,
  MAX_SUBSCRIBERS_PER_TOPIC: 256,
  DEFAULT_SOCKET_NAME: "synapse-bus.sock",
} as const;
