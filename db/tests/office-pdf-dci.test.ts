import { describe, expect, it } from "bun:test";
import { deflateRawSync, deflateSync } from "node:zlib";
import {
  SynapseConnectome,
  SynapseDciWorkspace,
  parseAnyDocumentBuffer,
} from "../index";

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

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of [...localParts, ...cdParts, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function buildFlatePdf(textLines: string[]): Uint8Array {
  const btBody = textLines.map((l) => `BT (${l}) Tj ET`).join("\n");
  const compressed = new Uint8Array(deflateSync(new TextEncoder().encode(btBody)));
  const head = new TextEncoder().encode(
    `%PDF-1.7\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`
  );
  const tail = new TextEncoder().encode(`\nendstream\nendobj\n%%EOF`);
  const out = new Uint8Array(head.length + compressed.length + tail.length);
  out.set(head, 0);
  out.set(compressed, head.length);
  out.set(tail, head.length + compressed.length);
  return out;
}

describe("📚 Synapse-Office (PDF · Word .docx · PowerPoint .pptx 네이티브 파서 & DCI 검증)", () => {
  it("1. [Word .docx] word/document.xml 본문, 표 마크다운 변환 및 위키링크 자동 추출", () => {
    const docx = buildZip([
      {
        name: "word/document.xml",
        content: `<w:document><w:body>
          <w:p><w:t>제안서 요약: 세부 단가는 [[docs/ppt-deck]] 참고</w:t></w:p>
          <w:tbl>
            <w:tr><w:tc><w:p><w:t>항목</w:t></w:p></w:tc><w:tc><w:p><w:t>예산</w:t></w:p></w:tc></w:tr>
            <w:tr><w:tc><w:p><w:t>서버증설</w:t></w:p></w:tc><w:tc><w:p><w:t>3,200만원</w:t></w:p></w:tc></w:tr>
          </w:tbl>
        </w:body></w:document>`,
      },
    ]);

    const { document, parsed } = parseAnyDocumentBuffer(docx, { id: "word-spec", collection: "docs" });
    expect(parsed.format).toBe("docx");
    expect(parsed.tablesCount).toBe(1);
    expect(document.body).toContain("| 서버증설 | 3,200만원 |");
    expect(document.wikilinks.map((w) => w.targetId)).toContain("ppt-deck");
  });

  it("2. [PowerPoint .pptx] 다중 슬라이드 순서 파싱, 표 추출 및 링크 연결", () => {
    const pptx = buildZip([
      {
        name: "ppt/slides/slide1.xml",
        content: `<p:sld><a:p><a:t>아키텍처 발표자료</a:t></a:p></p:sld>`,
      },
      {
        name: "ppt/slides/slide2.xml",
        content: `<p:sld><a:p><a:t>최종 감사 증빙은 [[docs/audit-pdf]] 참조</a:t></a:p></p:sld>`,
      },
    ]);

    const { document, parsed } = parseAnyDocumentBuffer(pptx, { id: "ppt-deck", collection: "docs" });
    expect(parsed.format).toBe("pptx");
    expect(parsed.sectionsCount).toBe(2);
    expect(document.body).toContain("## Slide 1");
    expect(document.body).toContain("## Slide 2");
    expect(document.wikilinks.map((w) => w.targetId)).toContain("audit-pdf");
  });

  it("3. [PDF .pdf] /FlateDecode 압축 스트림 해제 및 BT..ET 텍스트 추출 + 4-Hop DCI 회수", () => {
    const pdf = buildFlatePdf([
      "Audit Report 2026",
      "FINAL_APPROVAL_CODE=PDF_9981_OK",
    ]);

    const { document: pdfDoc, parsed } = parseAnyDocumentBuffer(pdf, { id: "audit-pdf", collection: "docs" });
    expect(parsed.format).toBe("pdf");
    expect(pdfDoc.body).toContain("FINAL_APPROVAL_CODE=PDF_9981_OK");

    const connectome = new SynapseConnectome();
    const docx = buildZip([
      {
        name: "word/document.xml",
        content: `<w:document><w:body><w:p><w:t>PROJECT_ORION 기획: [[docs/ppt-deck]] 참조</w:t></w:p></w:body></w:document>`,
      },
    ]);
    const pptx = buildZip([
      {
        name: "ppt/slides/slide1.xml",
        content: `<p:sld><a:p><a:t>발표 슬라이드 -> [[docs/audit-pdf]]</a:t></a:p></p:sld>`,
      },
    ]);

    connectome.putDocument(parseAnyDocumentBuffer(docx, { id: "word-spec", collection: "docs" }).document);
    connectome.putDocument(parseAnyDocumentBuffer(pptx, { id: "ppt-deck", collection: "docs" }).document);
    connectome.putDocument(pdfDoc);

    // RAG는 키워드 없는 audit-pdf 누락
    expect(connectome.search("PROJECT_ORION", "docs").some((h) => h.document.id === "audit-pdf")).toBe(false);

    // Synapse-DCI는 Word -> PPT -> PDF 2-Hop 관통 회수
    const ws = new SynapseDciWorkspace(connectome);
    const pulled = ws.pull("PROJECT_ORION", { hops: 2 });
    expect(pulled.entries.some((e) => e.nodeId === "docs/audit-pdf")).toBe(true);
    const batch = ws.executeBatch([{ op: "grep", pattern: "FINAL_APPROVAL_CODE=PDF_9981_OK" }]);
    expect((batch.outputs[0].data as any[]).length).toBe(1);
  });
});
