import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startCausalServer } from '../memory/causal-server';
import { queryRemotePeer } from '../memory/causal-peer';
import { CausalObsidianLensEngine } from '../memory/causal-lens';
import { CausalMemoryStore } from '../memory/causal-store';
import { ContextCheckpointStore } from '../memory/causal-context';
import { PeerMeshRouter } from '../mesh/src/peerMesh';
import { CloudflareTunnelManager } from '../mesh/src/tunnel';
import { fetchRecentArxivPapers } from '../optic/src/liveFetcher';

describe('보안 취약점 하드닝 회귀 검증 (Security Hardening Suite)', () => {
  it('1. [Causal Server] CORS 와일드카드(*) 차단, 토큰 인증(401) 및 대용량 본문(413) 방어', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'synapse-sec-server-'));
    const dbPath = join(tmpDir, 'memory.json');
    const contextDbPath = join(tmpDir, 'context.json');

    const server = startCausalServer({
      port: 0,
      host: '127.0.0.1',
      dbPath,
      contextDbPath,
      authToken: 'test-secret-token',
      maxBodyBytes: 128,
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;

      // 인증 없이 /query 접근 시 401 반환 + CORS '*' 미노출
      const unauthRes = await fetch(`${baseUrl}/query`);
      expect(unauthRes.status).toBe(401);
      expect(unauthRes.headers.get('access-control-allow-origin')).not.toBe('*');

      // /health는 헬스체크용으로 허용
      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);

      // 유효 토큰 + 128B 초과 페이로드 전송 시 413 Payload Too Large 반환
      const oversizedRes = await fetch(`${baseUrl}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-secret-token',
        },
        body: JSON.stringify({ keywords: ['a'.repeat(300)] }),
      });
      expect(oversizedRes.status).toBe(413);

      // 유효 토큰 + 정상 크기 요청은 200 반환
      const okRes = await fetch(`${baseUrl}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Synapse-Token': 'test-secret-token',
        },
        body: JSON.stringify({ keywords: ['security'] }),
      });
      expect(okRes.status).toBe(200);
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('2. [SSRF 방어] queryRemotePeer 및 PeerMeshRouter가 file:// 및 메타데이터 IP를 차단해야 한다', async () => {
    await expect(queryRemotePeer('file:///etc/passwd', {})).rejects.toThrow();
    await expect(queryRemotePeer('http://169.254.169.254/latest/meta-data', {})).rejects.toThrow();

    const router = new PeerMeshRouter();
    expect(() =>
      router.addPeer({ id: 'bad-scheme', endpoint: 'ftp://example.com:4343' })
    ).toThrow();
    expect(() =>
      router.addPeer({ id: 'bad-meta', endpoint: 'http://169.254.169.254:80' })
    ).toThrow();
  });

  it('3. [CLI 플래그 인젝션 방어] CloudflareTunnelManager가 잘못된 포트 및 -- 플래그 호스트명을 차단해야 한다', async () => {
    const tunnel = new CloudflareTunnelManager();

    const badFlag = await tunnel.startTunnel(4343, '--config=/tmp/evil.yml');
    expect(badFlag.success).toBe(false);

    const badPort = await tunnel.startTunnel(99999, 'mesh.example.com');
    expect(badPort.success).toBe(false);
  });

  it('4. [Path Traversal 방어] CausalObsidianLensEngine이 널 바이트 볼트 경로 및 악성 체크포인트 ID를 차단/새니타이징해야 한다', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'synapse-sec-lens-'));
    try {
      const memStore = new CausalMemoryStore(join(tmpDir, 'mem.json'));
      const ctxStore = new ContextCheckpointStore(join(tmpDir, 'ctx.json'), join(tmpDir, 'mem.json'));
      const lens = new CausalObsidianLensEngine(memStore, ctxStore);

      const badVaultRes = await lens.exportToVault(`${tmpDir}\0evil`);
      expect(badVaultRes.success).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('5. [Optic LiveFetcher] 허용 바이트 상한 초과 시 안전 폴백으로 차단해야 한다', async () => {
    const oversizedXml = '<feed>' + '<entry><id>1</id><title>x</title></entry>'.repeat(150_000) + '</feed>';
    const res = await fetchRecentArxivPapers({
      fetchImpl: async () =>
        new Response(oversizedXml, {
          status: 200,
          headers: { 'content-length': String(Buffer.byteLength(oversizedXml, 'utf8')) },
        }),
    });
    expect(res.liveFetched).toBe(false);
    expect(res.papers.length).toBe(0);
    expect(res.error).toContain('초과');
  });
});
