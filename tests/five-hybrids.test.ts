import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import {
  SynapseConnectome,
  SynapseDciWorkspace,
  ingestDocumentHybrid,
  parseAnyDocumentBuffer,
} from "../db";
import { QuantizedVectorIndex } from "../memory";
import { HybridCodeSandbox } from "../runtime";
import { SynapseVerifier } from "../verifier";
import { HybridGovernanceGate, SynapseGuard } from "../guard";
import { LocalDirectoryStorageAdapter, ServerlessWalSync, SynapseMesh } from "../mesh";

function buildFlatePdf(line: string): Uint8Array {
  const bt = `BT (${line}) Tj ET`;
  const comp = new Uint8Array(deflateSync(new TextEncoder().encode(bt)));
  const head = new TextEncoder().encode(
    `%PDF-1.7\n1 0 obj\n<< /Length ${comp.length} /Filter /FlateDecode >>\nstream\n`
  );
  const tail = new TextEncoder().encode(`\nendstream\nendobj\n%%EOF`);
  const out = new Uint8Array(head.length + comp.length + tail.length);
  out.set(head, 0);
  out.set(comp, head.length);
  out.set(tail, head.length + comp.length);
  return out;
}

describe("⚡ Synapse 5대 하이브리드 아키텍처 통합 검증", () => {
  it("1. [검색 하이브리드] BM25 + Int8 Vector(RRF) + Connectome 2-Hop으로 키워드 0% 동의어 회수", async () => {
    const connectome = new SynapseConnectome();
    const doc1 = parseAnyDocumentBuffer(
      new TextEncoder().encode("클라우드 인프라 원가절감 및 비용효율화 전략 [[docs/secret-annex]]"),
      { id: "cost-guide", collection: "docs", fileName: "a.md" }
    ).document;
    const doc2 = parseAnyDocumentBuffer(
      new TextEncoder().encode("최종 월 절감액 상한: SAVE_CAP_990"),
      { id: "secret-annex", collection: "docs", fileName: "b.md" }
    ).document;
    connectome.putDocument(doc1);
    connectome.putDocument(doc2);

    const vec = new QuantizedVectorIndex();
    await vec.upsert({ id: "docs/cost-guide", text: doc1.body });
    await vec.upsert({ id: "docs/secret-annex", text: doc2.body });

    // 키워드 불일치 쿼리("비용 효율 최적화") -> BM25 단독은 0건, 3-Way 하이브리드는 secret-annex까지 회수!
    const ws = new SynapseDciWorkspace(connectome, "hybrid-3way");
    const res = await ws.pullHybrid("비용 효율 최적화", {
      topK: 2,
      hops: 1,
      collection: "docs",
      vectorSearch: (q, k) => vec.search(q, k),
    });

    expect(res.entries.some((e) => e.nodeId === "docs/cost-guide")).toBe(true);
    expect(res.entries.some((e) => e.nodeId === "docs/secret-annex")).toBe(true);
  });

  it("2. [문서 인제스트 하이브리드] 텍스트 PDF는 0ms Fast-Path, 스캔 PDF는 OCR Slow-Path 자동 전환", async () => {
    const connectome = new SynapseConnectome();
    let ocrCalls = 0;

    // 1) 텍스트 기반 PDF -> OCR 호출 0회
    const nativePdf = buildFlatePdf("Native Digital Contract Text Verified 2026");
    const resNative = await ingestDocumentHybrid(connectome, nativePdf, {
      id: "native-pdf",
      collection: "docs",
      ocrFallback: () => {
        ocrCalls++;
        return "should not run";
      },
    });
    expect(resNative.usedOcr).toBe(false);
    expect(ocrCalls).toBe(0);

    // 2) 스캔 이미지 PDF -> 자동 OCR 폴백
    const scannedPdf = new TextEncoder().encode("%PDF-1.7\n<< /Subtype /Image /Filter /DCTDecode >>\n%%EOF");
    const resScan = await ingestDocumentHybrid(connectome, scannedPdf, {
      id: "scan-pdf",
      collection: "docs",
      ocrFallback: () => {
        ocrCalls++;
        return "스캔 문서 추출 완료 [[docs/native-pdf]]";
      },
    });
    expect(resScan.usedOcr).toBe(true);
    expect(ocrCalls).toBe(1);
    expect(resScan.document.wikilinks.map((w) => w.targetId)).toContain("native-pdf");
  });

  it("3. [실행 샌드박스 하이브리드] CoW OverlayFS + MicroSandboxVM + SynapseVerifier 원자적 커밋", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synapse-hyb-sbox-"));
    try {
      const sbox = new HybridCodeSandbox(dir);
      const verifier = new SynapseVerifier();

      // 1) VM 평가 실패 -> 자동 롤백
      const vmFail = await sbox.stageAndVerify({
        writes: { "a.ts": "export const x = 1;" },
        evalScript: "while(true) {}",
      });
      expect(vmFail.committed).toBe(false);
      expect(sbox.overlay.exists("a.ts")).toBe(false);

      // 2) Verifier 실패(console.log 포함) -> 자동 롤백
      const verFail = await sbox.stageAndVerify({
        writes: { "bad.ts": "console.log('bad');" },
        evalScript: "const a = 1 + 2; a",
        verifier: (diffs, read) => diffs.every((d) => verifier.checkSource(read("bad.ts"), d.path).ok),
      });
      expect(verFail.committed).toBe(false);

      // 3) VM + Verifier 모두 통과 -> 실디스크 커밋
      const ok = await sbox.stageAndVerify({
        writes: { "good.ts": "export const val = 42;\n" },
        evalScript: "const a = 21 * 2; a",
        verifier: (diffs, read) => diffs.every((d) => verifier.checkSource(read("good.ts"), d.path).ok),
      });
      expect(ok.committed).toBe(true);
      expect(ok.evalResult?.result).toBe(42);
      expect(readFileSync(join(dir, "good.ts"), "utf-8")).toContain("val = 42");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("4. [메쉬 동기화 하이브리드] 오프라인 시 ServerlessWalSync 폴백 자동 전환", async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), "synapse-hyb-vault-"));
    const walDir = mkdtempSync(join(tmpdir(), "synapse-hyb-wal-"));
    try {
      const storage = new LocalDirectoryStorageAdapter(walDir);
      const serverless = new ServerlessWalSync("remote-node", storage);
      await serverless.pushSegment("seg-1", 1, 5, [{ op: "put", id: "doc-1" }]);

      // 활성 피어가 없는 오프라인 상태 -> 자동으로 serverless-fallback 선택
      const mesh = new SynapseMesh(vaultDir, { nodeId: "local-node" });
      const syncRes = await mesh.syncHybrid({ serverlessSync: serverless });
      expect(syncRes.mode).toBe("serverless-fallback");
      expect(syncRes.pulledSegmentsCount).toBe(1);
      mesh.close();
    } finally {
      rmSync(vaultDir, { recursive: true, force: true });
      rmSync(walDir, { recursive: true, force: true });
    }
  });

  it("5. [보안·거버넌스 하이브리드] 0-토큰 Guard+PII Fast-Path + 고위험 HITL Slow-Path", async () => {
    const guard = new SynapseGuard();
    let hitlCalled = 0;
    const gate = new HybridGovernanceGate({
      approvalHandler: () => {
        hitlCalled++;
        return true;
      },
    });

    // 1) 저위험 + PII 포함 -> HITL 호출 없이 즉시 통과 + PII 마스킹
    const low = await gate.evaluateAndRedact({
      action: "note:read",
      actorId: "agent-1",
      summary: "메모 조회",
      payloadText: "전화 010-1234-5678 확인",
      secretDetector: (txt) => !guard.auditSource(txt, "note.txt").ok,
    });
    expect(low.allowed).toBe(true);
    expect(low.redactionsCount).toBe(1);
    expect(hitlCalled).toBe(0);

    // 2) 시크릿 유출 감지 -> HITL까지 가지 않고 로컬 Fast-Path에서 즉시 차단
    const secretLeak = await gate.evaluateAndRedact({
      action: "deploy",
      actorId: "agent-1",
      summary: "배포",
      payloadText: `const token = "ghp_1234567890abcdefghij1234567890abcdef";`,
      secretDetector: (txt) => !guard.auditSource(txt, "app.ts").ok,
    });
    expect(secretLeak.allowed).toBe(false);
    expect(secretLeak.hasSecretViolation).toBe(true);
    expect(hitlCalled).toBe(0);

    // 3) 깨끗한 고위험 액션 -> HITL Slow-Path 승인 호출
    const high = await gate.evaluateAndRedact({
      action: "deploy",
      actorId: "agent-1",
      summary: "프로덕션 배포",
      payloadText: "export const ok = true;",
      secretDetector: (txt) => !guard.auditSource(txt, "app.ts").ok,
    });
    expect(high.allowed).toBe(true);
    expect(hitlCalled).toBe(1);
  });
});
