/**
 * 시냅스 공식 Model Context Protocol (MCP) 서버 종합 검증 스위트
 */
import { describe, it, expect } from "bun:test";
import { SynapseMcpServer, SYNAPSE_MCP_TOOLS } from "../compiler/mcp";

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
    expect(res?.result.serverInfo.version).toBe("0.4.1");
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

  it("6. [도구 실행 - Causal Memory 인과 쿼리] synapse_causal_query 호출 시 ok: true 및 rules 배열 반환 검증", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "synapse_causal_query",
        arguments: {
          query: "preference rules",
          limit: 5,
        },
      },
    });

    expect(res).not.toBeNull();
    expect(res?.result.isError).toBeFalsy();
    const data = JSON.parse(res?.result.content[0].text);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.rules)).toBe(true);
    expect(typeof data.queryDurationMs).toBe("number");
  });

  it("7. [도구 실행 - Verifier 불변식 검증 정상 코드 통과] synapse_verifier_check 정상 코드(const a = 1;) 통과 검증", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "synapse_verifier_check",
        arguments: {
          code: "const a = 1;",
          fileName: "clean.ts",
        },
      },
    });

    expect(res).not.toBeNull();
    expect(res?.result.isError).toBe(false);
    const data = JSON.parse(res?.result.content[0].text);
    expect(data.ok).toBe(true);
    expect(data.violations.length).toBe(0);
  });

  it("8. [도구 실행 - Verifier 불변식 검증 위반 코드 차단] synapse_verifier_check 위반 코드(console.log) 차단 검증", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "synapse_verifier_check",
        arguments: {
          code: 'console.log("debug")',
          fileName: "dirty.ts",
        },
      },
    });

    expect(res).not.toBeNull();
    expect(res?.result.isError).toBe(true);
    const data = JSON.parse(res?.result.content[0].text);
    expect(data.ok).toBe(false);
    expect(data.violations.length).toBeGreaterThan(0);
    expect(data.violations[0].ruleId).toBe("NO_CONSOLE_LOG_DEBUG");
  });

  it("9. [도구 실행 - DB 커넥톰 검색] synapse_db_search 실제 호출 및 ok: true, results 배열 반환 검증", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "synapse_db_search",
        arguments: {
          query: "synapse",
        },
      },
    });

    expect(res).not.toBeNull();
    expect(res?.result.isError).toBeFalsy();
    const data = JSON.parse(res?.result.content[0].text);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.results)).toBe(true);
  });

  it("10. [초경량 직렬화 - Compact 옵션] compact: true 옵션 전달 시 줄바꿈(\\n) 없는 단일 라인 JSON 반환 검증", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "synapse_causal_query",
        arguments: {
          query: "preference",
          limit: 2,
          compact: true,
        },
      },
    });

    expect(res).not.toBeNull();
    const rawText = res?.result.content[0].text;
    expect(rawText.includes("\n")).toBe(false);
    const data = JSON.parse(rawText);
    expect(data.ok).toBe(true);
  });
});
