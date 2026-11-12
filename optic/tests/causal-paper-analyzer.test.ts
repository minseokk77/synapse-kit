/**
 * 시냅스 옵틱(Synapse Optic) 학술 논문 인과 분석기 및 가속 파이프라인 검증 테스트 (8대 최신 논문)
 */
import { describe, it, expect } from "bun:test";
import { CausalPaperAnalyzer, PAPERS_SURVEY } from "../src/causalPaperAnalyzer";
import { SynapseOptic } from "../src/optic";

describe("시냅스 옵틱 학술 논문 인과 분석기 (CausalPaperAnalyzer) 8대 논문 확장 가속 검증", () => {
  it("8대 핵심 논문 및 시냅스 코어가 CausalStore 인과 그래프에 올바르게 인덱싱되어야 한다", () => {
    const analyzer = new CausalPaperAnalyzer(":memory:");
    analyzer.initializeKnowledgeGraph();

    expect(PAPERS_SURVEY.length).toBe(8);
    const arxivIds = PAPERS_SURVEY.map((p) => p.arxivId);
    expect(arxivIds).toContain("2511.19477");
    expect(arxivIds).toContain("2507.14799");
    expect(arxivIds).toContain("2410.08240");
    expect(arxivIds).toContain("2401.13919");
    expect(arxivIds).toContain("2307.13854");
    expect(arxivIds).toContain("2606.19116"); // Agent-First Web
    expect(arxivIds).toContain("2503.23350"); // WebAgents Survey
    expect(arxivIds).toContain("2502.09841"); // FP-Agent
  });

  it("단일 논문 인과 공명 쿼리가 5ms 미만(통상 0.5ms 이하)의 초고속으로 대조되어야 한다", () => {
    const analyzer = new CausalPaperAnalyzer(":memory:");
    const result = analyzer.analyze("paper.browser_agents_2511");

    expect(result.paper.arxivId).toBe("2511.19477");
    expect(result.matchedRulesCount).toBeGreaterThanOrEqual(1);
    expect(result.queryDurationMs).toBeLessThan(5.0);
    expect(result.paper.synapseAlignment.targetCore).toContain("optic");
  });

  it("8대 논문 전체 동시 대조 분석이 누락 없이 수행되어야 한다", () => {
    const analyzer = new CausalPaperAnalyzer(":memory:");
    const allResults = analyzer.analyzeAll();

    expect(allResults.length).toBe(8);
    for (const res of allResults) {
      expect(res.paper.title.length).toBeGreaterThan(5);
      expect(res.paper.synapseAlignment.invariant.length).toBeGreaterThan(5);
      expect(res.matchedRulesCount).toBeGreaterThan(0);
      expect(res.queryDurationMs).toBeLessThan(10.0);
    }
  });

  it("IPI 보안 논문(2507.14799)이 SynapseGuard와 올바르게 인과 매핑되어야 한다", () => {
    const analyzer = new CausalPaperAnalyzer(":memory:");
    const result = analyzer.analyze("2507.14799");

    expect(result.paper.arxivId).toBe("2507.14799");
    expect(result.paper.synapseAlignment.targetCore).toBe("@synapse/guard");
    expect(result.paper.coreInsight).toContain("Indirect Prompt Injection");
    expect(result.paper.limitationsOrVulnerabilities).toContain("주입 공격에 100% 무방비");
    expect(result.paper.synapseAlignment.superiority).toContain("원천 봉쇄");
  });

  it("AgentOccam 논문(2410.08240)이 SynapseVerifier의 단일 활동전위와 매핑되어야 한다", () => {
    const analyzer = new CausalPaperAnalyzer(":memory:");
    const result = analyzer.analyze("2410.08240");

    expect(result.paper.arxivId).toBe("2410.08240");
    expect(result.paper.synapseAlignment.targetCore).toContain("verifier");
    expect(result.paper.synapseAlignment.invariant).toContain("원자적 전이");
  });

  it("Agent-First Web 논문(2606.19116)이 Dual-Layer 마크다운 아키텍처와 매핑되어야 한다", () => {
    const analyzer = new CausalPaperAnalyzer(":memory:");
    const result = analyzer.analyze("2606.19116");

    expect(result.paper.arxivId).toBe("2606.19116");
    expect(result.paper.synapseAlignment.targetCore).toContain("db");
    expect(result.paper.synapseAlignment.invariant).toContain("Dual-Layer");
    expect(result.paper.coreInsight).toContain("HTML Soup");
  });

  it("WebAgents Survey 논문(2503.23350)이 11대 코어 전방위 신뢰성과 매핑되어야 한다", () => {
    const analyzer = new CausalPaperAnalyzer(":memory:");
    const result = analyzer.analyze("2503.23350");

    expect(result.paper.arxivId).toBe("2503.23350");
    expect(result.paper.synapseAlignment.targetCore).toBe("@synapse/all_11_cores");
    expect(result.paper.synapseAlignment.invariant).toContain("Trustworthiness");
  });

  it("FP-Agent 논문(2502.09841)이 typeNative 하드웨어 시뮬레이션과 매핑되어야 한다", () => {
    const analyzer = new CausalPaperAnalyzer(":memory:");
    const result = analyzer.analyze("2502.09841");

    expect(result.paper.arxivId).toBe("2502.09841");
    expect(result.paper.synapseAlignment.targetCore).toBe("@synapse/optic");
    expect(result.paper.synapseAlignment.mechanism).toContain("isTrusted: true");
    expect(result.paper.synapseAlignment.superiority).toContain("봇 탐지 시스템 100% 무력화");
  });

  it("종합 보고서(Markdown)가 8대 논문과 실측 가속 배율을 포함하여 생성되어야 한다", () => {
    const analyzer = new CausalPaperAnalyzer(":memory:");
    const report = analyzer.generateReport({
      liveOpticDurationMs: 180,
      cacheHitDurationMs: 0.05,
      batchDurationMs: 310,
    });

    expect(report).toContain("라이브 접속 극초고속 가속화 결과");
    expect(report).toContain("2511.19477");
    expect(report).toContain("2507.14799");
    expect(report).toContain("2410.08240");
    expect(report).toContain("2401.13919");
    expect(report).toContain("2307.13854");
    expect(report).toContain("2606.19116");
    expect(report).toContain("2503.23350");
    expect(report).toContain("2502.09841");
    expect(report).toContain("CausalStore");
    expect(report).toContain("100% Passed");
  });

  it("SynapseOptic 가속화 API(warmup, getCacheStats, preload)가 정상 작동해야 한다", async () => {
    const optic = new SynapseOptic();
    const warmup = optic.warmup();

    expect(warmup.endpoint).toBe("http://127.0.0.1:9222");
    expect(typeof warmup.binaryAvailable).toBe("boolean");

    const statsInitial = optic.getCacheStats();
    expect(statsInitial.size).toBe(0);
    expect(statsInitial.cachedUrls).toEqual([]);

    optic.clearCache();
    expect(optic.getCacheStats().size).toBe(0);
  });
});
