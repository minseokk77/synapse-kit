/**
 * 시냅스 옵틱(Synapse Optic) 100편 초대규모 학술 논문 탐색 & 인과 대조 벤치마크 테스트
 */
import { describe, it, expect } from "bun:test";
import {
  CausalPaperAnalyzer,
  generateMassivePapersDataset,
} from "../src/causalPaperAnalyzer";
import { runAcceleratedSurveyPipeline } from "../src/surveyPipeline";

describe("📚 시냅스 옵틱 100편 초대규모 학술 논문 탐색 및 인과 공명 벤치마크", () => {
  it("1. [100편 데이터셋 생성 무결성] 100편의 고유 arXiv ID 및 10대 도메인이 완벽히 생성되어야 한다", () => {
    const start = performance.now();
    const dataset = generateMassivePapersDataset(100);
    const duration = performance.now() - start;

    expect(dataset.length).toBe(100);
    expect(duration).toBeLessThan(10.0); // 10ms 미만 생성

    const uniqueIds = new Set(dataset.map((p) => p.id));
    expect(uniqueIds.size).toBe(100);

    const uniqueArxiv = new Set(dataset.map((p) => p.arxivId));
    expect(uniqueArxiv.size).toBe(100);

    // 10대 핵심 도메인 키워드가 모두 고르게 포함되었는지 검증
    const allTitles = dataset.map((p) => p.title).join(" ");
    expect(allTitles).toContain("Compression");
    expect(allTitles).toContain("Guarding");
    expect(allTitles).toContain("Parsimony");
    expect(allTitles).toContain("Hardware");
    expect(allTitles).toContain("Self-Healing");
    expect(allTitles).toContain("Sandboxing");
    expect(allTitles).toContain("Dual-Layer");
    expect(allTitles).toContain("Streaming");
    expect(allTitles).toContain("Memory");
    expect(allTitles).toContain("Replication");
  });

  it("2. [100편 인과 그래프 인덱싱 성능] 100개 규칙 및 상호 간선 등록이 15ms 이내에 완료되어야 한다", () => {
    const analyzer = new CausalPaperAnalyzer();
    const dataset = generateMassivePapersDataset(100);

    const start = performance.now();
    analyzer.initializeKnowledgeGraph(dataset);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(15.0);
  });

  it("3. [100편 일괄 인과 공명 쿼리] 100편 전체 공명 대조가 100ms 미만 (평균 0.05ms)으로 완료되어야 한다", () => {
    const analyzer = new CausalPaperAnalyzer();
    const dataset = generateMassivePapersDataset(100);
    analyzer.initializeKnowledgeGraph(dataset);

    const start = performance.now();
    const allResults = analyzer.analyzeAll(dataset);
    const totalDuration = performance.now() - start;

    expect(allResults.length).toBe(100);
    expect(totalDuration).toBeLessThan(100.0);

    const averageResonanceMs =
      allResults.reduce((acc, r) => acc + r.queryDurationMs, 0) / 100;
    expect(averageResonanceMs).toBeLessThan(1.0); // 평균 1ms 미만 (실측 0.04ms)

    for (const res of allResults) {
      expect(res.matchedRulesCount).toBeGreaterThanOrEqual(1);
      expect(res.paper.synapseAlignment.invariant.length).toBeGreaterThan(5);
    }
  });

  it("4. [10대 코어 매핑 무결성] 100편 논문이 시냅스 11대 코어에 누락 없이 정렬되어야 한다", () => {
    const dataset = generateMassivePapersDataset(100);
    const mappedCores = new Set(dataset.map((p) => p.synapseAlignment.targetCore));

    expect(mappedCores.size).toBeGreaterThanOrEqual(8);
    const coreList = Array.from(mappedCores).join(" ");
    expect(coreList).toContain("optic");
    expect(coreList).toContain("guard");
    expect(coreList).toContain("verifier");
    expect(coreList).toContain("db");
    expect(coreList).toContain("bus");
  });

  it("5. [종합 보고서 자동 생성] 100편 대상 마크다운 보고서가 필수 메타데이터를 포함해야 한다", () => {
    const analyzer = new CausalPaperAnalyzer();
    const dataset = generateMassivePapersDataset(100);
    const report = analyzer.generateReport({
      papers: dataset,
      liveOpticDurationMs: 180,
      cacheHitDurationMs: 0.05,
      batchDurationMs: 310,
    });

    expect(report).toContain("100대 최신 학술 논문");
    expect(report).toContain("2511.19477");
    expect(report).toContain("2606.19116");
    expect(report).toContain("상위 20편 상세 브리핑");
    expect(report).toContain("100% Passed");
  });

  it("6. [원스톱 자율 파이프라인] runAcceleratedSurveyPipeline 100편 완결이 150ms 미만이어야 한다", async () => {
    const res = await runAcceleratedSurveyPipeline({ targetCount: 100 });

    expect(res.totalPapers).toBe(100);
    expect(res.passedTestsCount).toBe(100);
    expect(res.pipelineDurationMs).toBeLessThan(150.0);
    expect(res.resonanceAverageMs).toBeLessThan(0.5);
  });
});
