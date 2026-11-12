/**
 * 시냅스 신경망 버스 타입 명세 (Synapse Bus Type Definitions)
 * - SRP(단일 책임 원칙)에 따라 버스 메시지, RPC 규약, 이벤트 훅, 실시간 지연시간 메트릭 정의
 */

export type BusMessageType = "EVENT" | "RPC_REQUEST" | "RPC_RESPONSE" | "RPC_ERROR";

/**
 * 버스를 통해 전송되는 표준 메시지 봉투 (Envelope)
 */
export interface BusMessage<TPayload = any> {
  /** 메시지 고유 단조 증가 시퀀스 ID */
  readonly id: number;
  /** 메시지 유형 */
  readonly type: BusMessageType;
  /** 대상 토픽 또는 RPC 메서드 명 (예: "memory.rule.added", "compiler.build.request") */
  readonly topic: string;
  /** 실제 데이터 페이로드 */
  readonly payload: TPayload;
  /** 발행 시각 타임스탬프 (ms) */
  readonly timestampMs: number;
  /** 발신자 식별자 */
  readonly sender?: string;
  /** RPC 응답 매칭용 상관관계 ID (Correlation ID) */
  readonly correlationId?: string;
  /** RPC 에러 메시지 (RPC_ERROR 유형 시) */
  readonly error?: string;
}

/**
 * 이벤트 구독자 콜백 함수
 */
export type BusSubscriber<T = any> = (message: BusMessage<T>) => void | Promise<void>;

/**
 * RPC 핸들러 함수
 */
export type RpcHandler<TRequest = any, TResponse = any> = (
  payload: TRequest,
  message: BusMessage<TRequest>
) => Promise<TResponse> | TResponse;

/**
 * 구독 해제 함수 타입
 */
export type Unsubscribe = () => void;

/**
 * 실시간 버스 성능 및 레이턴시 메트릭 통계
 */
export interface BusStats {
  /** 총 전송된 이벤트 메시지 수 */
  readonly totalEventsEmitted: number;
  /** 총 처리된 RPC 호출 수 */
  readonly totalRpcCalls: number;
  /** 현재 등록된 활성 토픽 수 */
  readonly activeTopicsCount: number;
  /** 현재 등록된 활성 RPC 핸들러 수 */
  readonly activeRpcHandlersCount: number;
  /** 링 버퍼 현재 점유 크기 */
  readonly ringBufferSize: number;
  /** 링 버퍼 최대 용량 */
  readonly ringBufferCapacity: number;
  /** 평균 단일 메시지 디스패치 지연시간 (마이크로초, µs) */
  readonly avgLatencyMicroseconds: number;
  /** 최대 관측 지연시간 (마이크로초, µs) */
  readonly maxLatencyMicroseconds: number;
}
