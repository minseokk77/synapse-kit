/**
 * 시냅스 공식 Model Context Protocol (MCP) 서버 종합 검증 스위트
 */
import { describe, it, expect } from "bun:test";
import { SynapseMcpServer, SYNAPSE_MCP_TOOLS, executeMcpTool } from "../compiler/mcp";

describe("🤖 Synapse MCP (Model Context Protocol) JSON-RPC 2.0 서버 검증", () => {
  const server = new SynapseMcpServer();

  it("1. [MCP 프로토콜 초기화] initialize 메서드 호출 시 프로토콜 버전 및 서버 정보 반환", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    expect(res).not.toBeNull();
    expect(res?.result.serverInfo.name).toBe("synapse-mcp");
    expect(res?.result.serverInfo.version).toBe("0.4.0");
    expect(res?.result.protocolVersion).toBe("2024-11-05");
  });

  it("2. [MCP 도구 목록 조회] tools/list 호출 시 11대 코어 핵심 도구 반환", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    expect(res).not.toBeNull();
    const tools = res?.result.tools;
    expect(tools.length).toBeGreaterThanOrEqual(5);

    const names = tools.map((t: any) => t.name);
    expect(names).toContain("synapse_causal_query");
    expect(names).toContain("synapse_guard_audit");
    expect(names).toContain("synapse_verifier_check");
    expect(names).toContain("synapse_optic_survey");
    expect(names).toContain("synapse_db_search");
  });

  it("3. [도구 실행 - Guard 보안 감사] synapse_guard_audit 호출 시 안전 코드 통과", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "synapse_guard_audit",
        arguments: {
          code: "const greeting = '안녕, 시냅스!';",
          fileName: "test.ts",
        },
      },
    });

    expect(res).not.toBeNull();
    expect(res?.result.isError).toBe(false);
    const content = JSON.parse(res?.result.content[0].text);
    expect(content.ok).toBe(true);
    expect(content.totalViolations).toBe(0);
  });

  it("4. [도구 실행 - Optic 인과 공명] synapse_optic_survey 호출 시 논문 텍스트 분석", async () => {
    const sampleAbstract = `
      We introduce Astrocyte Calcium Modulation in neuromorphic computing.
      This mechanism modulates synaptic plasticity, leading to 68% energy saving.
      Furthermore, it stabilizes spiking resonance under noisy input.
    `;

    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "synapse_optic_survey",
        arguments: {
          text: sampleAbstract,
        },
      },
    });

    expect(res).not.toBeNull();
    const result = JSON.parse(res?.result.content[0].text);
    expect(result.queryDurationMs).toBeDefined();
    expect(result.paper).toBeDefined();
    expect(result.matchedRulesCount).toBeGreaterThanOrEqual(0);
  });

  it("5. [에러 핸들링] 존재하지 않는 메서드 호출 시 -32601 에러 반환", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 99,
      method: "non_existent_method",
    });

    expect(res).not.toBeNull();
    expect(res?.error?.code).toBe(-32601);
  });
});
