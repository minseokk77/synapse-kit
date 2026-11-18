import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  SynapseConnectome,
  SynapseDciWorkspace,
  parseAnyDocumentBuffer,
} from "../db";
import {
  MultiAgentOrchestrator,
  parseAndEnforceSchema,
} from "../memory";
import { HybridCodeSandbox } from "../runtime";
import { SynapseVerifier } from "../verifier";
import { HybridGovernanceGate, SynapseGuard } from "../guard";
import { LocalDirectoryStorageAdapter, ServerlessWalSync, SynapseMesh } from "../mesh";

describe("🛡️ Synapse 적대적 오류 · 장애 복구 · 보안 탈출 시나리오 (Adversarial & Failure Suite)", () => {
  it("시나리오 1. [손상 바이너리 + 순환 그래프 + Vector 장애 폴백] 크래시/무한루프 없이 무중단 복구", async () => {
    // 1) 잘린/손상된 ZIP(DOCX/HWPX) & 손상된 OLE2(HWP5) 안전 예외 방어
    const corruptedZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xaa]);
    expect(() => parseAnyDocumentBuffer(corruptedZip, { id: "bad-zip", collection: "docs" })).toThrow();

    const corruptedOle2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
    expect(() => parseAnyDocumentBuffer(corruptedOle2, { id: "bad-hwp", collection: "docs" })).toThrow();

    // 손상된 FlateDecode PDF는 크래시하지 않고 안전 폴백
    const corruptedPdf = new TextEncoder().encode(
      "%PDF-1.7\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\nNOT_ZLIB_BYTES\nendstream\nendobj\n%%EOF"
    );
    const pdfRes = parseAnyDocumentBuffer(corruptedPdf, { id: "bad-pdf", collection: "docs" });
    expect(pdfRes.parsed.format).toBe("pdf");

    // 2) 순환 위키링크(A -> B -> C -> A) + 외부 Vector DB 장애 시 BM25+Connectome 자동 폴백
    const connectome = new SynapseConnectome();
    const docA = parseAnyDocumentBuffer(
      new TextEncoder().encode("CORE_CYCLE_TRIGGER [[docs/node-b]]"),
      { id: "node-a", collection: "docs", fileName: "a.md" }
    ).document;
    const docB = parseAnyDocumentBuffer(
      new TextEncoder().encode("중간 노드 [[docs/node-c]]"),
      { id: "node-b", collection: "docs", fileName: "b.md" }
    ).document;
    const docC = parseAnyDocumentBuffer(
      new TextEncoder().encode("순환 복귀 [[docs/node-a]] 최종 PROOF=CYCLE_OK"),
      { id: "node-c", collection: "docs", fileName: "c.md" }
    ).document;
    const docIsolated = parseAnyDocumentBuffer(
      new TextEncoder().encode("고립 노드"),
      { id: "node-isolated", collection: "docs", fileName: "iso.md" }
    ).document;

    connectome.putDocument(docA);
    connectome.putDocument(docB);
    connectome.putDocument(docC);
    connectome.putDocument(docIsolated);

    const ws = new SynapseDciWorkspace(connectome, "cycle-fallback");
    const pulled = await ws.pullHybrid("CORE_CYCLE_TRIGGER", {
      topK: 2,
      hops: 4,
      collection: "docs",
      vectorSearch: async () => {
        throw new Error("Vector DB Connection Timeout");
      },
    });

    // Vector 장애에도 멈추지 않고 BM25 + 2-Hop으로 C까지 회수
    expect(pulled.entries.some((e) => e.nodeId === "docs/node-c")).toBe(true);

    // 연결되지 않은 노드 간 cross_ref도 무한루프 없이 즉시 false 반환
    const batch = ws.executeBatch([
      { op: "cross_ref", fromNodeId: "docs/node-a", toNodeId: "docs/node-isolated" },
    ]);
    expect((batch.outputs[0].data as { connected: boolean }).connected).toBe(false);
  });

  it("시나리오 2. [Sibling Path Traversal & VM 무한루프/크래시] 외부 경로 탈출 차단 및 디스크 오염 0건", async () => {
    const realWork = mkdtempSync(join(tmpdir(), "synapse-real-work-"));
    try {
      writeFileSync(join(realWork, "keep.ts"), "export const KEEP = 1;\n", "utf-8");
      const sbox = new HybridCodeSandbox(realWork, 60);
      const verifier = new SynapseVerifier();

      // 1) Sibling Path Traversal 공격: ../synapse-real-work-evil/hack.ts 차단!
      expect(() =>
        sbox.overlay.writeFile(`../${basename(realWork)}-evil/hack.ts`, "bad")
      ).toThrow("루트 디렉터리 외부 경로 접근 차단");

      expect(() =>
        sbox.overlay.writeFile("../../outside-secret.txt", "hacked")
      ).toThrow("루트 디렉터리 외부 경로 접근 차단");

      // 2) VM 예외 발생 -> 자동 롤백
      const vmErr = await sbox.stageAndVerify({
        writes: { "keep.ts": "export const KEEP = 999;\n", "bad.ts": "x" },
        evalScript: "throw new Error('VM Runtime Explosion')",
      });
      expect(vmErr.committed).toBe(false);
      expect(readFileSync(join(realWork, "keep.ts"), "utf-8")).toContain("KEEP = 1");

      // 3) VM 무한루프 -> 타임아웃 차단 및 롤백
      const vmLoop = await sbox.stageAndVerify({
        writes: { "keep.ts": "export const KEEP = 888;\n" },
        evalScript: "while(true) {}",
      });
      expect(vmLoop.committed).toBe(false);
      expect(readFileSync(join(realWork, "keep.ts"), "utf-8")).toContain("KEEP = 1");

      // 4) Verifier 불변식 위반(npm 금지 / console.log 금지) -> 자동 롤백
      const verFail = await sbox.stageAndVerify({
        writes: { "bad.ts": "console.log('leak'); const c = 'npm install';" },
        evalScript: "1 + 1 === 2",
        verifier: (diffs, read) => diffs.every((d) => verifier.checkSource(read(d.path), d.path).ok),
      });
      expect(verFail.committed).toBe(false);
      expect(sbox.overlay.exists("bad.ts")).toBe(false);
    } finally {
      rmSync(realWork, { recursive: true, force: true });
    }
  });

  it("시나리오 3. [에이전트 크래시 락 누수 방어 & 무한 핑퐁 컷오프] 락 자동 회수 후 후속 태스크 즉시 복구", async () => {
    const orch = new MultiAgentOrchestrator();

    orch.registerHandler("planner", async () => ({ nextRole: "worker" }));
    orch.registerHandler("worker", async (task) => {
      if (task.payload.shouldCrash) {
        throw new Error("Worker OutOfMemory Crash");
      }
      return { nextRole: "verifier", result: "patched" };
    });
    orch.registerHandler("verifier", async () => ({ done: true, result: "recovered" }));

    // 1) 리소스 락 점유 중 worker가 예외로 크래시
    orch.enqueue({
      id: "crash-task",
      title: "크래시 유발 태스크",
      resources: ["db/prod.ts"],
      payload: { shouldCrash: true },
    });
    const crashed = await orch.runTask("crash-task");
    expect(crashed.status).toBe("failed");
    expect(crashed.error).toContain("Worker OutOfMemory Crash");
    // 크래시 직후 락이 반드시 자동 해제되어야 함 (데드락 0건)
    expect(orch.lockManager.getOwner("db/prod.ts")).toBeNull();

    // 2) 동일 리소스에 대한 후속 복구 태스크가 즉시 락을 획득해 성공
    orch.enqueue({
      id: "recovery-task",
      title: "후속 복구 태스크",
      resources: ["db/prod.ts"],
      payload: { shouldCrash: false },
    });
    const recovered = await orch.runTask("recovery-task");
    expect(recovered.status).toBe("completed");

    // 3) planner <-> worker 무한 핑퐁 컷오프
    const loopOrch = new MultiAgentOrchestrator();
    loopOrch.registerHandler("planner", async () => ({ nextRole: "worker" }));
    loopOrch.registerHandler("worker", async () => ({ nextRole: "planner" }));
    loopOrch.enqueue({ id: "ping-pong", title: "무한 핑퐁" });
    const aborted = await loopOrch.runTask("ping-pong", 3);
    expect(aborted.status).toBe("aborted_loop");
    expect(aborted.hops).toBe(3);
  });

  it("시나리오 4. [적대적 JSON 깨짐·타입오류 & 시크릿·PII·인젝션 동시 폭격] 안전 차단 검증", async () => {
    // 1) 복구 가능한 중첩 미종료 JSON
    const recoverable = `답변입니다:\n\`\`\`json\n{"meta": {"tags": ["a", "b"], "score": "99"\n\`\`\``;
    const recRes = parseAndEnforceSchema<{ meta: { tags: string[]; score: string } }>(recoverable, {
      meta: { type: "object", required: true },
    });
    expect(recRes.ok).toBe(true);
    expect(recRes.data?.meta.tags).toEqual(["a", "b"]);

    // 2) 복구 불가 비-JSON / enum 위반 / 필수 필드 누락 방어
    const hopeless = parseAndEnforceSchema("완전한 일반 문장입니다 json 아님", {
      id: { type: "number", required: true },
    });
    expect(hopeless.ok).toBe(false);
    expect(hopeless.errors.length).toBeGreaterThan(0);

    const badEnum = parseAndEnforceSchema('{"status": "hacked"}', {
      status: { type: "string", required: true, enumValues: ["approved", "rejected"] },
      amount: { type: "number", required: true },
    });
    expect(badEnum.ok).toBe(false);
    expect(badEnum.errors.length).toBe(2);

    // 3) PII + GitHub Secret + 프롬프트 인젝션 동시 입력 차단
    const guard = new SynapseGuard();
    let hitlInvoked = false;
    const gate = new HybridGovernanceGate({
      approvalHandler: () => {
        hitlInvoked = true;
        return true;
      },
    });

    const hostilePayload =
      `주민 900101-1234567, 010-1234-5678, token="ghp_1234567890abcdefghij1234567890abcdef"`;
    const blocked = await gate.evaluateAndRedact({
      action: "deploy",
      actorId: "hostile-agent",
      summary: "배포 시도",
      payloadText: hostilePayload,
      secretDetector: (txt) => !guard.auditSource(txt, "leak.ts").ok,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.hasSecretViolation).toBe(true);
    expect(blocked.redactionsCount).toBe(2);
    expect(blocked.redactedText).not.toContain("900101-1234567");
    expect(hitlInvoked).toBe(false); // 시크릿 유출 시 HITL까지 가지 않고 로컬에서 즉시 차단
  });

  it("시나리오 5. [WAL 세그먼트 변조 공격] Merkle 해시 불일치 시 메쉬 동기화 자동 거부", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "synapse-tamper-"));
    const vaultDir = join(tempDir, "vault");
    const walDir = join(tempDir, "wal");

    try {
      const storage = new LocalDirectoryStorageAdapter(walDir);
      const remote = new ServerlessWalSync("remote-peer", storage);
      const record = await remote.pushSegment("seg-tamper-1", 1, 10, [{ op: "put", id: "clean-doc" }]);

      // 공격자가 디스크의 세그먼트 entries를 몰래 변조 (merkleHash는 기존 값 유지)
      const tampered = {
        ...record,
        entries: [{ op: "put", id: "evil-injected-doc" }],
      };
      writeFileSync(join(walDir, "seg-tamper-1.wal.json"), JSON.stringify(tampered), "utf-8");

      const mesh = new SynapseMesh(vaultDir, { nodeId: "local-peer" });
      const syncRes = await mesh.syncHybrid({ serverlessSync: remote });
      expect(syncRes.mode).toBe("serverless-fallback");
      // 해시 불일치로 변조 세그먼트가 거부되어야 함!
      expect(syncRes.pulledSegmentsCount).toBe(0);
      mesh.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
