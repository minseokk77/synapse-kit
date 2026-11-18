import { describe, expect, it } from "bun:test";
import { SynapseModuleRegistry } from "../compiler";
import { SYNAPSE_MCP_TOOLS } from "../compiler/mcp";

describe("🧩 Synapse Hybrid Module Registry (Feature-Gate + 듀얼 리졸버 + 동적 MCP 필터)", () => {
  it("1. [Feature-Gate] minimal / coding 프로파일에서 비활성 모듈 로드 차단 (메모리 0 비용)", async () => {
    const reg = new SynapseModuleRegistry({ profile: "coding" });
    expect(reg.isEnabled("codemap")).toBe(true);
    expect(reg.isEnabled("sandbox-fs")).toBe(true);
    expect(reg.isEnabled("dci")).toBe(false);
    expect(reg.isEnabled("voice")).toBe(false);

    // 비활성 모듈 로드 시도 시 즉시 거부
    let blocked = false;
    try {
      await reg.load("dci");
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
    expect(reg.listLoaded().length).toBe(0);

    // 필요할 때만 enable 후 지연 로드
    reg.enable("codemap");
    const loaded = await reg.load<any>("codemap");
    expect(loaded.source).toBe("builtin");
    expect(typeof loaded.exports.buildRepoMap).toBe("function");
    expect(reg.listLoaded()).toEqual(["codemap"]);
  });

  it("2. [동적 MCP 노출] 프로파일별 필요한 MCP 도구만 필터링해 프롬프트 토큰 절감", () => {
    const minimalReg = new SynapseModuleRegistry({ profile: "minimal" });
    const minimalTools = minimalReg.filterMcpTools(SYNAPSE_MCP_TOOLS);
    expect(minimalTools.map((t) => t.name)).toEqual(["synapse_verifier_check"]);

    const docsReg = new SynapseModuleRegistry({ profile: "docs" });
    const docsTools = docsReg.filterMcpTools(SYNAPSE_MCP_TOOLS);
    expect(docsTools.map((t) => t.name)).toContain("synapse_db_search");
    expect(docsTools.map((t) => t.name)).toContain("synapse_causal_query");
    expect(docsTools.map((t) => t.name)).not.toContain("synapse_guard_audit");

    const fullReg = new SynapseModuleRegistry({ profile: "full" });
    expect(fullReg.filterMcpTools(SYNAPSE_MCP_TOOLS).length).toBe(SYNAPSE_MCP_TOOLS.length);
  });

  it("3. [듀얼 리졸버] 내장 폴백 로드 및 disable 시 캐시 해제", async () => {
    const reg = new SynapseModuleRegistry({ profile: "docs", preferExternal: true });
    const dciMod = await reg.load<any>("dci");
    expect(typeof dciMod.exports.SynapseDciWorkspace).toBe("function");

    const aiVecMod = await reg.load<any>("ai-core");
    expect(typeof aiVecMod.exports.QuantizedVectorIndex).toBe("function");

    reg.disable("dci");
    expect(reg.isEnabled("dci")).toBe(false);
    expect(reg.listLoaded()).not.toContain("dci");
  });
});
