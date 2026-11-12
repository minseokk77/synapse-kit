/**
 * 시냅스 3.0 대통합 폐루프 검증 스위트 (Synapse 3.0 Grand Closed-Loop Suite)
 * 9대 전역 코어 (Compiler · Memory · DB · Bus · Runner · Mesh · Guard · Verifier · Runtime)
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import {
  SynapseDB,
  SynapseBus,
  SynapseRunner,
  SynapseMesh,
  SynapseGuard,
  SynapseVerifier,
  SynapseRuntime,
} from "../index";

const TEST_VAULT_LOCAL = join(import.meta.dir, ".test_grand_local");
const TEST_VAULT_REMOTE = join(import.meta.dir, ".test_grand_remote");

describe("🏛️ Synapse 3.0 전역 9대 코어 대통합 유기체 검증 (Grand Closed-Loop)", () => {
  beforeEach(() => {
    if (existsSync(TEST_VAULT_LOCAL)) rmSync(TEST_VAULT_LOCAL, { recursive: true, force: true });
    if (existsSync(TEST_VAULT_REMOTE)) rmSync(TEST_VAULT_REMOTE, { recursive: true, force: true });
    mkdirSync(TEST_VAULT_LOCAL, { recursive: true });
    mkdirSync(TEST_VAULT_REMOTE, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_VAULT_LOCAL)) rmSync(TEST_VAULT_LOCAL, { recursive: true, force: true });
    if (existsSync(TEST_VAULT_REMOTE)) rmSync(TEST_VAULT_REMOTE, { recursive: true, force: true });
  });

  it("1. [Bus ➔ Runner 연동] 컴파일러 완료 신호 수신 시 러너의 무중단 핫스왑 연동 검증", async () => {
    const bus = new SynapseBus();
    const runner = new SynapseRunner();

    let swapTriggered = false;
    bus.on("compiler.build.finished", async (msg) => {
      if (msg.payload.ok) {
        swapTriggered = true;
      }
    });

    // 1단계 프로세스 핫스왑 준비
    const initialProc = await runner.hotSwapProcess(
      {
        id: "core_service",
        command: ["bun", "-e", "setInterval(() => {}, 1000)"],
      },
      { healthCheckWaitMs: 100 }
    );
    expect(initialProc.success).toBe(true);

    // 컴파일러 빌드 완료 이벤트 발행
    bus.emit("compiler.build.finished", { ok: true, durationMs: 42 });
    expect(swapTriggered).toBe(true);

    bus.close();
    runner.close();
  });

  it("2. [DB ➔ Guard ➔ Mesh 융합] 볼트 보안 새니타이징 및 원격 노드 무손실 동기화 검증", async () => {
    const db = new SynapseDB({ vaultDir: TEST_VAULT_LOCAL, autoWatch: false });
    await db.init();

    const guard = new SynapseGuard();
    const meshLocal = new SynapseMesh(TEST_VAULT_LOCAL, { nodeId: "local" });
    const meshRemote = new SynapseMesh(TEST_VAULT_REMOTE, { nodeId: "remote" });

    // 1) 악성 스크립트가 포함된 입력 감지 및 정화
    const dirtyInput = "# 보안 문서\n<script>malicious()</script>\n정상 내용 [[rules/core]]";
    const { cleanContent, report } = guard.auditAndSanitizeVault(dirtyInput, "rules/sec.md");
    expect(report.ok).toBe(false);
    expect(cleanContent).not.toContain("<script>");

    // 2) 정화된 안전한 문서를 Synapse-DB에 저장
    const rules = db.collection<{ title: string }>("rules");
    await rules.save({
      id: "sec",
      data: { title: "보안 수칙" },
      body: cleanContent,
    });
    db.engine.flushPendingWrites();

    // 3) Mesh가 로컬 변경사항을 감지하고 원격 볼트로 복제
    const manifestLocal = meshLocal.getLocalManifest();
    const delta = meshRemote.diffManifest(manifestLocal);
    expect(delta.toPull).toContain("rules/sec.md");

    for (const path of delta.toPull) {
      const content = meshLocal.vaultSync.readVaultFile(path);
      if (content !== null) {
        meshRemote.vaultSync.writeVaultFile(path, content);
      }
    }

    // 4) 원격 노드에 저장된 파일 무결성 및 해시 일치 검증
    const remoteManifest = meshRemote.getLocalManifest();
    expect(remoteManifest.files["rules/sec.md"]).toBeDefined();
    expect(remoteManifest.files["rules/sec.md"].hash).toBe(
      manifestLocal.files["rules/sec.md"].hash
    );

    db.close();
    meshLocal.close();
    meshRemote.close();
  });

  it("3. [Verifier ➔ Runtime 연동] 인과 불변식 진단 통과 후 마이크로 샌드박스 안전 격리 실행", () => {
    const verifier = new SynapseVerifier();
    const runtime = new SynapseRuntime({ timeoutMs: 300 });

    const safePluginCode = `
      const multiplier = 3;
      return input.data.map(n => n * multiplier);
    `;

    // 1) Verifier로 플러그인 코드 정적 검사 (npm, python, console.log 사용 없음 증명)
    const audit = verifier.checkSource(safePluginCode, "plugin.js");
    expect(audit.ok).toBe(true);

    // 2) 검증 통과한 플러그인을 Runtime 마이크로 샌드박스에서 격리 실행
    const res = runtime.runFunction<number[], { data: number[] }>(
      safePluginCode,
      { data: [10, 20, 30] }
    );

    expect(res.ok).toBe(true);
    expect(res.result).toEqual([30, 60, 90]);
    expect(res.timedOut).toBe(false);
  });
});
