import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SynapseConnectome,
  SynapseDciWorkspace,
  parseAnyDocumentBuffer,
} from "../db";
import {
  SynapseTracer,
  buildRepoMap,
  computePrBlastRadius,
} from "../compiler";
import {
  MultiAgentOrchestrator,
  QuantizedVectorIndex,
  parseAndEnforceSchema,
  runEvalSuite,
} from "../memory";
import { SandboxOverlayFS } from "../runtime";
import { SynapseVerifier } from "../verifier";
import { HitlApprovalGate, PiiRedactor, SynapseGuard } from "../guard";
import { PulseEngine } from "../bus";
import { detectPdfScanStatus, transcribeVoiceChunks } from "../optic";

describe("🏛️ Synapse 10대 코어 통합 연동 검증 (Ten-Core Unified Integration)", () => {
  it("1. [DB+DCI+Memory+Optic] 12종 문서·음성·스캔PDF 적재 ➔ 양자화 벡터+DCI 회수 ➔ Repair+Evals", async () => {
    const connectome = new SynapseConnectome();
    const doc = parseAnyDocumentBuffer(
      new TextEncoder().encode("# 통합_안건_101\n세부 사항은 [[docs/annex-1]] 참조."),
      { id: "main-1", collection: "docs", fileName: "main.md" }
    ).document;
    const annex = parseAnyDocumentBuffer(
      new TextEncoder().encode("핵심 상수: TARGET_KEY=UNIFIED_OK"),
      { id: "annex-1", collection: "docs", fileName: "annex.md" }
    ).document;
    connectome.putDocument(doc);
    connectome.putDocument(annex);

    const voice = await transcribeVoiceChunks(
      [{ chunkId: "v1", pcmSamples: new Float32Array(400).fill(0.2) }],
      {
        sessionId: "call-1",
        sttEngine: () => [{ speaker: "사회자", startSec: 0, endSec: 1, text: "승인 완료" }],
      }
    );
    expect(voice.activeSpeechChunks).toBe(1);

    const scanProbe = detectPdfScanStatus(
      new TextEncoder().encode("%PDF-1.7\n<< /Subtype /Image >>\n%%EOF")
    );
    expect(scanProbe.isScannedImageOnly).toBe(true);

    const vec = new QuantizedVectorIndex();
    await vec.upsert({ id: "docs/main-1", text: doc.body });
    const vecHits = await vec.search("통합 안건 세부 사항", 1);
    expect(vecHits[0].id).toBe("docs/main-1");

    const dci = new SynapseDciWorkspace(connectome);
    const pulled = dci.pull("통합_안건_101", { hops: 1 });
    expect(pulled.entries.some((e) => e.nodeId === "docs/annex-1")).toBe(true);

    const repaired = parseAndEnforceSchema<{ ok: boolean }>('```json\n{"ok":"true",}\n```', {
      ok: { type: "boolean", required: true },
    });
    expect(repaired.ok && repaired.data?.ok).toBe(true);

    const evalRes = runEvalSuite("unified", [
      {
        id: "e1",
        query: "상수는?",
        expectedKeyFacts: ["UNIFIED_OK"],
        evidenceCorpus: [annex.body],
        modelAnswer: "핵심 상수는 TARGET_KEY=UNIFIED_OK 이다.",
      },
    ]);
    expect(evalRes.passRate).toBe(1);
  });

  it("2. [Compiler+Runtime+Verifier] Codemap+Tracer + SandboxOverlayFS ↔ SynapseVerifier 안전 커밋", async () => {
    const map = buildRepoMap([
      { path: "a.ts", content: "export function ping() { return 1; }" },
      { path: "b.ts", content: "import { ping } from './a';\nexport function run() { return ping(); }" },
    ]);
    expect(computePrBlastRadius(["a.ts"], map).impactedFiles).toEqual(["a.ts", "b.ts"]);

    const tracer = new SynapseTracer("unified-trace");
    tracer.recordSpan({
      turn: 1,
      agentId: "coder",
      toolName: "codemap",
      status: "ok",
      inputTokens: 50,
      outputTokens: 20,
      durationMs: 1.0,
      stateSnapshot: { mapped: true },
    });
    expect(tracer.replayAtTurn(1).mergedState.mapped).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "synapse-unified-"));
    try {
      const overlay = new SandboxOverlayFS(dir);
      const verifier = new SynapseVerifier();

      // 금지된 console.log 포함 코드 -> Verifier 차단 -> 롤백
      overlay.writeFile("bad.ts", "console.log('leak');");
      const badRes = await overlay.commitIfVerified((diffs) =>
        diffs.every((d) => verifier.checkSource(overlay.readFile("bad.ts"), d.path).ok)
      );
      expect(badRes.verified).toBe(false);
      expect(overlay.exists("bad.ts")).toBe(false);

      // 정상 코드 -> Verifier 통과 -> 디스크 커밋
      overlay.writeFile("good.ts", "export const ok = true;\n");
      const goodRes = await overlay.commitIfVerified((diffs) =>
        diffs.every((d) => verifier.checkSource(overlay.readFile("good.ts"), d.path).ok)
      );
      expect(goodRes.verified).toBe(true);
      expect(readFileSync(join(dir, "good.ts"), "utf-8")).toContain("ok = true");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("3. [Guard+Policy+Bus+Pulse+Orchestrator] 보안·PII·HITL + 0-토큰 Pulse + 오케스트레이터", async () => {
    const guard = new SynapseGuard();
    const redactor = new PiiRedactor();
    const gate = new HitlApprovalGate({ approvalHandler: () => true });

    const text = "연락처 010-1234-5678, safe code";
    const redacted = redactor.redact(text);
    expect(redacted.redactionsCount).toBe(1);
    expect(guard.auditSource(redacted.redactedText, "note.txt").ok).toBe(true);
    expect((await gate.authorize({ action: "deploy", actorId: "bot", summary: "ok" })).approved).toBe(true);

    const pulse = new PulseEngine();
    let fired = 0;
    pulse.registerRule({
      id: "err",
      topic: "sys",
      minSeverity: "critical",
      onTrigger: () => {
        fired++;
      },
    });
    await pulse.ingest({ topic: "sys", severity: "info", payload: "ok" });
    await pulse.ingest({ topic: "sys", severity: "critical", payload: "fail" });
    expect(fired).toBe(1);

    const orch = new MultiAgentOrchestrator();
    orch.registerHandler("planner", async () => ({ done: true, result: "done" }));
    orch.enqueue({ id: "t1", title: "check" });
    expect((await orch.runTask("t1")).status).toBe("completed");
  });
});
