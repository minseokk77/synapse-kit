/**
 * 시냅스 분산 메쉬 네트워크 통합 파사드 (Synapse Mesh Unified Façade)
 */
import { DistributedVaultSynchronizer } from "./vaultSync";
import { PeerMeshRouter } from "./peerMesh";
import { CloudflareTunnelManager } from "./tunnel";
import { MESH_DEFAULTS, type MeshConfig } from "./config";
import type { MeshStats, VaultSyncDelta, VaultSyncManifest } from "./types";

export class SynapseMesh {
  public readonly nodeId: string;
  public readonly vaultSync: DistributedVaultSynchronizer;
  public readonly router: PeerMeshRouter;
  public readonly tunnel: CloudflareTunnelManager;

  private isRunning = false;
  private lastSyncAtMs: number | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(vaultDir: string, private readonly config: MeshConfig = {}) {
    this.nodeId = config.nodeId || `node_${Math.random().toString(36).slice(2, 9)}`;
    this.vaultSync = new DistributedVaultSynchronizer(vaultDir);
    this.router = new PeerMeshRouter(config.initialPeers || []);
    this.tunnel = new CloudflareTunnelManager();
  }

  /**
   * 로컬 매니페스트 생성
   */
  public getLocalManifest(): VaultSyncManifest {
    return this.vaultSync.generateManifest(this.nodeId);
  }

  /**
   * 원격 매니페스트와 비교하여 델타 계산
   */
  public diffManifest(remoteManifest: VaultSyncManifest): VaultSyncDelta {
    const local = this.getLocalManifest();
    return this.vaultSync.computeDelta(local, remoteManifest);
  }

  /**
   * 메쉬 서비스 시작
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    this.router.startHealthCheck(this.config.healthCheckIntervalMs);

    if (this.config.tunnelEnabled) {
      const port = this.config.port ?? MESH_DEFAULTS.PORT;
      await this.tunnel.startTunnel(port, this.config.tunnelHostname);
    }
  }

  /**
   * 실시간 통계 조회
   */
  public getStats(): MeshStats {
    const peers = this.router.getAllPeers();
    const activePeers = peers.filter((p) => p.status === "HEALTHY" || p.status === "DEGRADED");
    const manifest = this.getLocalManifest();

    return {
      nodeId: this.nodeId,
      isRunning: this.isRunning,
      activePeersCount: activePeers.length,
      peerStates: peers.map((p) => ({
        id: p.info.id,
        endpoint: p.info.endpoint,
        status: p.status,
        latencyMs: p.latencyMs,
      })),
      totalSyncedFilesCount: Object.keys(manifest.files).length,
      lastSyncTimestampMs: this.lastSyncAtMs,
      tunnelUrl: this.tunnel.getTunnelUrl(),
    };
  }

  /**
   * 리소스 정리
   */
  public close(): void {
    this.isRunning = false;
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.router.close();
    this.tunnel.close();
  }
}

export * from "./config";
export * from "./types";
export * from "./vaultSync";
export * from "./peerMesh";
export * from "./tunnel";
