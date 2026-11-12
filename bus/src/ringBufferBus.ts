/**
 * 러스트 메모리 철학 기반 초저지연 인메모리 링 버퍼 이벤트 브로커 (Ring Buffer Event Broker)
 * - 2의 거듭제곱 비트마스크(& bitMask)를 통한 CPU 1사이클 O(1) 인덱싱
 * - 와일드카드 토픽 매칭 지원 (예: "memory.*", "db.doc.*", "*")
 * - microsecond 단위 디스패치 지연시간 실측 및 통계 수집
 */
import { BUS_DEFAULTS, type BusConfig } from "./config";
import type {
  BusMessage,
  BusSubscriber,
  BusStats,
  RpcHandler,
  Unsubscribe,
} from "./types";

export class RingBufferBus {
  private readonly capacity: number;
  private readonly isPowerOfTwo: boolean;
  private readonly bitMask: number;
  private readonly slots: Array<BusMessage | undefined>;

  private head = 0;
  private tail = 0;
  private count = 0;
  private nextMessageId = 1;

  // 토픽별 구독자 맵 (단일 토픽 ➔ Set<구독자>)
  private readonly exactSubscribers = new Map<string, Set<BusSubscriber>>();
  // 와일드카드 구독자 목록 (패턴 정규식 ➔ Set<구독자>)
  private readonly wildcardSubscribers = new Map<
    string,
    { regex: RegExp; subscribers: Set<BusSubscriber> }
  >();

  // RPC 핸들러 맵 (토픽 ➔ RpcHandler)
  private readonly rpcHandlers = new Map<string, RpcHandler>();
  // RPC 대기 큐 (correlationId ➔ { resolve, reject, timer })
  private readonly pendingRpcCalls = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  // 성능 통계
  private totalEventsEmitted = 0;
  private totalRpcCalls = 0;
  private totalDispatchDurationUs = 0;
  private maxDispatchDurationUs = 0;

  constructor(private readonly config: BusConfig = {}) {
    const rawCapacity = config.ringCapacity ?? BUS_DEFAULTS.RING_CAPACITY;
    if (!Number.isInteger(rawCapacity) || rawCapacity <= 0) {
      throw new Error(`[RingBufferBus] 유효하지 않은 버스 링 버퍼 용량입니다: ${rawCapacity}`);
    }
    this.capacity = rawCapacity;
    this.isPowerOfTwo = (rawCapacity & (rawCapacity - 1)) === 0;
    this.bitMask = rawCapacity - 1;
    this.slots = new Array<BusMessage | undefined>(rawCapacity);
  }

  private wrapIndex(idx: number): number {
    return this.isPowerOfTwo ? idx & this.bitMask : idx % this.capacity;
  }

  /**
   * 링 버퍼에 메시지 기록 (FIFO 슬롯 덮어쓰기)
   */
  private recordMessage(msg: BusMessage): void {
    if (this.count === this.capacity && this.config.backpressure === 'reject') {
      throw new Error(`[RingBufferBus] 백프레셔 임계치 도달: 링버퍼(${this.capacity} 슬롯)가 가득 차 신규 메시지를 수용할 수 없습니다.`);
    }

    const t = this.tail;
    this.slots[t] = msg;
    const nextTail = this.wrapIndex(t + 1);
    this.tail = nextTail;

    if (this.count === this.capacity) {
      this.head = nextTail;
    } else {
      this.count++;
    }
  }

  /**
   * 이벤트 토픽 구독 (와일드카드 '*' 지원)
   */
  public subscribe<T = any>(topic: string, subscriber: BusSubscriber<T>): Unsubscribe {
    if (!topic || typeof subscriber !== "function") {
      throw new Error("[RingBufferBus] 구독할 토픽과 유효한 콜백 함수가 필요합니다.");
    }

    if (topic.includes("*")) {
      let entry = this.wildcardSubscribers.get(topic);
      if (!entry) {
        const regexStr = "^" + topic.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$";
        entry = {
          regex: new RegExp(regexStr),
          subscribers: new Set<BusSubscriber>(),
        };
        this.wildcardSubscribers.set(topic, entry);
      }
      entry.subscribers.add(subscriber);

      return () => {
        const current = this.wildcardSubscribers.get(topic);
        if (current) {
          current.subscribers.delete(subscriber);
          if (current.subscribers.size === 0) {
            this.wildcardSubscribers.delete(topic);
          }
        }
      };
    }

    let subSet = this.exactSubscribers.get(topic);
    if (!subSet) {
      subSet = new Set<BusSubscriber>();
      this.exactSubscribers.set(topic, subSet);
    }
    subSet.add(subscriber);

    return () => {
      const current = this.exactSubscribers.get(topic);
      if (current) {
        current.delete(subscriber);
        if (current.size === 0) {
          this.exactSubscribers.delete(topic);
        }
      }
    };
  }

  /**
   * 이벤트 발행 (Pub/Sub)
   */
  public emit<T = any>(topic: string, payload: T, sender?: string): BusMessage<T> {
    const start = performance.now();
    const id = this.nextMessageId++;
    const nowMs = Date.now();

    const message: BusMessage<T> = {
      id,
      type: "EVENT",
      topic,
      payload,
      timestampMs: nowMs,
      sender,
    };

    this.recordMessage(message);
    this.dispatchToSubscribers(topic, message);

    const elapsedUs = (performance.now() - start) * 1000;
    this.totalEventsEmitted++;
    this.totalDispatchDurationUs += elapsedUs;
    if (elapsedUs > this.maxDispatchDurationUs) {
      this.maxDispatchDurationUs = elapsedUs;
    }

    return message;
  }

  /**
   * 구독자들에게 메시지 초고속 디스패치
   */
  private dispatchToSubscribers(topic: string, message: BusMessage): void {
    // 1. 정확한 토픽 구독자 실행
    const exact = this.exactSubscribers.get(topic);
    if (exact && exact.size > 0) {
      for (const sub of exact) {
        try {
          sub(message);
        } catch (err: any) {
          process.stderr.write(
            `[RingBufferBus] 구독자 예외 발생 (토픽: ${topic}): ${err?.message || err}\n`
          );
        }
      }
    }

    // 2. 와일드카드 구독자 매칭 및 실행
    if (this.wildcardSubscribers.size > 0) {
      for (const { regex, subscribers } of this.wildcardSubscribers.values()) {
        if (regex.test(topic)) {
          for (const sub of subscribers) {
            try {
              sub(message);
            } catch (err: any) {
              process.stderr.write(
                `[RingBufferBus] 와일드카드 구독자 예외 발생 (토픽: ${topic}): ${err?.message || err}\n`
              );
            }
          }
        }
      }
    }
  }

  /**
   * RPC 핸들러 등록
   */
  public handle<TReq = any, TRes = any>(
    topic: string,
    handler: RpcHandler<TReq, TRes>
  ): Unsubscribe {
    if (this.rpcHandlers.has(topic)) {
      throw new Error(`[RingBufferBus] 이미 등록된 RPC 핸들러 토픽입니다: ${topic}`);
    }
    this.rpcHandlers.set(topic, handler);

    return () => {
      this.rpcHandlers.delete(topic);
    };
  }

  /**
   * RPC 원격/로컬 프로시저 호출 (타임아웃 및 양방향 응답 매칭 보장)
   */
  public async call<TReq = any, TRes = any>(
    topic: string,
    payload: TReq,
    options?: { timeoutMs?: number; sender?: string }
  ): Promise<TRes> {
    const handler = this.rpcHandlers.get(topic);
    if (!handler) {
      throw new Error(`[RingBufferBus] 등록된 RPC 핸들러가 없습니다: ${topic}`);
    }

    const start = performance.now();
    const id = this.nextMessageId++;
    const correlationId = `rpc_${id}_${Math.random().toString(36).slice(2, 9)}`;
    const nowMs = Date.now();

    const requestMessage: BusMessage<TReq> = {
      id,
      type: "RPC_REQUEST",
      topic,
      payload,
      timestampMs: nowMs,
      sender: options?.sender,
      correlationId,
    };

    this.recordMessage(requestMessage);
    this.totalRpcCalls++;

    const timeoutMs =
      options?.timeoutMs ?? this.config.defaultRpcTimeoutMs ?? BUS_DEFAULTS.DEFAULT_RPC_TIMEOUT_MS;

    return new Promise<TRes>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpcCalls.delete(correlationId);
        reject(new Error(`[RingBufferBus] RPC 요청 시간 초과 (${timeoutMs}ms, 토픽: ${topic})`));
      }, timeoutMs);

      this.pendingRpcCalls.set(correlationId, { resolve, reject, timer });

      // 핸들러 즉시 비동기 실행
      Promise.resolve()
        .then(() => handler(payload, requestMessage))
        .then((responseResult) => {
          const pending = this.pendingRpcCalls.get(correlationId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRpcCalls.delete(correlationId);

            const respMsg: BusMessage<TRes> = {
              id: this.nextMessageId++,
              type: "RPC_RESPONSE",
              topic,
              payload: responseResult,
              timestampMs: Date.now(),
              correlationId,
            };
            this.recordMessage(respMsg);

            const elapsedUs = (performance.now() - start) * 1000;
            this.totalDispatchDurationUs += elapsedUs;
            if (elapsedUs > this.maxDispatchDurationUs) {
              this.maxDispatchDurationUs = elapsedUs;
            }

            resolve(responseResult);
          }
        })
        .catch((err: any) => {
          const pending = this.pendingRpcCalls.get(correlationId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRpcCalls.delete(correlationId);

            const errMsg = err?.message || String(err);
            const errRespMsg: BusMessage = {
              id: this.nextMessageId++,
              type: "RPC_ERROR",
              topic,
              payload: null,
              timestampMs: Date.now(),
              correlationId,
              error: errMsg,
            };
            this.recordMessage(errRespMsg);

            reject(new Error(`[RingBufferBus] RPC 처리 중 오류 발생 (${topic}): ${errMsg}`));
          }
        });
    });
  }

  /**
   * 실시간 통계 조회
   */
  public getStats(): BusStats {
    const totalOps = this.totalEventsEmitted + this.totalRpcCalls;
    const avgLatency = totalOps > 0 ? this.totalDispatchDurationUs / totalOps : 0;

    return {
      totalEventsEmitted: this.totalEventsEmitted,
      totalRpcCalls: this.totalRpcCalls,
      activeTopicsCount: this.exactSubscribers.size + this.wildcardSubscribers.size,
      activeRpcHandlersCount: this.rpcHandlers.size,
      ringBufferSize: this.count,
      ringBufferCapacity: this.capacity,
      avgLatencyMicroseconds: Number(avgLatency.toFixed(3)),
      maxLatencyMicroseconds: Number(this.maxDispatchDurationUs.toFixed(3)),
    };
  }

  /**
   * 리소스 정리 및 보류 중인 RPC 취소
   */
  public close(): void {
    for (const [_, pending] of this.pendingRpcCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error("[RingBufferBus] 버스가 종료되어 보류 중인 RPC가 취소되었습니다."));
    }
    this.pendingRpcCalls.clear();
    this.exactSubscribers.clear();
    this.wildcardSubscribers.clear();
    this.rpcHandlers.clear();
    this.slots.fill(undefined);
    this.count = 0;
    this.head = 0;
    this.tail = 0;
  }
}
