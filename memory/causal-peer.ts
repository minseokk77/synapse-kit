import { CAUSAL_MEMORY_CONFIG } from './causal-config';
import { CausalMemoryStore, type CausalRule, type CausalRelation } from './causal-store';
import type { CausalQueryOptions, CausalResonanceResult } from './causal-store';

export interface TailscalePeerNode {
  readonly id: string;
  readonly hostName: string;
  readonly ip: string;
  readonly os: string;
  readonly online: boolean;
  readonly active: boolean;
  readonly isSelf: boolean;
}

export interface PeerHealthResult {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly reachable: boolean;
  readonly rttMs: number;
  readonly version?: string;
  readonly totalRules?: number;
  readonly totalRelations?: number;
  readonly error?: string;
}

export interface PeerSyncResult {
  readonly targetHost: string;
  readonly direction: 'pull' | 'push';
  readonly success: boolean;
  readonly durationMs: number;
  readonly addedRules?: number;
  readonly updatedRules?: number;
  readonly addedRelations?: number;
  readonly totalRules?: number;
  readonly totalRelations?: number;
  readonly error?: string;
}

/**
 * Tailscale CLI 상태를 파싱하여 활성 피어 목록을 조회합니다.
 */
export async function getTailscalePeers(): Promise<{
  selfIp?: string;
  selfHost?: string;
  peers: TailscalePeerNode[];
}> {
  try {
    const proc = Bun.spawn(['tailscale', 'status', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const data = JSON.parse(output);

    const selfIp = data.Self?.TailscaleIPs?.[0];
    const selfHost = data.Self?.HostName;

    const peers: TailscalePeerNode[] = [];

    if (data.Self) {
      peers.push({
        id: data.Self.ID || 'self',
        hostName: data.Self.HostName || 'localhost',
        ip: selfIp || '127.0.0.1',
        os: data.Self.OS || process.platform,
        online: data.Self.Online ?? true,
        active: true,
        isSelf: true,
      });
    }

    if (data.Peer) {
      for (const key of Object.keys(data.Peer)) {
        const p = data.Peer[key];
        const peerIp = p.TailscaleIPs?.[0] || '';
        peers.push({
          id: p.ID || key,
          hostName: p.HostName || '',
          ip: peerIp,
          os: p.OS || 'unknown',
          online: Boolean(p.Online),
          active: Boolean(p.Active),
          isSelf: false,
        });
      }
    }

    return { selfIp, selfHost, peers };
  } catch (error) {
    // Tailscale 미설치 또는 실행 실패 시 빈 목록 반환
    return {
      peers: [],
    };
  }
}

/**
 * 대상 호스트의 Causal Memory Daemon 헬스체크 및 RTT 측정
 */
export async function pingPeer(
  host: string,
  port: number = CAUSAL_MEMORY_CONFIG.DEFAULT_PORT
): Promise<PeerHealthResult> {
  const url = `http://${host}:${port}/health`;
  const startTime = performance.now();

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(CAUSAL_MEMORY_CONFIG.REMOTE_TIMEOUT_MS),
    });

    const rttMs = Math.round((performance.now() - startTime) * 100) / 100;

    if (!res.ok) {
      return {
        host,
        port,
        url,
        reachable: false,
        rttMs,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    const data: any = await res.json();
    return {
      host,
      port,
      url,
      reachable: true,
      rttMs,
      version: data.status?.version,
      totalRules: data.status?.totalRules,
      totalRelations: data.status?.totalRelations,
    };
  } catch (error) {
    const rttMs = Math.round((performance.now() - startTime) * 100) / 100;
    return {
      host,
      port,
      url,
      reachable: false,
      rttMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 원격 Causal Memory Daemon에 공명 쿼리 실행
 */
export async function queryRemotePeer(
  remoteUrl: string,
  options: CausalQueryOptions
): Promise<CausalResonanceResult> {
  const cleanUrl = remoteUrl.replace(/\/+$/, '');
  const endpoint = cleanUrl.endsWith('/query') ? cleanUrl : `${cleanUrl}/query`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
    signal: AbortSignal.timeout(CAUSAL_MEMORY_CONFIG.REMOTE_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`원격 인과율 쿼리 실패: HTTP ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as CausalResonanceResult;
}

/**
 * 피어 노드 간 인과율 규칙 및 간선 동기화 (Sync)
 */
export async function syncWithPeer(
  remoteHost: string,
  port: number = CAUSAL_MEMORY_CONFIG.DEFAULT_PORT,
  direction: 'pull' | 'push' = 'pull',
  dbPath?: string
): Promise<PeerSyncResult> {
  const store = new CausalMemoryStore(dbPath);
  const cleanHost = remoteHost.replace(/^https?:\/\//, '').split(':')[0];
  const targetPort = remoteHost.includes(':')
    ? parseInt(remoteHost.split(':')[1].replace(/\/.*/, ''), 10) || port
    : port;
  const baseUrl = `http://${cleanHost}:${targetPort}`;
  const startTime = performance.now();

  try {
    if (direction === 'pull') {
      // 1. 원격에서 데이터 가져오기 (GET /sync)
      const res = await fetch(`${baseUrl}/sync`, {
        method: 'GET',
        signal: AbortSignal.timeout(CAUSAL_MEMORY_CONFIG.REMOTE_TIMEOUT_MS),
      });

      if (!res.ok) {
        throw new Error(`원격 데이터 가져오기 실패: HTTP ${res.status}`);
      }

      const remoteDb: any = await res.json();
      const rules: CausalRule[] = Array.isArray(remoteDb.rules) ? remoteDb.rules : [];
      const relations: CausalRelation[] = Array.isArray(remoteDb.relations) ? remoteDb.relations : [];

      const mergeResult = store.mergeDatabase(rules, relations);
      const durationMs = Math.round((performance.now() - startTime) * 100) / 100;

      return {
        targetHost: cleanHost,
        direction: 'pull',
        success: true,
        durationMs,
        addedRules: mergeResult.addedRules,
        updatedRules: mergeResult.updatedRules,
        addedRelations: mergeResult.addedRelations,
        totalRules: mergeResult.totalRules,
        totalRelations: mergeResult.totalRelations,
      };
    } else {
      // 2. 로컬 데이터를 원격으로 푸시 (POST /sync)
      const rawDb = store.getRawDatabase();
      const res = await fetch(`${baseUrl}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rawDb),
        signal: AbortSignal.timeout(CAUSAL_MEMORY_CONFIG.REMOTE_TIMEOUT_MS),
      });

      if (!res.ok) {
        throw new Error(`원격 데이터 푸시 실패: HTTP ${res.status}`);
      }

      const pushResult: any = await res.json();
      const durationMs = Math.round((performance.now() - startTime) * 100) / 100;

      return {
        targetHost: cleanHost,
        direction: 'push',
        success: true,
        durationMs,
        addedRules: pushResult.addedRules,
        updatedRules: pushResult.updatedRules,
        addedRelations: pushResult.addedRelations,
        totalRules: pushResult.totalRules,
        totalRelations: pushResult.totalRelations,
      };
    }
  } catch (error) {
    const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
    return {
      targetHost: cleanHost,
      direction,
      success: false,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
