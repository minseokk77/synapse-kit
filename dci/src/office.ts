/**
 * Synapse-Office: 순수 Bun/TypeScript 기반 PDF · Word(.docx) · PowerPoint(.pptx) 네이티브 파서
 * - 외부 바이너리/npm 의존성 없이 ZIP/XML(OOXML) 및 PDF 스트림(/FlateDecode, BT..ET) 직접 파싱
 * - 표(Table) 마크다운 정규화 및 한국어/위키링크 참조 자동 추출
 */
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";
import { SynapseConnectome } from "synapse-db";
import { decodeXmlEntities, extractKoreanLegalLinks, extractZipFiles, parseHwpBufferToDocument } from "./hwp";
import type { SynapseDocument, SynapseWikilink } from "synapse-db";

export const OFFICE_PARSER_CONFIG = {
  DEFAULT_COLLECTION: "docs",
  MAX_FILE_BYTES: 64 * 1024 * 1024,
  MAX_SLIDES: 512,
  PDF_MAGIC: "%PDF-",
} as const;

export type OfficeFormat =
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "hwpx"
  | "hwp5"
  | "html"
  | "csv"
  | "json"
  | "yaml"
  | "xml"
  | "markdown";

export interface OfficeParseResult {
  readonly format: OfficeFormat;
  readonly title: string;
  readonly text: string;
  readonly markdownBody: string;
  readonly sectionsCount: number;
  readonly tablesCount: number;
  readonly wikilinks: readonly SynapseWikilink[];
}

export interface OfficeIngestOptions {
  readonly id?: string;
  readonly collection?: string;
  readonly title?: string;
  readonly fileName?: string;
}

/**
 * 본문 내 명시적 [[collection/id]] 위키링크 + 한국어 공문서 참조 통합 추출
 */
function extractAllDocumentLinks(text: string, collection: string): SynapseWikilink[] {
  const links: SynapseWikilink[] = [...extractKoreanLegalLinks(text, collection)];
  const seen = new Set(links.map((l) => `${l.targetCollection}/${l.targetId}`));

  const wikiRe = /\[\[([^\]|#\n]+?)(?:\|([^\]]+))?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = wikiRe.exec(text)) !== null) {
    const rawTarget = m[1].trim();
    const alias = m[2]?.trim();
    const slashIdx = rawTarget.indexOf("/");
    const targetCollection = slashIdx > 0 ? rawTarget.slice(0, slashIdx) : collection;
    const targetId = slashIdx > 0 ? rawTarget.slice(slashIdx + 1) : rawTarget;
    const key = `${targetCollection}/${targetId}`;
    if (!seen.has(key)) {
      seen.add(key);
      links.push({ raw: m[0], targetCollection, targetId, alias });
    }
  }

  return links;
}

/**
 * OOXML 표(<w:tbl> 또는 <a:tbl>)를 마크다운 테이블로 변환
 */
function convertOoxmlTableToMarkdown(tblInner: string): string {
  const rows: string[][] = [];
  const trMatches = tblInner.matchAll(/<(?:w:|a:)?tr\b[^>]*>([\s\S]*?)<\/(?:w:|a:)?tr>/gi);
  for (const trMatch of trMatches) {
    const cells: string[] = [];
    const tcMatches = trMatch[1].matchAll(/<(?:w:|a:)?tc\b[^>]*>([\s\S]*?)<\/(?:w:|a:)?tc>/gi);
    for (const tcMatch of tcMatches) {
      const texts: string[] = [];
      const tMatches = tcMatch[1].matchAll(/<(?:w:|a:)?t\b[^>]*>([\s\S]*?)<\/(?:w:|a:)?t>/gi);
      for (const tMatch of tMatches) {
        const clean = decodeXmlEntities(tMatch[1]).replace(/\s+/g, " ").trim();
        if (clean) texts.push(clean);
      }
      cells.push(texts.join(" ") || " ");
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return "";
  const colCount = Math.max(...rows.map((r) => r.length));
  const fmt = (r: string[]) => `| ${Array.from({ length: colCount }, (_, i) => r[i] ?? "").join(" | ")} |`;
  const lines = [fmt(rows[0]), `| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`];
  for (let i = 1; i < rows.length; i++) lines.push(fmt(rows[i]));
  return lines.join("\n");
}

/**
 * Word(.docx) 파싱
 */
export function parseDocxBuffer(
  buf: Uint8Array,
  title: string = "Word 문서",
  collection: string = OFFICE_PARSER_CONFIG.DEFAULT_COLLECTION
): OfficeParseResult {
  const entries = extractZipFiles(buf);
  const docXmlBytes = entries.get("word/document.xml");
  if (!docXmlBytes) {
    throw new Error("[Synapse-Office] DOCX 내부에 word/document.xml이 없습니다.");
  }

  const xml = new TextDecoder("utf-8").decode(docXmlBytes);
  const lines: string[] = [];
  let tablesCount = 0;
  const tableBlocks: string[] = [];

  const replaced = xml.replace(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/gi, (_f, inner: string) => {
    const md = convertOoxmlTableToMarkdown(inner);
    if (!md) return "";
    tablesCount++;
    const idx = tableBlocks.length;
    tableBlocks.push(md);
    return `<w:p><w:t>__SYNAPSE_DOCX_TBL_${idx}__</w:t></w:p>`;
  });

  const pMatches = replaced.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi);
  for (const pMatch of pMatches) {
    const tMatches = pMatch[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi);
    const segs: string[] = [];
    for (const t of tMatches) {
      const s = decodeXmlEntities(t[1]).trim();
      if (s) segs.push(s);
    }
    const joined = segs.join(" ").trim();
    if (!joined) continue;
    if (joined.startsWith("__SYNAPSE_DOCX_TBL_")) {
      const idx = Number(joined.replace("__SYNAPSE_DOCX_TBL_", "").replace("__", ""));
      if (!Number.isNaN(idx) && tableBlocks[idx]) lines.push(tableBlocks[idx]);
    } else {
      lines.push(joined);
    }
  }

  const text = lines.join("\n");
  return {
    format: "docx",
    title,
    text,
    markdownBody: text,
    sectionsCount: 1,
    tablesCount,
    wikilinks: extractAllDocumentLinks(text, collection),
  };
}

/**
 * PowerPoint(.pptx) 파싱
 */
export function parsePptxBuffer(
  buf: Uint8Array,
  title: string = "PowerPoint 문서",
  collection: string = OFFICE_PARSER_CONFIG.DEFAULT_COLLECTION
): OfficeParseResult {
  const entries = extractZipFiles(buf);
  const slideKeys = Array.from(entries.keys())
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, OFFICE_PARSER_CONFIG.MAX_SLIDES);

  if (slideKeys.length === 0) {
    throw new Error("[Synapse-Office] PPTX 내부에 ppt/slides/slide*.xml이 없습니다.");
  }

  const decoder = new TextDecoder("utf-8");
  const lines: string[] = [];
  let tablesCount = 0;

  for (let idx = 0; idx < slideKeys.length; idx++) {
    const raw = entries.get(slideKeys[idx]);
    if (!raw) continue;
    const xml = decoder.decode(raw);
    lines.push(`## Slide ${idx + 1}`);

    const tableBlocks: string[] = [];
    const replaced = xml.replace(/<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/gi, (_f, inner: string) => {
      const md = convertOoxmlTableToMarkdown(inner);
      if (!md) return "";
      tablesCount++;
      const tIdx = tableBlocks.length;
      tableBlocks.push(md);
      return `<a:p><a:t>__SYNAPSE_PPTX_TBL_${tIdx}__</a:t></a:p>`;
    });

    const pMatches = replaced.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi);
    for (const pMatch of pMatches) {
      const tMatches = pMatch[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi);
      const segs: string[] = [];
      for (const t of tMatches) {
        const s = decodeXmlEntities(t[1]).trim();
        if (s) segs.push(s);
      }
      const joined = segs.join(" ").trim();
      if (!joined) continue;
      if (joined.startsWith("__SYNAPSE_PPTX_TBL_")) {
        const tIdx = Number(joined.replace("__SYNAPSE_PPTX_TBL_", "").replace("__", ""));
        if (!Number.isNaN(tIdx) && tableBlocks[tIdx]) lines.push(tableBlocks[tIdx]);
      } else {
        lines.push(joined);
      }
    }
  }

  const text = lines.join("\n");
  return {
    format: "pptx",
    title,
    text,
    markdownBody: text,
    sectionsCount: slideKeys.length,
    tablesCount,
    wikilinks: extractAllDocumentLinks(text, collection),
  };
}

/**
 * PDF 리터럴 문자열 디코딩 (이스케이프 및 UTF-16BE BOM 지원)
 */
function decodePdfLiteralString(rawBytes: Uint8Array): string {
  const bytes: number[] = [];
  for (let i = 0; i < rawBytes.length; i++) {
    const b = rawBytes[i];
    if (b === 0x5c && i + 1 < rawBytes.length) {
      const next = rawBytes[++i];
      if (next === 0x6e) bytes.push(0x0a);
      else if (next === 0x72) bytes.push(0x0d);
      else if (next === 0x74) bytes.push(0x09);
      else if (next >= 0x30 && next <= 0x37) {
        let oct = String.fromCharCode(next);
        for (let k = 0; k < 2 && i + 1 < rawBytes.length; k++) {
          const d = rawBytes[i + 1];
          if (d >= 0x30 && d <= 0x37) {
            oct += String.fromCharCode(d);
            i++;
          } else break;
        }
        bytes.push(parseInt(oct, 8) & 0xff);
      } else {
        bytes.push(next);
      }
    } else {
      bytes.push(b);
    }
  }

  const out = new Uint8Array(bytes);
  if (out.length >= 2 && out[0] === 0xfe && out[1] === 0xff) {
    // UTF-16BE -> UTF-16LE 변환 후 디코딩
    const le = new Uint8Array(out.length - 2);
    for (let i = 2; i + 1 < out.length; i += 2) {
      le[i - 2] = out[i + 1];
      le[i - 1] = out[i];
    }
    return new TextDecoder("utf-16le").decode(le);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

/**
 * PDF 괄호 문자열 (...) 추출기
 */
function extractTextFromPdfContentStream(contentBytes: Uint8Array): string[] {
  const lines: string[] = [];
  const latin = new TextDecoder("latin1").decode(contentBytes);
  const btBlocks = latin.matchAll(/BT\b([\s\S]*?)ET\b/g);

  for (const block of btBlocks) {
    const body = block[1];
    const segs: string[] = [];
    let i = 0;

    while (i < body.length) {
      if (body[i] === "(") {
        let depth = 1;
        const start = i + 1;
        i++;
        while (i < body.length && depth > 0) {
          if (body[i] === "\\") {
            i += 2;
            continue;
          }
          if (body[i] === "(") depth++;
          else if (body[i] === ")") depth--;
          i++;
        }
        const end = i - 1;
        if (end > start) {
          const rawSlice = new Uint8Array(end - start);
          for (let k = 0; k < rawSlice.length; k++) {
            rawSlice[k] = body.charCodeAt(start + k) & 0xff;
          }
          const decoded = decodePdfLiteralString(rawSlice).trim();
          if (decoded) segs.push(decoded);
        }
      } else {
        i++;
      }
    }

    if (segs.length > 0) lines.push(segs.join(" "));
  }

  return lines;
}

/**
 * PDF(.pdf) 네이티브 파싱 (미압축 및 /FlateDecode 스트림 지원)
 */
export function parsePdfBuffer(
  buf: Uint8Array,
  title: string = "PDF 문서",
  collection: string = OFFICE_PARSER_CONFIG.DEFAULT_COLLECTION
): OfficeParseResult {
  const head = new TextDecoder("latin1").decode(buf.subarray(0, 8));
  if (!head.startsWith(OFFICE_PARSER_CONFIG.PDF_MAGIC)) {
    throw new Error("[Synapse-Office] 유효한 PDF 시그니처(%PDF-)가 아닙니다.");
  }

  const latin = new TextDecoder("latin1").decode(buf);
  const extractedLines: string[] = [];
  let streamCount = 0;

  // stream ... endstream 블록 순회
  let searchPos = 0;
  while (searchPos < latin.length) {
    const streamIdx = latin.indexOf("stream", searchPos);
    if (streamIdx === -1) break;

    const dictStart = Math.max(0, streamIdx - 256);
    const dictWindow = latin.slice(dictStart, streamIdx);
    const isFlate = /\/FlateDecode\b/.test(dictWindow);
    const lengthMatch = dictWindow.match(/\/Length\s+(\d+)\b/);

    let dataStart = streamIdx + 6;
    if (latin[dataStart] === "\r" && latin[dataStart + 1] === "\n") dataStart += 2;
    else if (latin[dataStart] === "\n" || latin[dataStart] === "\r") dataStart += 1;

    const endIdx = latin.indexOf("endstream", dataStart);
    if (endIdx === -1) break;

    let rawSlice: Uint8Array;
    if (lengthMatch) {
      const explicitLen = Number(lengthMatch[1]);
      rawSlice = buf.subarray(dataStart, Math.min(buf.byteLength, dataStart + explicitLen));
    } else {
      let dataEnd = endIdx;
      if (latin[dataEnd - 1] === "\n") {
        dataEnd--;
        if (latin[dataEnd - 1] === "\r") dataEnd--;
      } else if (latin[dataEnd - 1] === "\r") {
        dataEnd--;
      }
      rawSlice = buf.subarray(dataStart, dataEnd);
    }
    streamCount++;

    let plainBytes: Uint8Array = rawSlice;
    if (isFlate) {
      try {
        plainBytes = new Uint8Array(inflateSync(rawSlice));
      } catch {
        try {
          plainBytes = new Uint8Array(inflateRawSync(rawSlice));
        } catch {
          plainBytes = rawSlice;
        }
      }
    }

    extractedLines.push(...extractTextFromPdfContentStream(plainBytes));
    searchPos = endIdx + 9;
  }

  // 스트림이 없는 단순 PDF의 경우 전체 본문에서 BT..ET 시도
  if (extractedLines.length === 0) {
    extractedLines.push(...extractTextFromPdfContentStream(buf));
  }

  const text = extractedLines.join("\n");
  return {
    format: "pdf",
    title,
    text,
    markdownBody: text,
    sectionsCount: Math.max(1, streamCount),
    tablesCount: 0,
    wikilinks: extractAllDocumentLinks(text, collection),
  };
}

/**
 * Excel(.xlsx) 네이티브 파싱 (sharedStrings + worksheets -> 마크다운 테이블)
 */
export function parseXlsxBuffer(
  buf: Uint8Array,
  title: string = "Excel 통합문서",
  collection: string = OFFICE_PARSER_CONFIG.DEFAULT_COLLECTION
): OfficeParseResult {
  const entries = extractZipFiles(buf);
  const decoder = new TextDecoder("utf-8");

  const sharedStrings: string[] = [];
  const ssBytes = entries.get("xl/sharedStrings.xml");
  if (ssBytes) {
    const ssXml = decoder.decode(ssBytes);
    const siMatches = ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi);
    for (const si of siMatches) {
      const tMatches = si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi);
      const segs: string[] = [];
      for (const t of tMatches) segs.push(decodeXmlEntities(t[1]));
      sharedStrings.push(segs.join("").trim());
    }
  }

  const sheetKeys = Array.from(entries.keys())
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (sheetKeys.length === 0) {
    throw new Error("[Synapse-Office] XLSX 내부에 xl/worksheets/sheet*.xml이 없습니다.");
  }

  const lines: string[] = [];
  let tablesCount = 0;

  for (let sIdx = 0; sIdx < sheetKeys.length; sIdx++) {
    const raw = entries.get(sheetKeys[sIdx]);
    if (!raw) continue;
    const xml = decoder.decode(raw);
    const rows: string[][] = [];

    const rowMatches = xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi);
    for (const rMatch of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi);
      for (const cMatch of cellMatches) {
        const attrs = cMatch[1];
        const inner = cMatch[2];
        const isShared = /\bt=["']s["']/i.test(attrs);
        const isInline = /\bt=["']inlineStr["']/i.test(attrs);
        if (isInline) {
          const tMatch = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/i);
          cells.push(tMatch ? decodeXmlEntities(tMatch[1]).trim() : "");
        } else {
          const vMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
          if (!vMatch) {
            cells.push("");
          } else if (isShared) {
            const idx = Number(vMatch[1].trim());
            cells.push(sharedStrings[idx] ?? "");
          } else {
            cells.push(decodeXmlEntities(vMatch[1]).trim());
          }
        }
      }
      if (cells.length > 0) rows.push(cells);
    }

    lines.push(`## Sheet ${sIdx + 1}`);
    if (rows.length > 0) {
      tablesCount++;
      const colCount = Math.max(...rows.map((r) => r.length));
      const fmt = (r: string[]) => `| ${Array.from({ length: colCount }, (_, i) => r[i] ?? "").join(" | ")} |`;
      lines.push(fmt(rows[0]));
      lines.push(`| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`);
      for (let i = 1; i < rows.length; i++) lines.push(fmt(rows[i]));
    }
  }

  const text = lines.join("\n");
  return {
    format: "xlsx",
    title,
    text,
    markdownBody: text,
    sectionsCount: sheetKeys.length,
    tablesCount,
    wikilinks: extractAllDocumentLinks(text, collection),
  };
}

/**
 * CSV / TSV -> 마크다운 테이블 변환 파서
 */
export function parseCsvBuffer(
  buf: Uint8Array,
  delimiter: "," | "\t" = ",",
  title: string = "CSV 데이터",
  collection: string = OFFICE_PARSER_CONFIG.DEFAULT_COLLECTION
): OfficeParseResult {
  const raw = new TextDecoder("utf-8").decode(buf).trim();
  const rawLines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: string[][] = rawLines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  });

  if (rows.length === 0) {
    return { format: "csv", title, text: "", markdownBody: "", sectionsCount: 1, tablesCount: 0, wikilinks: [] };
  }

  const colCount = Math.max(...rows.map((r) => r.length));
  const fmt = (r: string[]) => `| ${Array.from({ length: colCount }, (_, i) => r[i] ?? "").join(" | ")} |`;
  const mdLines = [fmt(rows[0]), `| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`];
  for (let i = 1; i < rows.length; i++) mdLines.push(fmt(rows[i]));

  const text = mdLines.join("\n");
  return {
    format: "csv",
    title,
    text,
    markdownBody: text,
    sectionsCount: 1,
    tablesCount: 1,
    wikilinks: extractAllDocumentLinks(text, collection),
  };
}

/**
 * HTML 문서 파서 (스크립트/스타일 제거 후 텍스트 & 참조 추출)
 */
export function parseHtmlBuffer(
  buf: Uint8Array,
  title: string = "HTML 문서",
  collection: string = OFFICE_PARSER_CONFIG.DEFAULT_COLLECTION
): OfficeParseResult {
  const raw = new TextDecoder("utf-8").decode(buf);
  const cleaned = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|br)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const lines = decodeXmlEntities(cleaned)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);

  const text = lines.join("\n");
  return {
    format: "html",
    title,
    text,
    markdownBody: text,
    sectionsCount: 1,
    tablesCount: 0,
    wikilinks: extractAllDocumentLinks(text, collection),
  };
}

/**
 * 대중 문서 12종 통합 자동 판별 파서
 * (PDF / DOCX / PPTX / XLSX / HWPX / HWP5 / HTML / CSV·TSV / JSON / YAML / XML / Markdown·TXT)
 */
export function parseAnyDocumentBuffer(
  buf: Uint8Array,
  options: OfficeIngestOptions = {}
): { document: SynapseDocument; parsed: OfficeParseResult } {
  if (buf.byteLength === 0 || buf.byteLength > OFFICE_PARSER_CONFIG.MAX_FILE_BYTES) {
    throw new Error(`[Synapse-Office] 지원 범위를 벗어난 파일 크기입니다: ${buf.byteLength} bytes`);
  }

  const collection = options.collection || OFFICE_PARSER_CONFIG.DEFAULT_COLLECTION;
  const id = options.id || `doc-${Date.now()}`;
  const title = options.title || id;
  const ext = options.fileName ? extname(options.fileName).toLowerCase() : "";

  // 1. PDF (%PDF-)
  if (buf.byteLength >= 5 && new TextDecoder("latin1").decode(buf.subarray(0, 5)) === "%PDF-") {
    const parsed = parsePdfBuffer(buf, title, collection);
    return { document: toSynapseDocument(id, collection, parsed), parsed };
  }

  // 2. OLE2 (HWP 5.0)
  if (buf.byteLength >= 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    const res = parseHwpBufferToDocument(buf, { id, collection, title });
    return { document: res.document, parsed: res.parsed };
  }

  // 3. ZIP 기반 OOXML / OWPML (DOCX / PPTX / XLSX / HWPX)
  if (buf.byteLength >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const entries = extractZipFiles(buf);
    if (entries.has("word/document.xml")) {
      const parsed = parseDocxBuffer(buf, title, collection);
      return { document: toSynapseDocument(id, collection, parsed), parsed };
    }
    if (Array.from(entries.keys()).some((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))) {
      const parsed = parsePptxBuffer(buf, title, collection);
      return { document: toSynapseDocument(id, collection, parsed), parsed };
    }
    if (Array.from(entries.keys()).some((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))) {
      const parsed = parseXlsxBuffer(buf, title, collection);
      return { document: toSynapseDocument(id, collection, parsed), parsed };
    }
    const res = parseHwpBufferToDocument(buf, { id, collection, title });
    return { document: res.document, parsed: res.parsed };
  }

  // 4. 텍스트 기반 포맷 판별 (HTML / CSV / TSV / JSON / XML / YAML / Markdown·TXT)
  const text = new TextDecoder("utf-8").decode(buf);
  const trimmed = text.trimStart();

  if (ext === ".html" || ext === ".htm" || /^<!doctype\s+html|^<html\b/i.test(trimmed)) {
    const parsed = parseHtmlBuffer(buf, title, collection);
    return { document: toSynapseDocument(id, collection, parsed), parsed };
  }
  if (ext === ".tsv") {
    const parsed = parseCsvBuffer(buf, "\t", title, collection);
    return { document: toSynapseDocument(id, collection, parsed), parsed };
  }
  if (ext === ".csv") {
    const parsed = parseCsvBuffer(buf, ",", title, collection);
    return { document: toSynapseDocument(id, collection, parsed), parsed };
  }
  if (ext === ".json" || ((trimmed.startsWith("{") || trimmed.startsWith("[")) && !trimmed.startsWith("[["))) {
    const parsed: OfficeParseResult = {
      format: "json",
      title,
      text,
      markdownBody: text,
      sectionsCount: 1,
      tablesCount: 0,
      wikilinks: extractAllDocumentLinks(text, collection),
    };
    return { document: toSynapseDocument(id, collection, parsed), parsed };
  }
  if (ext === ".xml" || trimmed.startsWith("<?xml")) {
    const parsed: OfficeParseResult = {
      format: "xml",
      title,
      text,
      markdownBody: text,
      sectionsCount: 1,
      tablesCount: 0,
      wikilinks: extractAllDocumentLinks(text, collection),
    };
    return { document: toSynapseDocument(id, collection, parsed), parsed };
  }
  if (ext === ".yaml" || ext === ".yml") {
    const parsed: OfficeParseResult = {
      format: "yaml",
      title,
      text,
      markdownBody: text,
      sectionsCount: 1,
      tablesCount: 0,
      wikilinks: extractAllDocumentLinks(text, collection),
    };
    return { document: toSynapseDocument(id, collection, parsed), parsed };
  }

  const parsed: OfficeParseResult = {
    format: "markdown",
    title,
    text,
    markdownBody: text,
    sectionsCount: 1,
    tablesCount: 0,
    wikilinks: extractAllDocumentLinks(text, collection),
  };
  return { document: toSynapseDocument(id, collection, parsed), parsed };
}

function toSynapseDocument(id: string, collection: string, parsed: OfficeParseResult): SynapseDocument {
  const now = new Date().toISOString();
  return {
    id,
    collection,
    data: {
      title: parsed.title,
      format: parsed.format,
      sectionsCount: parsed.sectionsCount,
      tablesCount: parsed.tablesCount,
    },
    body: parsed.markdownBody,
    createdAt: now,
    updatedAt: now,
    wikilinks: parsed.wikilinks,
  };
}

/**
 * 디스크상의 PDF / DOCX / PPTX / HWPX / HWP / MD 파일을 Connectome에 통합 적재
 */
export function ingestAnyDocumentFile(
  connectome: SynapseConnectome,
  filePath: string,
  options: OfficeIngestOptions = {}
): { document: SynapseDocument; parsed: OfficeParseResult } {
  const bytes = new Uint8Array(readFileSync(filePath));
  const ext = extname(filePath);
  const baseId = options.id || basename(filePath, ext);
  const res = parseAnyDocumentBuffer(bytes, {
    ...options,
    id: baseId,
    title: options.title || baseId,
    fileName: options.fileName || filePath,
  });
  connectome.putDocument(res.document);
  return res;
}
