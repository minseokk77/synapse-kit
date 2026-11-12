/**
 * P2P 피어 노드 헬스체크 및 자동 페일오버 라우터 (Peer Mesh Router & Failover)
 * - RTT 레이턴시 실시간 측정 및 노드 헬스체크
 * - 1차 노드 장애 시 우선순위 기반 자동 페일오버(Failover) 보장
 */
import { MESH_DEFAULTS, type PeerNodeInfo } from "./config";
import type { PeerRuntimeState } from "./types";

export class PeerMeshRouter {
  private readonly peers = new Map<string, PeerRuntimeState>();
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(initialPeers: readonly PeerNodeInfo[] = []) {
    for (const info of initialPeers) {
      this.addPeer(info);
    }
  }

  /**
   * 피어 등록
   */
  public addPeer(info: PeerNodeInfo): void {
    this.peers.set(info.id, {
      info,
      status: "HEALTHY",
      lastSeenMs: null,
      latencyMs: null,
      failureCount: 0,
    });
  }

  /**
   * 피어 제거
   */
  public removePeer(id: string): boolean {
    return this.peers.delete(id);
  }

  /**
   * 등록된 모든 피어 목록 반환
   */
  public getAllPeers(): PeerRuntimeState[] {
    return Array.from(this.peers.values());
  }

  /**
   * 최적의 활성 피어 선택 (우선순위 낮을수록 우선 + HEALTHY 상태 + 최저 지연시간)
   */
  public selectBestPeer(): PeerNodeInfo | null {
    const candidates = Array.from(this.peers.values()).filter(
      (p) => p.status === "HEALTHY" || p.status === "DEGRADED"
    );

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const pA = a.info.priority ?? 10;
      const pB = b.info.priority ?? 10;
      if (pA !== pB) return pA - pB;

      const latA = a.latencyMs ?? 9999;
      const latB = b.latencyMs ?? 9999;
      return latA - latB;
    });

    return candidates[0].info;
  }

  /**
   * 단일 피어 프로브 및 지연시간 측정
   */
  public async probePeer(id: string): Promise<boolean> {
    const peer = this.peers.get(id);
    if (!peer) return false;

    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), MESH_DEFAULTS.PEER_TIMEOUT_MS);

      const resp = await fetch(`${peer.info.endpoint}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const elapsedMs = performance.now() - start;
      if (resp.ok) {
        peer.status = "HEALTHY";
        peer.lastSeenMs = Date.now();
        peer.latencyMs = Number(elapsedMs.toFixed(2));
        peer.failureCount = 0;
        return true;
      } else {
        peer.status = "DEGRADED";
        peer.failureCount++;
        return false;
      }
    } catch {
      peer.failureCount++;
      if (peer.failureCount >= MESH_DEFAULTS.MAX_RETRY_COUNT) {
        peer.status = "UNREACHABLE";
      } else {
        peer.status = "DEGRADED";
      }
      return false;
    }
  }

  /**
   * 전체 피어 주기적 헬스체크 시작
   */
  public startHealthCheck(intervalMs: number = MESH_DEFAULTS.HEALTH_CHECK_INTERVAL_MS): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      for (const id of this.peers.keys()) {
        this.probePeer(id).catch(() => {});
      }
    }, intervalMs);
  }

  /**
   * 헬스체크 타이머 중단
   */
  public close(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.peers.clear();
  }
}
