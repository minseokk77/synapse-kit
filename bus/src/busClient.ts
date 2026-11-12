/**
 * 시냅스 신경망 버스 통합 클라이언트 (Synapse Bus Unified Client)
 * - 인메모리 링버퍼 고속 디스패치와 IPC 프로세스 간 통신을 단일 인터페이스로 캡슐화 (Façade Pattern)
 */
import { RingBufferBus } from "./ringBufferBus";
import { IpcBusBridge } from "./ipcBus";
import type { BusConfig } from "./config";
import type {
  BusMessage,
  BusSubscriber,
  BusStats,
  RpcHandler,
  Unsubscribe,
} from "./types";

export class SynapseBus {
  private readonly ringBufferBus: RingBufferBus;
  private readonly ipcBridge: IpcBusBridge | null;

  constructor(private readonly config: BusConfig = {}) {
    this.ringBufferBus = new RingBufferBus(config);

    if (config.socketPath) {
      this.ipcBridge = new IpcBusBridge(this.ringBufferBus, config);
    } else {
      this.ipcBridge = null;
    }
  }

  /**
   * IPC 브리지 활성화 (설정된 socketPath 기반)
   */
  public async initIpc(): Promise<void> {
    if (!this.ipcBridge) return;
    if (this.config.isServer) {
      await this.ipcBridge.startServer();
    } else {
      await this.ipcBridge.connectClient();
    }
  }

  /**
   * 이벤트 발행 (Pub/Sub)
   */
  public emit<T = any>(topic: string, payload: T, sender?: string): BusMessage<T> {
    const msg = this.ringBufferBus.emit(topic, payload, sender);
    if (this.ipcBridge) {
      this.ipcBridge.broadcastRemote(msg);
    }
    return msg;
  }

  /**
   * 이벤트 토픽 구독
   */
  public subscribe<T = any>(topic: string, subscriber: BusSubscriber<T>): Unsubscribe {
    return this.ringBufferBus.subscribe(topic, subscriber);
  }

  /**
   * 이벤트 토픽 구독 별칭 (on)
   */
  public on<T = any>(topic: string, subscriber: BusSubscriber<T>): Unsubscribe {
    return this.subscribe(topic, subscriber);
  }

  /**
   * 1회성 이벤트 구독 (Once)
   */
  public once<T = any>(topic: string, subscriber: BusSubscriber<T>): Unsubscribe {
    const unbind = this.subscribe<T>(topic, (msg) => {
      unbind();
      subscriber(msg);
    });
    return unbind;
  }

  /**
   * RPC 핸들러 등록
   */
  public handle<TReq = any, TRes = any>(
    topic: string,
    handler: RpcHandler<TReq, TRes>
  ): Unsubscribe {
    return this.ringBufferBus.handle(topic, handler);
  }

  /**
   * RPC 프로시저 호출
   */
  public async call<TReq = any, TRes = any>(
    topic: string,
    payload: TReq,
    options?: { timeoutMs?: number; sender?: string }
  ): Promise<TRes> {
    return this.ringBufferBus.call<TReq, TRes>(topic, payload, options);
  }

  /**
   * 실시간 레이턴시 및 버스 메트릭 통계 조회
   */
  public getStats(): BusStats {
    return this.ringBufferBus.getStats();
  }

  /**
   * 버스 및 관련 소켓/타이머 리소스 안전 해제
   */
  public close(): void {
    if (this.ipcBridge) {
      this.ipcBridge.close();
    }
    this.ringBufferBus.close();
  }
}
