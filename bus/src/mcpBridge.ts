/**
 * 시냅스 Bus ↔ MCP 실시간 리소스 알림 브리지
 * - arXiv:2610.01364 (Structured Inter-Agent Communication Protocols)
 */

export const BUS_MCP_BRIDGE_CONFIG = {
  URI_SCHEME: "synapse://bus/",
  NOTIFICATION_METHOD: "notifications/resources/updated",
  JSONRPC_VERSION: "2.0",
} as const;

export interface McpResourceUpdatedNotification {
  readonly jsonrpc: "2.0";
  readonly method: "notifications/resources/updated";
  readonly params: {
    readonly uri: string;
    readonly topic: string;
    readonly lsn: number;
    readonly timestampMs: number;
    readonly payload: unknown;
  };
}

export type McpNotificationListener = (
  notification: McpResourceUpdatedNotification
) => void;

/**
 * 링버퍼/버스 토픽 이벤트를 MCP 표준 리소스 변경 알림으로 직결 변환하는 경량 브리지
 */
export class BusMcpBridge {
  private readonly topicListeners = new Map<string, Set<McpNotificationListener>>();
  private lsnCounter = 0;

  /**
   * 특정 토픽에 대한 MCP 알림 리스너 구독
   */
  public subscribeTopic(topic: string, listener: McpNotificationListener): () => void {
    let set = this.topicListeners.get(topic);
    if (!set) {
      set = new Set();
      this.topicListeners.set(topic, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  /**
   * 버스 이벤트를 MCP JSON-RPC 알림 객체로 변환하고 구독자에게 즉시 전파
   */
  public emitTopicEvent(topic: string, payload: unknown): McpResourceUpdatedNotification {
    const cleanTopic = topic.replace(/^\/+/, "");
    const notification: McpResourceUpdatedNotification = {
      jsonrpc: BUS_MCP_BRIDGE_CONFIG.JSONRPC_VERSION,
      method: BUS_MCP_BRIDGE_CONFIG.NOTIFICATION_METHOD,
      params: {
        uri: `${BUS_MCP_BRIDGE_CONFIG.URI_SCHEME}${cleanTopic}`,
        topic: cleanTopic,
        lsn: ++this.lsnCounter,
        timestampMs: Date.now(),
        payload,
      },
    };

    const listeners = this.topicListeners.get(topic);
    if (listeners) {
      for (const fn of listeners) {
        fn(notification);
      }
    }

    const wildcard = this.topicListeners.get("*");
    if (wildcard) {
      for (const fn of wildcard) {
        fn(notification);
      }
    }

    return notification;
  }

  public getCurrentLsn(): number {
    return this.lsnCounter;
  }
}
