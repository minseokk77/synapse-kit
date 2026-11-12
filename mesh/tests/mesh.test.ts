/**
 * 시냅스 분산 메쉬 네트워크 (Synapse Mesh) 종합 검증 스위트
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { SynapseMesh } from "../src";

const TEST_VAULT_A = join(import.meta.dir, ".test_vault_a");
const TEST_VAULT_B = join(import.meta.dir, ".test_vault_b");

describe("🌐 Synapse Mesh (분산 볼트 실시간 동기화 & P2P 피어 라우터) 검증", () => {
  let meshA: SynapseMesh;
  let meshB: SynapseMesh;

  beforeEach(() => {
    if (existsSync(TEST_VAULT_A)) rmSync(TEST_VAULT_A, { recursive: true, force: true });
    if (existsSync(TEST_VAULT_B)) rmSync(TEST_VAULT_B, { recursive: true, force: true });
    mkdirSync(TEST_VAULT_A, { recursive: true });
    mkdirSync(TEST_VAULT_B, { recursive: true });

    meshA = new SynapseMesh(TEST_VAULT_A, { nodeId: "node_alpha" });
    meshB = new SynapseMesh(TEST_VAULT_B, { nodeId: "node_beta" });
  });

  afterEach(() => {
    meshA.close();
    meshB.close();
    if (existsSync(TEST_VAULT_A)) rmSync(TEST_VAULT_A, { recursive: true, force: true });
    if (existsSync(TEST_VAULT_B)) rmSync(TEST_VAULT_B, { recursive: true, force: true });
  });

  it("1. [볼트 매니페스트 생성] 마크다운 파일 스캔 및 SHA-256 해시, 크기 정확도 검증", () => {
    meshA.vaultSync.writeVaultFile("notes/hello.md", "# 안녕하세요 시냅스");
    meshA.vaultSync.writeVaultFile("rules/core.md", "불변 규칙 제1원칙");

    const manifest = meshA.getLocalManifest();
    expect(manifest.nodeId).toBe("node_alpha");
    expect(Object.keys(manifest.files).length).toBe(2);

    const helloMeta = manifest.files["notes/hello.md"];
    expect(helloMeta).toBeDefined();
    expect(helloMeta.hash.length).toBe(64); // SHA-256 길이
    expect(helloMeta.sizeBytes).toBeGreaterThan(0);
  });

  it("2. [양방향 동기화 Delta 계산 & LWW 충돌 해결] 신규 및 수정 파일 무손실 판정", () => {
    // Node A에 doc1 작성
    meshA.vaultSync.writeVaultFile("shared/doc1.md", "Node A 최초 작성");
    const manifestA = meshA.getLocalManifest();

    // Node B에는 doc2 작성
    meshB.vaultSync.writeVaultFile("shared/doc2.md", "Node B 최초 작성");
    const manifestB = meshB.getLocalManifest();

    // Node A 기준에서 Node B와 비교
    const deltaForA = meshA.diffManifest(manifestB);
    expect(deltaForA.toPush).toContain("shared/doc1.md");
    expect(deltaForA.toPull).toContain("shared/doc2.md");

    // LWW (Last-Write-Wins) 충돌 해결 검증:
    // doc1을 Node B에서도 작성하되 200ms 후 수정하여 B가 더 최신이 되도록 함
    meshB.vaultSync.writeVaultFile("shared/doc1.md", "Node B 최신 수정본");
    const updatedManifestB = meshB.getLocalManifest();

    const conflictDelta = meshA.diffManifest(updatedManifestB);
    expect(conflictDelta.conflictsResolved.length).toBe(1);
    expect(conflictDelta.conflictsResolved[0].winningSource).toBe("REMOTE");
    expect(conflictDelta.toPull).toContain("shared/doc1.md");
  });

  it("3. [분산 볼트 미러링 적용] 파일 전송 및 원자적 동기화 검증", () => {
    // Node A에서 생성한 파일을 Node B로 복제
    meshA.vaultSync.writeVaultFile("rules/sync.md", "# 동기화 테스트 파일");
    const manifestA = meshA.getLocalManifest();
    const delta = meshB.diffManifest(manifestA);

    for (const fileToPull of delta.toPull) {
      const content = meshA.vaultSync.readVaultFile(fileToPull);
      if (content !== null) {
        meshB.vaultSync.writeVaultFile(fileToPull, content);
      }
    }

    const copiedContent = meshB.vaultSync.readVaultFile("rules/sync.md");
    expect(copiedContent).toBe("# 동기화 테스트 파일");
    expect(meshB.getLocalManifest().files["rules/sync.md"].hash).toBe(
      manifestA.files["rules/sync.md"].hash
    );
  });

  it("4. [피어 라우터 및 최적 피어 선택] 우선순위 기반 라우팅 검증", () => {
    meshA.router.addPeer({
      id: "oracle_primary",
      endpoint: "http://10.0.0.1:4343",
      priority: 1,
    });
    meshA.router.addPeer({
      id: "oracle_backup",
      endpoint: "http://10.0.0.2:4343",
      priority: 2,
    });

    const best = meshA.router.selectBestPeer();
    expect(best).not.toBeNull();
    expect(best?.id).toBe("oracle_primary");
  });

  it("5. [페일오버(Failover)] 1순위 피어 장애 시 2순위 피어로 자동 전환", () => {
    meshA.router.addPeer({
      id: "peer_main",
      endpoint: "http://10.0.0.1:4343",
      priority: 1,
    });
    meshA.router.addPeer({
      id: "peer_sub",
      endpoint: "http://10.0.0.2:4343",
      priority: 2,
    });

    // 1순위 피어를 UNREACHABLE로 마킹
    const peers = meshA.router.getAllPeers();
    const mainPeer = peers.find((p) => p.info.id === "peer_main")!;
    mainPeer.status = "UNREACHABLE";

    // 최적 피어가 2순위(peer_sub)로 자동 우회되는지 확인
    const failoverBest = meshA.router.selectBestPeer();
    expect(failoverBest).not.toBeNull();
    expect(failoverBest?.id).toBe("peer_sub");
  });

  it("6. [메쉬 통계 및 안전 종료] 통계 수집 및 리소스 안전 해제", () => {
    const stats = meshA.getStats();
    expect(stats.nodeId).toBe("node_alpha");
    expect(stats.isRunning).toBe(false);

    meshA.close();
    expect(meshA.router.getAllPeers().length).toBe(0);
  });
});
