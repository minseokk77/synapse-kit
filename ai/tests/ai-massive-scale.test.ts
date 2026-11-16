import { describe, expect, it } from "bun:test";
import { SynapseConnectome, type SynapseDocument } from "synapse-db";
import {
  HybridVectorIndex,
  MultiAgentOrchestrator,
  compareEvalRuns,
  ingestWithOcrFallback,
  parseAndEnforceSchema,
  runEvalSuite,
} from "../index";

function makeDoc(id: string, body: string, links: string[] = []): SynapseDocument {
  const now = new Date().toISOString();
  return {
    id,
    collection: "scale",
    data: { title: id },
    body,
    createdAt: now,
    updatedAt: now,
    wikilinks: links.map((t) => ({ raw: `[[scale/${t}]]`, targetCollection: "scale", targetId: t })),
  };
}

describe("🔥 Synapse-AI 5대 코어 대규모 스트레스 테스트", () => {
  it("1. [Hybrid Vector 2,000문서] Int8 양자화 적재 & 50회 하이브리드 RRF 검색", async () => {
    const connectome = new SynapseConnectome();
    for (let i = 0; i < 1990; i++) {
      connectome.putDocument(makeDoc(`doc-${i}`, `일반 로그 레코드 번호 ${i}: 시스템 상태 정상 유지`));
    }
    for (let i = 0; i < 10; i++) {
      connectome.putDocument(
        makeDoc(`target-${i}`, `클라우드 비용 절감 및 원가 최적화 아키텍처 전략 ${i}`, [`detail-${i}`])
      );
    }

    const index = new HybridVectorIndex(connectome);
    const t0 = performance.now();
    const totalIndexed = await index.syncFromConnectome();
    const indexMs = performance.now() - t0;

    expect(totalIndexed).toBe(2000);
    expect(index.size()).toBe(2000);

    const s0 = performance.now();
    for (let q = 0; q < 50; q++) {
      const hits = await index.search("클라우드 원가 절약 최적화", { topK: 5, collection: "scale" });
      expect(hits.length).toBe(5);
    }
    const searchMs = performance.now() - s0;
    expect(indexMs).toBeLessThan(3000);
    expect(searchMs).toBeLessThan(3000);
  });

  it("2. [Multi-Agent Orchestrator 500태스크] 1,500스텝 핸드오프 + 50건 무한루프 차단", async () => {
    const orch = new MultiAgentOrchestrator();
    orch.registerHandler("planner", async () => ({ nextRole: "worker" }));
    orch.registerHandler("worker", async () => ({ nextRole: "verifier" }));
    orch.registerHandler("verifier", async () => ({ done: true, result: "ok" }));

    for (let i = 0; i < 500; i++) {
      orch.enqueue({
        id: `t-${i}`,
        title: `병렬 태스크 ${i}`,
        resources: [`file-${i % 20}.ts`],
      });
    }

    let completed = 0;
    for (let i = 0; i < 500; i++) {
      const res = await orch.runTask(`t-${i}`);
      if (res.status === "completed") completed++;
    }
    expect(completed).toBe(500);

    // 50건 무한루프 컷오프 검증
    const loopOrch = new MultiAgentOrchestrator();
    loopOrch.registerHandler("planner", async () => ({ nextRole: "worker" }));
    loopOrch.registerHandler("worker", async () => ({ nextRole: "planner" }));
    let aborted = 0;
    for (let i = 0; i < 50; i++) {
      loopOrch.enqueue({ id: `loop-${i}`, title: `루프 ${i}` });
      const res = await loopOrch.runTask(`loop-${i}`, 4);
      if (res.status === "aborted_loop") aborted++;
    }
    expect(aborted).toBe(50);
  });

  it("3. [AI Evals 1,000케이스] 대규모 Groundedness · 환각 채점 & A/B 비교", () => {
    const baseCases = Array.from({ length: 1000 }, (_, i) => ({
      id: `case-${i}`,
      query: `항목 ${i} 한도`,
      expectedKeyFacts: [`${(i + 1) * 1000}원`],
      evidenceCorpus: [`공식 기준표: 항목 ${i} 상한액은 ${(i + 1) * 1000}원이다.`],
      modelAnswer:
        i % 2 === 0
          ? `항목 ${i} 상한액은 ${(i + 1) * 1000}원이다.`
          : `항목 ${i} 상한액은 999999원이며 미확인 수당이 적용된다.`,
      estimatedTokens: 300,
    }));

    const candCases = Array.from({ length: 1000 }, (_, i) => ({
      id: `case-${i}`,
      query: `항목 ${i} 한도`,
      expectedKeyFacts: [`${(i + 1) * 1000}원`],
      evidenceCorpus: [`공식 기준표: 항목 ${i} 상한액은 ${(i + 1) * 1000}원이다.`],
      modelAnswer: `항목 ${i} 상한액은 ${(i + 1) * 1000}원이다.`,
      estimatedTokens: 75,
    }));

    const baseReport = runEvalSuite("Baseline-1k", baseCases);
    const candReport = runEvalSuite("Candidate-1k", candCases);
    const cmp = compareEvalRuns(baseReport, candReport);

    expect(baseReport.passRate).toBe(0.5);
    expect(candReport.passRate).toBe(1);
    expect(cmp.improved).toBe(true);
    expect(cmp.tokenSavingsRatio).toBe(0.75);
  });

  it("4. [Structured Output Repair 2,000건] 대량 깨진 JSON 로컬 복구 및 스키마 강제", () => {
    let success = 0;
    for (let i = 0; i < 2000; i++) {
      const broken = `\`\`\`json\n{\n// idx=${i}\n'id': "${i}",\n"ok": "true",\n"items": ["a", "b",],\n\`\`\``;
      const res = parseAndEnforceSchema<{ id: number; ok: boolean; items: string[] }>(broken, {
        id: { type: "number", required: true },
        ok: { type: "boolean", required: true },
        items: { type: "array", required: true },
      });
      if (res.ok && res.data?.id === i && res.data?.ok === true) success++;
    }
    expect(success).toBe(2000);
  });

  it("5. [Scan PDF / OCR 500건] 스캔 이미지 PDF 판별 및 OCR 폴백 대량 적재", async () => {
    const connectome = new SynapseConnectome();
    let ocrUsed = 0;

    for (let i = 0; i < 500; i++) {
      const bytes = new TextEncoder().encode(
        `%PDF-1.7\n1 0 obj\n<< /Subtype /Image /Filter /DCTDecode >>\nstream\nIMG_${i}\nendstream\n%%EOF`
      );
      const res = await ingestWithOcrFallback(connectome, bytes, {
        id: `scan-${i}`,
        collection: "ocr-scale",
        ocrEngine: () => `스캔 문서 ${i} 본문: [[ocr-scale/annex-${i}]]`,
      });
      if (res.usedOcr) ocrUsed++;
    }

    expect(ocrUsed).toBe(500);
    expect(connectome.getAllDocuments().length).toBe(500);
  });
});
