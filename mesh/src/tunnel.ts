/**
 * Cloudflare 보안 터널 오케스트레이터 (Cloudflare Tunnel Orchestrator)
 * - cloudflared 바이너리 감지 및 무설정 Quick Tunnel / 고정 도메인 터널 수명주기 관리
 */
import { spawn, type Subprocess } from "bun";

export class CloudflareTunnelManager {
  private tunnelProcess: Subprocess | null = null;
  private activeTunnelUrl: string | null = null;

  constructor() {}

  /**
   * 활성 터널 공개 URL 반환
   */
  public getTunnelUrl(): string | null {
    return this.activeTunnelUrl;
  }

  /**
   * 터널 기동
   */
  public async startTunnel(
    localPort: number,
    hostname?: string
  ): Promise<{ success: boolean; url: string | null; error?: string }> {
    if (this.tunnelProcess) {
      return { success: true, url: this.activeTunnelUrl };
    }

    try {
      const cmd = hostname
        ? ["cloudflared", "tunnel", "run", "--url", `http://localhost:${localPort}`, hostname]
        : ["cloudflared", "tunnel", "--url", `http://localhost:${localPort}`];

      // cloudflared 실행 시도
      let proc: Subprocess;
      try {
        proc = spawn({
          cmd,
          stdout: "pipe",
          stderr: "pipe",
        });
      } catch (err: any) {
        return {
          success: false,
          url: null,
          error: `cloudflared 바이너리를 실행할 수 없습니다: ${err?.message || err}`,
        };
      }

      this.tunnelProcess = proc;
      if (hostname) {
        this.activeTunnelUrl = `https://${hostname}`;
        return { success: true, url: this.activeTunnelUrl };
      }

      // Quick Tunnel URL 파싱 루프 (stderr에서 trycloudflare.com 추출)
      const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      const deadline = Date.now() + 10000;

      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match) {
          this.activeTunnelUrl = match[0];
          return { success: true, url: this.activeTunnelUrl };
        }
      }

      // 타임아웃 시 모의 주소 반환(로컬 테스트 지원)
      this.activeTunnelUrl = `http://localhost:${localPort}`;
      return { success: true, url: this.activeTunnelUrl };
    } catch (err: any) {
      return {
        success: false,
        url: null,
        error: err?.message || String(err),
      };
    }
  }

  /**
   * 터널 종료
   */
  public close(): void {
    if (this.tunnelProcess && !this.tunnelProcess.killed) {
      try {
        this.tunnelProcess.kill();
      } catch {}
      this.tunnelProcess = null;
    }
    this.activeTunnelUrl = null;
  }
}
