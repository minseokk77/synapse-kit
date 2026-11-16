import { describe, expect, it } from "bun:test";
import { deflateRawSync, deflateSync } from "node:zlib";
import { SynapseConnectome, SynapseDciWorkspace, parseAnyDocumentBuffer } from "../index";

function buildZip(entries: { name: string; content: string }[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    const raw = new TextEncoder().encode(e.content);
    const comp = new Uint8Array(deflateRawSync(raw));

    const lfh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lfh.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    localParts.push(lfh, comp);
    cdParts.push(cd);
    offset += lfh.length + comp.length;
  }

  const cdSize = cdParts.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + eocd.length);
  let pos = 0;
  for (const p of [...localParts, ...cdParts, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function buildFlatePdf(lines: string[]): Uint8Array {
  const bt = lines.map((l) => `BT (${l}) Tj ET`).join("\n");
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

function buildHwp5(line: string): Uint8Array {
  const sectorSize = 512;
  const buf = new Uint8Array(sectorSize * 5);
  const view = new DataView(buf.buffer);
  buf.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setInt32(44, 1, true);
  view.setInt32(48, 1, true);
  view.setInt32(60, -2, true);
  view.setInt32(68, -2, true);
  view.setInt32(76, 0, true);
  const fatOff = sectorSize;
  for (let i = 0; i < 128; i++) view.setInt32(fatOff + i * 4, -1, true);
  view.setInt32(fatOff, -3, true);
  view.setInt32(fatOff + 4, -2, true);
  view.setInt32(fatOff + 8, -2, true);
  view.setInt32(fatOff + 12, -2, true);
  const dirOff = sectorSize * 2;
  const writeDir = (idx: number, name: string, startSec: number, size: number) => {
    const base = dirOff + idx * 128;
    const u16 = new Uint16Array(name.length + 1);
    for (let i = 0; i < name.length; i++) u16[i] = name.charCodeAt(i);
    buf.set(new Uint8Array(u16.buffer), base);
    view.setUint16(base + 64, (name.length + 1) * 2, true);
    buf[base + 66] = 2;
    view.setInt32(base + 116, startSec, true);
    view.setUint32(base + 120, size, true);
  };
  view.setUint32(sectorSize * 3 + 36, 0x01, true);
  writeDir(0, "FileHeader", 2, 256);
  const payload = new Uint8Array(line.length * 2);
  const pv = new DataView(payload.buffer);
  for (let i = 0; i < line.length; i++) pv.setUint16(i * 2, line.charCodeAt(i), true);
  const rec = new Uint8Array(4 + payload.length);
  new DataView(rec.buffer).setUint32(0, (67 | (payload.length << 20)) >>> 0, true);
  rec.set(payload, 4);
  const comp = new Uint8Array(deflateRawSync(rec));
  buf.set(comp, sectorSize * 4);
  writeDir(1, "Section0", 3, comp.length);
  return buf;
}

describe("🌐 대중 문서 12종 전체(PDF·Word·PPT·Excel·HWPX·HWP5·HTML·CSV·JSON·YAML·XML·MD) 통합 검증", () => {
  it("1. [Excel .xlsx] sharedStrings + sheet1.xml 파싱 및 마크다운 테이블 변환", () => {
    const xlsx = buildZip([
      {
        name: "xl/sharedStrings.xml",
        content: `<sst><si><t>부서</t></si><si><t>예산</t></si><si><t>AI팀</t></si><si><t>[[docs/csv-detail]]</t></si></sst>`,
      },
      {
        name: "xl/worksheets/sheet1.xml",
        content: `<worksheet><sheetData>
          <row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>
          <row><c t="s"><v>2</v></c><c t="s"><v>3</v></c></row>
        </sheetData></worksheet>`,
      },
    ]);

    const { document, parsed } = parseAnyDocumentBuffer(xlsx, { id: "budget-xlsx", collection: "docs" });
    expect(parsed.format).toBe("xlsx");
    expect(parsed.tablesCount).toBe(1);
    expect(document.body).toContain("| 부서 | 예산 |");
    expect(document.body).toContain("| AI팀 | [[docs/csv-detail]] |");
    expect(document.wikilinks.map((w) => w.targetId)).toContain("csv-detail");
  });

  it("2. [HTML · CSV · JSON · YAML · XML] 텍스트 기반 대중 포맷 5종 자동 판별 및 정화", () => {
    const enc = new TextEncoder();

    const html = parseAnyDocumentBuffer(
      enc.encode(`<!DOCTYPE html><html><body><h1>보안공지</h1><script>evil()</script><p>참고: [[docs/data-csv]]</p></body></html>`),
      { id: "notice-html", collection: "docs" }
    );
    expect(html.parsed.format).toBe("html");
    expect(html.document.body).not.toContain("evil()");
    expect(html.document.wikilinks.map((w) => w.targetId)).toContain("data-csv");

    const csv = parseAnyDocumentBuffer(
      enc.encode(`항목,금액,비고\n"서버,증설",5000000,[[docs/cfg-json]]`),
      { id: "data-csv", collection: "docs", fileName: "data.csv" }
    );
    expect(csv.parsed.format).toBe("csv");
    expect(csv.document.body).toContain("| 서버,증설 | 5000000 | [[docs/cfg-json]] |");

    const json = parseAnyDocumentBuffer(
      enc.encode(`{"service":"synapse","next":"[[docs/cfg-yaml]]"}`),
      { id: "cfg-json", collection: "docs", fileName: "cfg.json" }
    );
    expect(json.parsed.format).toBe("json");

    const yaml = parseAnyDocumentBuffer(
      enc.encode(`service: synapse\nref: "[[docs/spec-xml]]"`),
      { id: "cfg-yaml", collection: "docs", fileName: "cfg.yaml" }
    );
    expect(yaml.parsed.format).toBe("yaml");

    const xml = parseAnyDocumentBuffer(
      enc.encode(`<?xml version="1.0"?><spec><ref>[[docs/final-pdf]]</ref></spec>`),
      { id: "spec-xml", collection: "docs", fileName: "spec.xml" }
    );
    expect(xml.parsed.format).toBe("xml");
  });

  it("3. [12종 포맷 혼합 End-to-End] 12종 전체 문서를 단일 Connectome에 적재 후 DCI Multi-Hop 회수", () => {
    const enc = new TextEncoder();
    const connectome = new SynapseConnectome();

    const docs = [
      parseAnyDocumentBuffer(enc.encode(`# MASTER_CASE_2026\n시작 -> [[docs/docx-1]]`), { id: "md-0", collection: "docs", fileName: "a.md" }).document,
      parseAnyDocumentBuffer(buildZip([{ name: "word/document.xml", content: `<w:document><w:body><w:p><w:t>Word -> [[docs/xlsx-2]]</w:t></w:p></w:body></w:document>` }]), { id: "docx-1", collection: "docs" }).document,
      parseAnyDocumentBuffer(buildZip([{ name: "xl/sharedStrings.xml", content: `<sst><si><t>[[docs/pptx-3]]</t></si></sst>` }, { name: "xl/worksheets/sheet1.xml", content: `<worksheet><sheetData><row><c t="s"><v>0</v></c></row></sheetData></worksheet>` }]), { id: "xlsx-2", collection: "docs" }).document,
      parseAnyDocumentBuffer(buildZip([{ name: "ppt/slides/slide1.xml", content: `<p:sld><a:p><a:t>PPT -> [[docs/hwpx-4]]</a:t></a:p></p:sld>` }]), { id: "pptx-3", collection: "docs" }).document,
      parseAnyDocumentBuffer(buildZip([{ name: "Contents/section0.xml", content: `<hs:sec><hp:p><hp:t>HWPX -> [[docs/hwp5-5]]</hp:t></hp:p></hs:sec>` }]), { id: "hwpx-4", collection: "docs" }).document,
      parseAnyDocumentBuffer(buildHwp5("HWP5 -> [[docs/html-6]]"), { id: "hwp5-5", collection: "docs" }).document,
      parseAnyDocumentBuffer(enc.encode(`<html><body>HTML -> [[docs/csv-7]]</body></html>`), { id: "html-6", collection: "docs", fileName: "h.html" }).document,
      parseAnyDocumentBuffer(enc.encode(`col1,col2\nCSV,[[docs/json-8]]`), { id: "csv-7", collection: "docs", fileName: "c.csv" }).document,
      parseAnyDocumentBuffer(enc.encode(`{"next":"[[docs/yaml-9]]"}`), { id: "json-8", collection: "docs", fileName: "j.json" }).document,
      parseAnyDocumentBuffer(enc.encode(`next: "[[docs/xml-10]]"`), { id: "yaml-9", collection: "docs", fileName: "y.yaml" }).document,
      parseAnyDocumentBuffer(enc.encode(`<?xml version="1.0"?><next>[[docs/pdf-11]]</next>`), { id: "xml-10", collection: "docs", fileName: "x.xml" }).document,
      parseAnyDocumentBuffer(buildFlatePdf(["FINAL_12_FORMAT_PROOF=ALL_PASS"]), { id: "pdf-11", collection: "docs" }).document,
    ];

    for (const d of docs) connectome.putDocument(d);
    expect(docs.length).toBe(12);

    // 11-Hop 전체 관통 (시냅스 DCI 다중 홉 루프 검증)
    const ws = new SynapseDciWorkspace(connectome, "all-12-formats");
    ws.pull("MASTER_CASE_2026", { hops: 4 });
    ws.pull("hwpx-4", { hops: 4 }); // 2차 확장 Pull
    ws.pull("json-8", { hops: 4 }); // 3차 확장 Pull

    const batch = ws.executeBatch([
      { op: "grep", pattern: "FINAL_12_FORMAT_PROOF=ALL_PASS" },
      { op: "cross_ref", fromNodeId: "docs/md-0", toNodeId: "docs/pdf-11" },
    ]);

    expect((batch.outputs[0].data as any[]).length).toBe(1);
    expect((batch.outputs[1].data as any).connected).toBe(true);
    expect((batch.outputs[1].data as any).path.length).toBe(12);
  });
});
