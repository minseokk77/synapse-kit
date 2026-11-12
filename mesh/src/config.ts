/**
 * 시냅스 분산 메쉬 네트워크 전역 설정 및 기본 상수 (Synapse Mesh Configuration)
 */

export interface PeerNodeInfo {
  /** 피어 노드 식별자 */
  readonly id: string;
  /** 피어 접근 주소 (예: "http://100.x.y.z:4343" 또는 "https://mesh.minseok.online") */
  readonly endpoint: string;
  /** 노드 역할 (예: "local-pc", "oracle-vm", "mobile-worker") */
  readonly role?: string;
  /** 우선순위 (낮을수록 선호, 1이 최고 우선순위) */
  readonly priority?: number;
}

export interface MeshConfig {
  /** 현재 노드 고유 식별자 */
  readonly nodeId?: string;
  /** 로컬 P2P 메쉬 수신 포트 (기본: 4343) */
  readonly port?: number;
  /** 기본 피어 노드 목록 */
  readonly initialPeers?: readonly PeerNodeInfo[];
  /** 볼트 동기화 주기 (ms, 기본: 1000) */
  readonly syncIntervalMs?: number;
  /** 헬스체크 주기 (ms, 기본: 5000) */
  readonly healthCheckIntervalMs?: number;
  /** Cloudflare 터널 자동 개통 여부 */
  readonly tunnelEnabled?: boolean;
  /** Cloudflare 고정 도메인 호스트명 (예: "clip.minseok.online") */
  readonly tunnelHostname?: string;
}

export const MESH_DEFAULTS = {
  PORT: 4343,
  SYNC_INTERVAL_MS: 1000,
  HEALTH_CHECK_INTERVAL_MS: 5000,
  PEER_TIMEOUT_MS: 3000,
  MAX_RETRY_COUNT: 3,
} as const;
