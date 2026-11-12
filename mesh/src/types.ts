/**
 * 시냅스 분산 메쉬 네트워크 타입 명세 (Synapse Mesh Types)
 */
import type { PeerNodeInfo } from "./config";

export interface VaultFileMetadata {
  /** 상대 경로 (예: "rules/rule_alpha.md") */
  readonly relativePath: string;
  /** 파일 내용 해시 (SHA-256) */
  readonly hash: string;
  /** 최종 수정 시각 (ms) */
  readonly updatedAtMs: number;
  /** 파일 크기 (bytes) */
  readonly sizeBytes: number;
}

export interface VaultSyncManifest {
  readonly nodeId: string;
  readonly timestampMs: number;
  readonly files: Record<string, VaultFileMetadata>;
}

export interface VaultSyncDelta {
  readonly toPull: readonly string[];
  readonly toPush: readonly string[];
  readonly conflictsResolved: readonly {
    readonly path: string;
    readonly winningSource: "LOCAL" | "REMOTE";
    readonly reason: string;
  }[];
}

export type PeerHealthStatus = "HEALTHY" | "DEGRADED" | "UNREACHABLE";

export interface PeerRuntimeState {
  readonly info: PeerNodeInfo;
  status: PeerHealthStatus;
  lastSeenMs: number | null;
  latencyMs: number | null;
  failureCount: number;
}

export interface MeshStats {
  readonly nodeId: string;
  readonly isRunning: boolean;
  readonly activePeersCount: number;
  readonly peerStates: readonly {
    readonly id: string;
    readonly endpoint: string;
    readonly status: PeerHealthStatus;
    readonly latencyMs: number | null;
  }[];
  readonly totalSyncedFilesCount: number;
  readonly lastSyncTimestampMs: number | null;
  readonly tunnelUrl: string | null;
}
