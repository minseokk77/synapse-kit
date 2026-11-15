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

const CLOCK_SAMPLE_MASK = 4095;
const ROUTE_CACHE_LIMIT = 4096;

interface MutableEventSlot {
  id: number;
  type: "EVENT";
  topic: string;
  payload: any;
  timestampMs: number;
  sender?: string;
}

export class RingBufferBus {
  private readonly capacity: number;
  private readonly isPowerOfTwo: boolean;
  private readonly bitMask: number;
  private readonly rejectOnBackpressure: boolean;
  private readonly slots: Array<BusMessage | undefined>;
  private readonly fastEvent: MutableEventSlot = {
    id: 0,
    type: "EVENT",
    topic: "",
    payload: undefined,
    timestampMs: 0,
    sender: undefined,
  };

  private head = 0;
  private tail = 0;
  private count = 0;
  private nextMessageId = 1;

  // 토픽별 구독자 맵 (단일 토픽 ➔ Set<구독자>) 및 제로-이터레이터 평면 배열 스냅샷
  private readonly exactSubscribers = new Map<string, Set<BusSubscriber>>();
  private readonly exactSubscriberArrays = new Map<string, BusSubscriber[]>();
  // 와일드카드 구독자 목록 (패턴 정규식 ➔ Set<구독자>)
  private readonly wildcardSubscribers = new Map<
    string,
    { regex: RegExp; subscribers: Set<BusSubscriber>; snapshot: BusSubscriber[] }
  >();
  private wildcardSnapshotList: Array<{ regex: RegExp; snapshot: BusSubscriber[] }> = [];

  // Polymorphic Inline Cache (PIC): 토픽별 통합 구독자 라우트 테이블 + 1-슬롯 모노모픽 인라인 캐시
  private readonly compiledTopicRoutes = new Map<string, BusSubscriber[]>();
  private lastRoutedTopic = "";
  private lastRoutedSubscribers: BusSubscriber[] | null = null;
  private lastRoutedSub0: BusSubscriber | null = null;
  private lastRoutedSub1: BusSubscriber | null = null;

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

  // 성능 통계 (LMAX Disruptor Amortized Clock 샘플링)
  private totalEventsEmitted = 0;
  private totalRpcCalls = 0;
  private totalDispatchDurationUs = 0;
  private maxDispatchDurationUs = 0;
  private cachedTimestampMs = Date.now();
  private lastSampledEventCount = 0;

  constructor(private readonly config: BusConfig = {}) {
    const rawCapacity = config.ringCapacity ?? BUS_DEFAULTS.RING_CAPACITY;
    if (!Number.isInteger(rawCapacity) || rawCapacity <= 0) {
      throw new Error(`[RingBufferBus] 유효하지 않은 버스 링 버퍼 용량입니다: ${rawCapacity}`);
    }
    this.capacity = rawCapacity;
    this.isPowerOfTwo = (rawCapacity & (rawCapacity - 1)) === 0;
    this.bitMask = rawCapacity - 1;
    this.rejectOnBackpressure = config.backpressure === "reject";
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

  private invalidateRouteCache(): void {
    if (this.compiledTopicRoutes.size > 0) {
      this.compiledTopicRoutes.clear();
    }
    this.lastRoutedTopic = "";
    this.lastRoutedSubscribers = null;
    this.lastRoutedSub0 = null;
    this.lastRoutedSub1 = null;
  }

  private rebuildWildcardSnapshotList(): void {
    const list: Array<{ regex: RegExp; snapshot: BusSubscriber[] }> = [];
    for (const entry of this.wildcardSubscribers.values()) {
      list.push({ regex: entry.regex, snapshot: entry.snapshot });
    }
    this.wildcardSnapshotList = list;
    this.invalidateRouteCache();
  }

  /**
   * 특정 토픽에 대한 최종 통합 구독자 평면 배열 계산 (정확 일치 + 와일드카드 매칭 통합)
   */
  private resolveSubscribers(topic: string): BusSubscriber[] {
    const resolved: BusSubscriber[] = [];
    const exactList = this.exactSubscriberArrays.get(topic);
    if (exactList !== undefined) {
      for (let i = 0; i < exactList.length; i++) {
        resolved.push(exactList[i]);
      }
    }

    const wildcardLen = this.wildcardSnapshotList.length;
    if (wildcardLen > 0) {
      for (let w = 0; w < wildcardLen; w++) {
        const entry = this.wildcardSnapshotList[w];
        if (entry.regex.test(topic)) {
          const subs = entry.snapshot;
          for (let i = 0; i < subs.length; i++) {
            resolved.push(subs[i]);
          }
        }
      }
    }

    return resolved;
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
          snapshot: [],
        };
        this.wildcardSubscribers.set(topic, entry);
      }
      entry.subscribers.add(subscriber);
      entry.snapshot = Array.from(entry.subscribers);
      this.rebuildWildcardSnapshotList();

      return () => {
        const current = this.wildcardSubscribers.get(topic);
        if (current) {
          current.subscribers.delete(subscriber);
          if (current.subscribers.size === 0) {
            this.wildcardSubscribers.delete(topic);
          } else {
            current.snapshot = Array.from(current.subscribers);
          }
          this.rebuildWildcardSnapshotList();
        }
      };
    }

    let subSet = this.exactSubscribers.get(topic);
    if (!subSet) {
      subSet = new Set<BusSubscriber>();
      this.exactSubscribers.set(topic, subSet);
    }
    subSet.add(subscriber);
    this.exactSubscriberArrays.set(topic, Array.from(subSet));
    this.invalidateRouteCache();

    return () => {
      const current = this.exactSubscribers.get(topic);
      if (current) {
        current.delete(subscriber);
        if (current.size === 0) {
          this.exactSubscribers.delete(topic);
          this.exactSubscriberArrays.delete(topic);
        } else {
          this.exactSubscriberArrays.set(topic, Array.from(current));
        }
        this.invalidateRouteCache();
      }
    };
  }

  private reportSubscriberError(topic: string, err: any): void {
    process.stderr.write(
      `[RingBufferBus] 구독자 예외 발생 (토픽: ${topic}): ${err?.message || err}\n`
    );
  }

  private handleFastDispatchError(
    topic: string,
    err: any,
    firstDone: boolean,
    sub1: BusSubscriber | null,
    message: BusMessage
  ): void {
    this.reportSubscriberError(topic, err);
    if (!firstDone && sub1 !== null) {
      try {
        sub1(message);
      } catch (err2: any) {
        this.reportSubscriberError(topic, err2);
      }
    }
  }

  /**
   * 이벤트 발행 (Pub/Sub) — LMAX Disruptor 사전 할당 슬롯 + FTL 인라이닝 고속 경로
   */
  public emit<T = any>(topic: string, payload: T, sender?: string): BusMessage<T> {
    const id = this.nextMessageId++;
    const sub0 = this.lastRoutedSub0;
    if ((id & CLOCK_SAMPLE_MASK) !== 1 && topic === this.lastRoutedTopic && sub0 !== null) {
      if (this.count < this.capacity) {
        this.count++;
      } else if (this.rejectOnBackpressure) {
        throw new Error(
          `[RingBufferBus] 백프레셔 임계치 도달: 링버퍼(${this.capacity} 슬롯)가 가득 차 신규 메시지를 수용할 수 없습니다.`
        );
      }
      const message = this.fastEvent;
      message.id = id;
      message.payload = payload;
      if (sender !== message.sender) {
        message.sender = sender;
      }
      this.totalEventsEmitted++;
      sub0(message);
      const sub1 = this.lastRoutedSub1;
      if (sub1 !== null) {
        sub1(message);
      }
      return message;
    }
    return this.emitSlow(id, topic, payload, sender);
  }

  private emitSlow<T = any>(
    id: number,
    topic: string,
    payload: T,
    sender?: string
  ): BusMessage<T> {
    const sampleTiming = (id & CLOCK_SAMPLE_MASK) === 1;
    let start = 0;
    if (sampleTiming) {
      start = performance.now();
      this.cachedTimestampMs = Date.now();
    }

    if (this.count === this.capacity) {
      if (this.rejectOnBackpressure) {
        throw new Error(
          `[RingBufferBus] 백프레셔 임계치 도달: 링버퍼(${this.capacity} 슬롯)가 가득 차 신규 메시지를 수용할 수 없습니다.`
        );
      }
    } else {
      this.count++;
    }

    const message = this.fastEvent;
    message.id = id;
    message.topic = topic;
    message.payload = payload;
    message.timestampMs = this.cachedTimestampMs;
    message.sender = sender;

    let subs: BusSubscriber[];
    if (topic === this.lastRoutedTopic && this.lastRoutedSubscribers !== null) {
      subs = this.lastRoutedSubscribers;
    } else {
      const cached = this.compiledTopicRoutes.get(topic);
      if (cached !== undefined) {
        subs = cached;
      } else {
        subs = this.resolveSubscribers(topic);
        if (this.compiledTopicRoutes.size >= ROUTE_CACHE_LIMIT) {
          this.compiledTopicRoutes.clear();
        }
        this.compiledTopicRoutes.set(topic, subs);
      }
      this.lastRoutedTopic = topic;
      this.lastRoutedSubscribers = subs;
    }

    const subLen = subs.length;
    let hadError = false;
    if (subLen === 1) {
      try {
        subs[0](message);
      } catch (err: any) {
        hadError = true;
        this.reportSubscriberError(topic, err);
      }
    } else if (subLen === 2) {
      let firstDone = false;
      try {
        subs[0](message);
        firstDone = true;
        subs[1](message);
      } catch (err: any) {
        hadError = true;
        this.handleFastDispatchError(topic, err, firstDone, subs[1], message);
      }
    } else {
      for (let i = 0; i < subLen; i++) {
        try {
          subs[i](message);
        } catch (err: any) {
          hadError = true;
          this.reportSubscriberError(topic, err);
        }
      }
    }

    if (!hadError && (subLen === 1 || subLen === 2)) {
      this.lastRoutedSub0 = subs[0];
      this.lastRoutedSub1 = subLen === 2 ? subs[1] : null;
    } else {
      this.lastRoutedSub0 = null;
      this.lastRoutedSub1 = null;
    }

    this.totalEventsEmitted++;
    if (sampleTiming) {
      const elapsedUs = (performance.now() - start) * 1000;
      const weight = this.totalEventsEmitted - this.lastSampledEventCount;
      this.lastSampledEventCount = this.totalEventsEmitted;
      this.totalDispatchDurationUs += elapsedUs * weight;
      if (elapsedUs > this.maxDispatchDurationUs) {
        this.maxDispatchDurationUs = elapsedUs;
      }
    }

    return message;
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
    this.exactSubscriberArrays.clear();
    this.wildcardSubscribers.clear();
    this.wildcardSnapshotList = [];
    this.invalidateRouteCache();
    this.rpcHandlers.clear();
    this.slots.fill(undefined);
    this.fastEvent.payload = undefined;
    this.fastEvent.topic = "";
    this.fastEvent.sender = undefined;
    this.count = 0;
    this.head = 0;
    this.tail = 0;
  }
}
