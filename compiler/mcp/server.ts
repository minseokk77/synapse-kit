/**
 * 시냅스 공식 Model Context Protocol (MCP) Stdio 서버 구현
 */
import readline from "node:readline";
import { SYNAPSE_MCP_TOOLS, executeMcpTool } from "./tools";
import type { McpRequest, McpResponse } from "./types";

export class SynapseMcpServer {
  private rl: readline.Interface | null = null;

  /**
   * Stdio 기반 MCP 리스너 구동
   */
  public start(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req: McpRequest = JSON.parse(trimmed);
        const res = await this.handleRequest(req);
        if (res) {
          process.stdout.write(JSON.stringify(res) + "\n");
        }
      } catch (err: any) {
        const errRes: McpResponse = {
          jsonrpc: "2.0",
          id: 0,
          error: {
            code: -32700,
            message: `JSON 파싱 오류: ${err?.message || err}`,
          },
        };
        process.stdout.write(JSON.stringify(errRes) + "\n");
      }
    });

    // 프로세스 종료 가드
    process.on("SIGINT", () => this.stop());
    process.on("SIGTERM", () => this.stop());
  }

  /**
   * 요청 라우팅 및 처리
   */
  public async handleRequest(req: McpRequest): Promise<McpResponse | null> {
    const { id, method, params } = req;

    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "synapse-mcp",
              version: "0.4.0",
            },
          },
        };

      case "notifications/initialized":
        // 초기화 완료 알림 (응답 불필요)
        return null;

      case "ping":
        return {
          jsonrpc: "2.0",
          id,
          result: {},
        };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: SYNAPSE_MCP_TOOLS,
          },
        };

      case "tools/call": {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        const result = await executeMcpTool(toolName, toolArgs);
        return {
          jsonrpc: "2.0",
          id,
          result,
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `지원하지 않는 메서드: ${method}`,
          },
        };
    }
  }

  public stop(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
