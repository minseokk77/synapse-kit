import { describe, expect, it } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { SynapseConnectome, SynapseDciWorkspace, parseAnyDocumentBuffer } from "../db";
import { RingBufferBus } from "../bus";
import { executeMcpTool } from "../compiler/mcp";

function buildZipBomb(): Uint8Array {
  // 36MB(32MB 제한 초과)의 0-바이트 페이로드를 극한 압축한 Zip Bomb 생성
  const huge = new Uint8Array(36 * 1024 * 1024);
  const comp = new Uint8Array(deflateRawSync(huge));
  const name = new TextEncoder().encode("Contents/section0.xml");

  const lfh = new Uint8Array(30 + name.length);
  const lv = new DataView(lfh.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(18, comp.length, true);
  lv.setUint32(22, huge.length, true);
  lv.setUint16(26, name.length, true);
  lfh.set(name, 30);

  const cdOffset = lfh.length + comp.length;
  const cd = new Uint8Array(46 + name.length);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, comp.length, true);
  cv.setUint32(24, huge.length, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(42, 0, true);
  cd.set(name, 46);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, cdOffset, true);

  const out = new Uint8Array(lfh.length + comp.length + cd.length + eocd.length);
  out.set(lfh, 0);
  out.set(comp, lfh.length);
  out.set(cd, cdOffset);
  out.set(eocd, cdOffset + cd.length);
  return out;
}

describe("🔒 Synapse TypeScript 보안 취약점 패치 검증 (Security Patches)", () => {
  it("1. [Zip Bomb OOM DoS 방어] 32MB 압축 해제 상한 초과 시 즉시 차단", () => {
    const bomb = buildZipBomb();
    expect(() => parseAnyDocumentBuffer(bomb, { id: "bomb", collection: "docs" })).toThrow();
  });

  it("2. [DCI ReDoS 차단 & XSS 변형 방어] 중첩 수량자 정규식 거부 및 iframe/javascript/onerror 마스킹", () => {
    const connectome = new SynapseConnectome();
    const hostile = parseAnyDocumentBuffer(
      new TextEncoder().encode(
        `TARGET_DOC\n<iframe src="evil"></iframe>\njavascript:alert(1)\n<img onerror="steal()">`
      ),
      { id: "hostile", collection: "docs", fileName: "hostile.md" }
    ).document;
    connectome.putDocument(hostile);

    const ws = new SynapseDciWorkspace(connectome, "sec-dci");
    const pullRes = ws.pull("TARGET_DOC", { enableFirewall: true });
    expect(pullRes.firewallRedactions).toBeGreaterThanOrEqual(3);

    const sanitized = ws.getEntry("docs/hostile")?.sanitizedBody || "";
    expect(sanitized).not.toContain("<iframe");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("onerror=");

    const batch = ws.executeBatch([{ op: "grep", pattern: "(a+)+$" }]);
    expect(batch.outputs[0].ok).toBe(false);
    expect(String(batch.outputs[0].data)).toContain("ReDoS");
  });

  it("3. [RingBufferBus 토픽 메타문자 이스케이프] 특수문자 포함 와일드카드 토픽 안전 구독", () => {
    const bus = new RingBufferBus();
    let hits = 0;
    bus.subscribe("sys.[prod]+(*)", () => {
      hits++;
    });

    bus.emit("sys.[prod]+(db)", { ok: true });
    bus.emit("sys.prod+(db)", { ok: false }); // 메타문자 []가 리터럴로 이스케이프되어 매칭되면 안 됨!
    expect(hits).toBe(1);
    bus.close();
  });

  it("4. [MCP vaultDir 경로 경계] 작업/임시 디렉터리 외부 볼트 접근 차단", async () => {
    const outsideRes = await executeMcpTool("synapse_db_search", {
      query: "secret",
      vaultDir: "C:\\Windows\\System32",
    });
    expect(outsideRes.isError).toBe(true);
    expect(outsideRes.content[0].text).toContain("외부 볼트 경로");

    const nullByteRes = await executeMcpTool("synapse_db_search", {
      query: "secret",
      vaultDir: ".synapse-vault\0evil",
    });
    expect(nullByteRes.isError).toBe(true);
  });
});
