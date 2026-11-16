import { describe, expect, it } from "bun:test";
import { SynapseConnectome, type SynapseDocument } from "synapse-db";
import {
  HybridVectorIndex,
  MultiAgentOrchestrator,
  compareEvalRuns,
  detectPdfScanStatus,
  ingestWithOcrFallback,
  parseAndEnforceSchema,
  runEvalSuite,
} from "../index";

function makeDoc(id: string, body: string, links: string[] = []): SynapseDocument {
  const now = new Date().toISOString();
  return {
    id,
    collection: "kb",
    data: { title: id },
    body,
    createdAt: now,
    updatedAt: now,
    wikilinks: links.map((t) => ({ raw: `[[kb/${t}]]`, targetCollection: "kb", targetId: t })),
  };
}

describe("🧠 Synapse-AI (5대 AI 에이전트 핵심 인프라 통합 검증)", () => {
  it("1. [Hybrid Vector + BM25 + Connectome RRF] 키워드 없는 의미 유사 문서 및 1-Hop 그래프 부스트", async () => {
    const connectome = new SynapseConnectome();
    connectome.putDocument(makeDoc("cost-doc", "클라우드 인프라 운영 원가 절감 및 인스턴스 최적화 가이드", ["annex-cost"]));
    connectome.putDocument(makeDoc("annex-cost", "세부 절감액 산출표: 월 420만원 절약"));
    connectome.putDocument(makeDoc("weather", "오늘 서울 맑고 기온 18도"));

    // 키워드 불일치 쿼리("인프라 원가 최적화") + 커스텀 임베더/로컬 해시 임베더 검증
    const index = new HybridVectorIndex(connectome);
    const indexedCount = await index.syncFromConnectome();
    expect(indexedCount).toBe(3);

    const hits = await index.search("인프라 원가 절약 최적화", { topK: 3, collection: "kb" });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0].nodeId).toBe("kb/cost-doc");
    // 1-Hop 이웃인 annex-cost도 Graph Boost로 상위권 회수
    expect(hits.some((h) => h.nodeId === "kb/annex-cost" && h.graphBoost > 0)).toBe(true);
  });

  it("2. [Multi-Agent Orchestrator] 역할 핸드오프, 자원 충돌 락 및 무한루프 컷오프", async () => {
    const orch = new MultiAgentOrchestrator();
    orch.registerHandler("planner", async () => ({ nextRole: "worker", result: "plan_ok" }));
    orch.registerHandler("worker", async () => ({ nextRole: "verifier", result: "work_ok" }));
    orch.registerHandler("verifier", async () => ({ done: true, result: "verified_ok" }));

    orch.enqueue({
      id: "task-1",
      title: "결제 모듈 리팩터링",
      resources: ["src/payment.ts"],
    });
    const done = await orch.runTask("task-1");
    expect(done.status).toBe("completed");
    expect(done.history).toEqual(["planner#1", "worker#2", "verifier#3"]);
    expect(orch.lockManager.getOwner("src/payment.ts")).toBeNull();

    // 무한루프 컷오프 검증 (planner <-> worker 핑퐁)
    const loopOrch = new MultiAgentOrchestrator();
    loopOrch.registerHandler("planner", async () => ({ nextRole: "worker" }));
    loopOrch.registerHandler("worker", async () => ({ nextRole: "planner" }));
    loopOrch.enqueue({ id: "loop-1", title: "무한 핑퐁 테스트" });
    const aborted = await loopOrch.runTask("loop-1", 4);
    expect(aborted.status).toBe("aborted_loop");
    expect(aborted.hops).toBe(4);

    // 자원 충돌 락 검증
    expect(orch.lockManager.acquire("db/schema.ts", "agent-A")).toBe(true);
    orch.enqueue({ id: "task-locked", title: "충돌 태스크", resources: ["db/schema.ts"] });
    const blocked = await orch.runTask("task-locked");
    expect(blocked.status).toBe("failed");
    expect(blocked.error).toContain("자원 락 획득 실패");
    orch.lockManager.release("db/schema.ts", "agent-A");
  });

  it("3. [AI Evals & Hallucination Scorer] 근거 충실도 채점, 환각 탐지 및 A/B 회귀 비교", () => {
    const baseline = runEvalSuite("RAG-Baseline", [
      {
        id: "q1",
        query: "숙박비 상한은?",
        expectedKeyFacts: ["180,000원"],
        evidenceCorpus: ["책임연구원 숙박비 상한액은 180,000원이다."],
        modelAnswer: "숙박비 상한액은 250,000원이며 특별 수당 99,000원이 추가된다.",
        estimatedTokens: 400,
      },
    ]);

    const candidate = runEvalSuite("Synapse-DCI", [
      {
        id: "q1",
        query: "숙박비 상한은?",
        expectedKeyFacts: ["180,000원"],
        evidenceCorpus: ["책임연구원 숙박비 상한액은 180,000원이다."],
        modelAnswer: "책임연구원 숙박비 상한액은 180,000원이다.",
        estimatedTokens: 80,
      },
    ]);

    expect(baseline.results[0].hallucinationRate).toBeGreaterThan(0.5);
    expect(baseline.results[0].passed).toBe(false);
    expect(candidate.results[0].groundedness).toBe(1);
    expect(candidate.results[0].passed).toBe(true);

    const cmp = compareEvalRuns(baseline, candidate);
    expect(cmp.improved).toBe(true);
    expect(cmp.tokenSavingsRatio).toBe(0.8);
  });

  it("4. [Structured Output Repair] 깨진 JSON(펜스·주석·후행콤마·미닫힘 괄호) 복구 및 스키마 강제", () => {
    const brokenLlmOutput = `
    여기 요청하신 결과입니다:
    \`\`\`json
    {
      // 상태 보고
      'status': "approved",
      "amount": "180000",
      "tags": ["dci", "hwp",],
    \`\`\`
    `;

    const res = parseAndEnforceSchema<{ status: string; amount: number; tags: string[] }>(
      brokenLlmOutput,
      {
        status: { type: "string", required: true, enumValues: ["approved", "rejected"] },
        amount: { type: "number", required: true },
        tags: { type: "array", required: true },
      }
    );

    expect(res.ok).toBe(true);
    expect(res.repaired).toBe(true);
    expect(res.data?.status).toBe("approved");
    expect(res.data?.amount).toBe(180000);
    expect(res.data?.tags).toEqual(["dci", "hwp"]);
  });

  it("5. [Scan PDF / OCR Bridge] 스캔 이미지 전용 PDF 감지 및 OCR 폴백 적재", async () => {
    const scannedPdfBytes = new TextEncoder().encode(
      `%PDF-1.7\n1 0 obj\n<< /Subtype /Image /Filter /DCTDecode /Width 1200 /Height 1600 >>\nstream\nFAKE_JPEG\nendstream\n%%EOF`
    );

    const status = detectPdfScanStatus(scannedPdfBytes);
    expect(status.isPdf).toBe(true);
    expect(status.isScannedImageOnly).toBe(true);
    expect(status.imageObjectCount).toBeGreaterThanOrEqual(2);

    const connectome = new SynapseConnectome();
    const ingested = await ingestWithOcrFallback(connectome, scannedPdfBytes, {
      id: "scanned-contract",
      collection: "ocr",
      ocrEngine: async () => "스캔 계약서 제5조: 위약금은 [[ocr/별표-1]] 기준 10%로 정한다.",
    });

    expect(ingested.usedOcr).toBe(true);
    expect(ingested.document.data.ocrApplied).toBe(true);
    expect(ingested.document.wikilinks.map((w) => w.targetId)).toContain("별표-1");
  });
});
