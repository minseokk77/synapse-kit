import { describe, expect, it } from "bun:test";
import { deflateRawSync } from "node:zlib";
import {
  SynapseConnectome,
  SynapseDciWorkspace,
  parseHwpBufferToDocument,
  extractKoreanLegalLinks,
} from "../index";

/**
 * 테스트용 실제 HWPX (ZIP + OWPML XML) 바이너리 생성기
 */
function buildTestHwpx(sectionXml: string): Uint8Array {
  const nameBytes = new TextEncoder().encode("Contents/section0.xml");
  const rawXml = new TextEncoder().encode(sectionXml);
  const compXml = new Uint8Array(deflateRawSync(rawXml));

  const lfh = new Uint8Array(30 + nameBytes.length);
  const lfhView = new DataView(lfh.buffer);
  lfhView.setUint32(0, 0x04034b50, true);
  lfhView.setUint16(4, 20, true);
  lfhView.setUint16(8, 8, true); // deflate
  lfhView.setUint32(18, compXml.length, true);
  lfhView.setUint32(22, rawXml.length, true);
  lfhView.setUint16(26, nameBytes.length, true);
  lfh.set(nameBytes, 30);

  const cdOffset = lfh.length + compXml.length;
  const cd = new Uint8Array(46 + nameBytes.length);
  const cdView = new DataView(cd.buffer);
  cdView.setUint32(0, 0x02014b50, true);
  cdView.setUint16(4, 20, true);
  cdView.setUint16(6, 20, true);
  cdView.setUint16(10, 8, true); // deflate
  cdView.setUint32(20, compXml.length, true);
  cdView.setUint32(24, rawXml.length, true);
  cdView.setUint16(28, nameBytes.length, true);
  cdView.setUint32(42, 0, true); // local header offset
  cd.set(nameBytes, 46);

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, 1, true);
  eocdView.setUint16(10, 1, true);
  eocdView.setUint32(12, cd.length, true);
  eocdView.setUint32(16, cdOffset, true);

  const out = new Uint8Array(lfh.length + compXml.length + cd.length + eocd.length);
  out.set(lfh, 0);
  out.set(compXml, lfh.length);
  out.set(cd, cdOffset);
  out.set(eocd, cdOffset + cd.length);
  return out;
}

/**
 * 테스트용 실제 HWP 5.0 (OLE2 CFB + zlib 압축 Section0 레코드) 바이너리 생성기
 */
function buildTestHwp5(lines: string[]): Uint8Array {
  const sectorSize = 512;
  // 총 5개 섹터 (Header 512 + FAT(sec0) + Dir(sec1) + FileHeader(sec2) + Section0(sec3))
  const buf = new Uint8Array(sectorSize * 5);
  const view = new DataView(buf.buffer);

  // OLE2 Header
  buf.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true); // 512 bytes
  view.setInt32(44, 1, true); // 1 FAT sector
  view.setInt32(48, 1, true); // firstDirSector = 1
  view.setInt32(60, -2, true); // end of miniFAT
  view.setInt32(68, -2, true); // end of DIFAT
  view.setInt32(76, 0, true); // DIFAT[0] = sector 0

  // Sector 0: FAT (offset 512)
  const fatOff = sectorSize * 1;
  for (let i = 0; i < 128; i++) view.setInt32(fatOff + i * 4, -1, true);
  view.setInt32(fatOff + 0 * 4, -3, true); // FAT sector
  view.setInt32(fatOff + 1 * 4, -2, true); // Dir end
  view.setInt32(fatOff + 2 * 4, -2, true); // FileHeader end
  view.setInt32(fatOff + 3 * 4, -2, true); // Section0 end

  // Sector 1: Directory (offset 1024)
  const dirOff = sectorSize * 2;
  const writeDirEntry = (idx: number, name: string, startSec: number, size: number) => {
    const base = dirOff + idx * 128;
    const u16 = new Uint16Array(name.length + 1);
    for (let i = 0; i < name.length; i++) u16[i] = name.charCodeAt(i);
    u16[name.length] = 0;
    buf.set(new Uint8Array(u16.buffer), base);
    view.setUint16(base + 64, (name.length + 1) * 2, true);
    buf[base + 66] = 2; // stream
    view.setInt32(base + 116, startSec, true);
    view.setUint32(base + 120, size, true);
  };

  // FileHeader stream (compressed flag = 1)
  const fhOff = sectorSize * 3;
  view.setUint32(fhOff + 36, 0x01, true);
  writeDirEntry(0, "FileHeader", 2, 256);

  // Section0 HWPTAG_PARA_TEXT(67) records -> deflateRawSync
  const recordChunks: Uint8Array[] = [];
  for (const line of lines) {
    const payload = new Uint8Array(line.length * 2);
    const pView = new DataView(payload.buffer);
    for (let i = 0; i < line.length; i++) {
      pView.setUint16(i * 2, line.charCodeAt(i), true);
    }
    const rec = new Uint8Array(4 + payload.length);
    const rView = new DataView(rec.buffer);
    const header = (67 & 0x3ff) | ((0 & 0x3ff) << 10) | ((payload.length & 0xfff) << 20);
    rView.setUint32(0, header >>> 0, true);
    rec.set(payload, 4);
    recordChunks.push(rec);
  }
  const plainSec = new Uint8Array(recordChunks.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const c of recordChunks) {
    plainSec.set(c, p);
    p += c.length;
  }
  const compSec = new Uint8Array(deflateRawSync(plainSec));
  buf.set(compSec, sectorSize * 4);
  writeDirEntry(1, "Section0", 3, compSec.length);

  return buf;
}

describe("📄 Synapse-HWP (HWPX + HWP 5.0 네이티브 파서 & Synapse-DCI 통합 검증)", () => {
  it("1. [HWPX 파싱] ZIP+XML 본문, 마크다운 표(Table) 정규화 및 별표/제N조 위키링크 자동 추출", () => {
    const xml = `
      <hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
        <hp:p><hp:t>제14조(보안등급) 세부 기준은 별표 1 및 붙임 2에 따른다.</hp:t></hp:p>
        <hp:tbl>
          <hp:tr><hp:tc><hp:p><hp:t>등급</hp:t></hp:p></hp:tc><hp:tc><hp:p><hp:t>한도액</hp:t></hp:p></hp:tc></hp:tr>
          <hp:tr><hp:tc><hp:p><hp:t>1등급</hp:t></hp:p></hp:tc><hp:tc><hp:p><hp:t>500만원</hp:t></hp:p></hp:tc></hp:tr>
        </hp:tbl>
      </hs:sec>
    `;
    const hwpxBytes = buildTestHwpx(xml);
    const { document, parsed } = parseHwpBufferToDocument(hwpxBytes, {
      id: "보안규정",
      collection: "hwp",
      title: "사내 보안규정",
    });

    expect(parsed.format).toBe("hwpx");
    expect(parsed.tablesCount).toBe(1);
    expect(document.body).toContain("| 등급 | 한도액 |");
    expect(document.body).toContain("| 1등급 | 500만원 |");

    const linkIds = document.wikilinks.map((w) => w.targetId);
    expect(linkIds).toContain("별표-1");
    expect(linkIds).toContain("붙임-2");
    expect(linkIds).toContain("제14조");
  });

  it("2. [HWP 5.0 파싱] OLE2 CFB + zlib 압축 스트림에서 UTF-16LE 본문 및 참조 링크 추출", () => {
    const hwpBytes = buildTestHwp5([
      "제1조(목적) 본 규정은 별표 1의 단가 기준을 준용한다.",
      "담당 부서 확인 완료",
    ]);
    const { document, parsed } = parseHwpBufferToDocument(hwpBytes, {
      id: "단가규정",
      collection: "hwp",
    });

    expect(parsed.format).toBe("hwp5");
    expect(document.body).toContain("제1조(목적)");
    expect(document.body).toContain("담당 부서 확인 완료");
    expect(extractKoreanLegalLinks(document.body, "hwp").map((w) => w.targetId)).toEqual([
      "별표-1",
      "제1조",
    ]);
  });

  it("3. [HWP 코퍼스 RAG vs Synapse-DCI] 본문 조항 검색만으로 키워드 없는 '별표 1' HWPX 표까지 자동 Pull", () => {
    const connectome = new SynapseConnectome();

    // 본문 HWPX (키워드 '출장여비_개정안' 포함, 금액 수치 없음, '별표 1' 참조)
    const mainHwpx = buildTestHwpx(
      `<hp:sec><hp:p><hp:t>출장여비_개정안 제3조 지급 기준은 별표 1에 따른다.</hp:t></hp:p></hp:sec>`
    );
    const { document: mainDoc } = parseHwpBufferToDocument(mainHwpx, {
      id: "여비규정-본문",
      collection: "hwp",
    });

    // 별표 HWPX ('출장여비_개정안' 키워드 없음, 실제 금액 표만 수록)
    const annexHwpx = buildTestHwpx(`
      <hp:sec>
        <hp:p><hp:t>직급별 숙박비 상한표</hp:t></hp:p>
        <hp:tbl>
          <hp:tr><hp:tc><hp:p><hp:t>구분</hp:t></hp:p></hp:tc><hp:tc><hp:p><hp:t>상한액</hp:t></hp:p></hp:tc></hp:tr>
          <hp:tr><hp:tc><hp:p><hp:t>책임연구원</hp:t></hp:p></hp:tc><hp:tc><hp:p><hp:t>180,000원</hp:t></hp:p></hp:tc></hp:tr>
        </hp:tbl>
      </hp:sec>
    `);
    const { document: annexDoc } = parseHwpBufferToDocument(annexHwpx, {
      id: "별표-1",
      collection: "hwp",
    });

    connectome.putDocument(mainDoc);
    connectome.putDocument(annexDoc);

    // 일반 RAG (BM25 Top-K): 별표-1 누락
    const ragHits = connectome.search("출장여비_개정안", "hwp");
    expect(ragHits.some((h) => h.document.id === "별표-1")).toBe(false);

    // Synapse-DCI (hops: 1): 본문 + 별표-1 마크다운 표까지 100% 회수 + Batch grep
    const ws = new SynapseDciWorkspace(connectome, "hwp-dci");
    const pullRes = ws.pull("출장여비_개정안", { hops: 1 });
    expect(pullRes.entries.some((e) => e.nodeId === "hwp/별표-1")).toBe(true);

    const batch = ws.executeBatch([
      { op: "grep", pattern: "180,000원" },
      { op: "cross_ref", fromNodeId: "hwp/여비규정-본문", toNodeId: "hwp/별표-1" },
    ]);
    expect((batch.outputs[0].data as any[]).length).toBe(1);
    expect((batch.outputs[1].data as any).connected).toBe(true);
  });
});
