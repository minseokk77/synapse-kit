/**
 * Synapse-HWP: 순수 Bun/TypeScript 기반 HWPX (OWPML) & HWP 5.0 (OLE2) 네이티브 파서 및 Connectome 인제스터
 * - 외부 바이너리/npm 의존성 없이 ZIP/XML(.hwpx) 및 OLE2/zlib(.hwp) 스트림을 직접 파싱
 * - 표(Table) 마크다운 정규화 및 한국어 공문서 참조(별표, 붙임, 제N조) 자동 위키링크 추출
 */
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import { SynapseConnectome } from "./connectome";
import type { SynapseDocument, SynapseWikilink } from "./types";

export const HWP_PARSER_CONFIG = {
  DEFAULT_COLLECTION: "hwp",
  MAX_FILE_BYTES: 64 * 1024 * 1024,
  MAX_SECTIONS: 256,
  ZIP_LOCAL_SIG: 0x04034b50,
  ZIP_CENTRAL_SIG: 0x02014b50,
  ZIP_EOCD_SIG: 0x06054b50,
  OLE2_SIG: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const,
  HWPTAG_PARA_TEXT: 67,
  HWP_CONTROL_SKIP_WCHARS: 7,
} as const;

export interface HwpParseResult {
  readonly format: "hwpx" | "hwp5";
  readonly title: string;
  readonly text: string;
  readonly markdownBody: string;
  readonly sectionsCount: number;
  readonly tablesCount: number;
  readonly wikilinks: readonly SynapseWikilink[];
}

export interface HwpIngestOptions {
  readonly id?: string;
  readonly collection?: string;
  readonly title?: string;
}

/**
 * XML 엔터티 디코딩
 */
export function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * 한국어 공문서/규정집 참조 패턴(별표 N, 붙임 N, 제N조)을 위키링크로 자동 추출
 */
export function extractKoreanLegalLinks(
  text: string,
  collection: string = HWP_PARSER_CONFIG.DEFAULT_COLLECTION
): SynapseWikilink[] {
  const links: SynapseWikilink[] = [];
  const seen = new Set<string>();

  const patterns: { regex: RegExp; prefix: string }[] = [
    { regex: /별표\s*(\d+)/g, prefix: "별표-" },
    { regex: /붙임\s*(\d+)/g, prefix: "붙임-" },
    { regex: /제\s*(\d+)\s*조/g, prefix: "제" },
  ];

  for (const { regex, prefix } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const num = match[1];
      const targetId = prefix === "제" ? `제${num}조` : `${prefix}${num}`;
      const key = `${collection}/${targetId}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({
          raw: `[[${key}]]`,
          targetCollection: collection,
          targetId,
          alias: match[0].trim(),
        });
      }
    }
  }

  // 명시적 [[collection/id]] 위키링크도 함께 추출
  const explicitRe = /\[\[([^\]|#\n]+?)(?:\|([^\]]+))?\]\]/g;
  let explicitMatch: RegExpExecArray | null;
  while ((explicitMatch = explicitRe.exec(text)) !== null) {
    const rawTarget = explicitMatch[1].trim();
    const slashIdx = rawTarget.indexOf("/");
    const targetCollection = slashIdx > 0 ? rawTarget.slice(0, slashIdx) : collection;
    const targetId = slashIdx > 0 ? rawTarget.slice(slashIdx + 1) : rawTarget;
    const key = `${targetCollection}/${targetId}`;
    if (!seen.has(key)) {
      seen.add(key);
      links.push({
        raw: explicitMatch[0],
        targetCollection,
        targetId,
        alias: explicitMatch[2]?.trim(),
      });
    }
  }

  return links;
}

/**
 * 순수 Bun/TS ZIP 파서 (Central Directory / EOCD 기반)
 */
export function extractZipFiles(buf: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const files = new Map<string, Uint8Array>();

  // EOCD 시그니처 역탐색
  let eocdOffset = -1;
  const minOffset = Math.max(0, buf.byteLength - 65557);
  for (let i = buf.byteLength - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === HWP_PARSER_CONFIG.ZIP_EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("[Synapse-HWP] 유효한 HWPX(ZIP) EOCD 헤더를 찾을 수 없습니다.");
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let cdOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder("utf-8");

  for (let i = 0; i < totalEntries; i++) {
    if (cdOffset + 46 > buf.byteLength) break;
    if (view.getUint32(cdOffset, true) !== HWP_PARSER_CONFIG.ZIP_CENTRAL_SIG) break;

    const method = view.getUint16(cdOffset + 10, true);
    const compressedSize = view.getUint32(cdOffset + 20, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);

    const fileName = decoder.decode(buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
    cdOffset += 46 + nameLen + extraLen + commentLen;

    if (localHeaderOffset + 30 > buf.byteLength) continue;
    if (view.getUint32(localHeaderOffset, true) !== HWP_PARSER_CONFIG.ZIP_LOCAL_SIG) continue;

    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      files.set(fileName, compressed);
    } else if (method === 8) {
      files.set(fileName, new Uint8Array(inflateRawSync(compressed)));
    }
  }

  return files;
}

/**
 * HWPX section XML에서 문단 및 마크다운 테이블 추출
 */
function parseHwpxSectionXml(xml: string): { lines: string[]; tablesCount: number } {
  const lines: string[] = [];
  let tablesCount = 0;

  // 1. 표(<hp:tbl> 또는 <tbl>) 영역을 먼저 추출해 마크다운 테이블로 변환하고 본문에서 플레이스홀더로 치환
  const tableBlocks: string[] = [];
  const xmlWithPlaceholders = xml.replace(
    /<(?:hp:|w:)?tbl\b[^>]*>([\s\S]*?)<\/(?:hp:|w:)?tbl>/gi,
    (_full, tblInner: string) => {
      tablesCount++;
      const rows: string[][] = [];
      const trMatches = tblInner.matchAll(/<(?:hp:|w:)?tr\b[^>]*>([\s\S]*?)<\/(?:hp:|w:)?tr>/gi);
      for (const trMatch of trMatches) {
        const rowCells: string[] = [];
        const tcMatches = trMatch[1].matchAll(/<(?:hp:|w:)?tc\b[^>]*>([\s\S]*?)<\/(?:hp:|w:)?tc>/gi);
        for (const tcMatch of tcMatches) {
          const texts: string[] = [];
          const tMatches = tcMatch[1].matchAll(/<(?:[a-z0-9]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?t>/gi);
          for (const tMatch of tMatches) {
            const clean = decodeXmlEntities(tMatch[1]).replace(/\s+/g, " ").trim();
            if (clean) texts.push(clean);
          }
          rowCells.push(texts.join(" ") || " ");
        }
        if (rowCells.length > 0) rows.push(rowCells);
      }

      if (rows.length === 0) return "";
      const colCount = Math.max(...rows.map((r) => r.length));
      const normalizeRow = (r: string[]) =>
        `| ${Array.from({ length: colCount }, (_, idx) => r[idx] ?? "").join(" | ")} |`;

      const mdRows = [normalizeRow(rows[0])];
      mdRows.push(`| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`);
      for (let i = 1; i < rows.length; i++) {
        mdRows.push(normalizeRow(rows[i]));
      }

      const token = `__SYNAPSE_TABLE_${tableBlocks.length}__`;
      tableBlocks.push(mdRows.join("\n"));
      return `<p><t>${token}</t></p>`;
    }
  );

  // 2. 문단(<hp:p> / <p>) 단위 텍스트 추출
  const pMatches = xmlWithPlaceholders.matchAll(/<(?:[a-z0-9]+:)?p\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?p>/gi);
  for (const pMatch of pMatches) {
    const tMatches = pMatch[1].matchAll(/<(?:[a-z0-9]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?t>/gi);
    const segs: string[] = [];
    for (const tMatch of tMatches) {
      const txt = decodeXmlEntities(tMatch[1]).trim();
      if (txt) segs.push(txt);
    }
    const joined = segs.join(" ").trim();
    if (!joined) continue;

    if (joined.startsWith("__SYNAPSE_TABLE_")) {
      const idx = Number(joined.replace("__SYNAPSE_TABLE_", "").replace("__", ""));
      if (!Number.isNaN(idx) && tableBlocks[idx]) {
        lines.push(tableBlocks[idx]);
      }
    } else {
      lines.push(joined);
    }
  }

  return { lines, tablesCount };
}

/**
 * HWPX (ZIP + XML) 파싱
 */
export function parseHwpxBuffer(
  buf: Uint8Array,
  title: string = "HWPX 문서",
  collection: string = HWP_PARSER_CONFIG.DEFAULT_COLLECTION
): HwpParseResult {
  const entries = extractZipFiles(buf);
  const sectionKeys = Array.from(entries.keys())
    .filter((k) => /^Contents\/section\d+\.xml$/i.test(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, HWP_PARSER_CONFIG.MAX_SECTIONS);

  if (sectionKeys.length === 0) {
    throw new Error("[Synapse-HWP] HWPX 내부에 Contents/section*.xml 본문이 없습니다.");
  }

  const decoder = new TextDecoder("utf-8");
  const allLines: string[] = [];
  let tablesCount = 0;

  for (const key of sectionKeys) {
    const raw = entries.get(key);
    if (!raw) continue;
    const parsed = parseHwpxSectionXml(decoder.decode(raw));
    allLines.push(...parsed.lines);
    tablesCount += parsed.tablesCount;
  }

  const text = allLines.join("\n");
  const wikilinks = extractKoreanLegalLinks(text, collection);

  return {
    format: "hwpx",
    title,
    text,
    markdownBody: text,
    sectionsCount: sectionKeys.length,
    tablesCount,
    wikilinks,
  };
}

/**
 * OLE2 (CFB) 컨테이너에서 필요한 스트림 추출
 */
function extractOle2Streams(buf: Uint8Array): Map<string, Uint8Array> {
  for (let i = 0; i < HWP_PARSER_CONFIG.OLE2_SIG.length; i++) {
    if (buf[i] !== HWP_PARSER_CONFIG.OLE2_SIG[i]) {
      throw new Error("[Synapse-HWP] 유효한 OLE2(HWP 5.0) 시그니처가 아닙니다.");
    }
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sectorShift = view.getUint16(30, true);
  const sectorSize = 1 << sectorShift;
  const firstDirSector = view.getInt32(48, true);

  // DIFAT (헤더 오프셋 76, 109개 엔트리) 기반 FAT 테이블 구축
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const sec = view.getInt32(76 + i * 4, true);
    if (sec < 0) break;
    fatSectors.push(sec);
  }

  const fat: number[] = [];
  for (const sec of fatSectors) {
    const offset = (sec + 1) * sectorSize;
    if (offset + sectorSize > buf.byteLength) break;
    for (let j = 0; j < sectorSize; j += 4) {
      fat.push(view.getInt32(offset + j, true));
    }
  }

  const readChain = (startSector: number, maxBytes?: number): Uint8Array => {
    const chunks: Uint8Array[] = [];
    let current = startSector;
    let total = 0;
    const visited = new Set<number>();

    while (current >= 0 && current < fat.length && !visited.has(current)) {
      visited.add(current);
      const offset = (current + 1) * sectorSize;
      if (offset >= buf.byteLength) break;
      const sliceEnd = Math.min(buf.byteLength, offset + sectorSize);
      const chunk = buf.subarray(offset, sliceEnd);
      chunks.push(chunk);
      total += chunk.byteLength;
      if (maxBytes !== undefined && total >= maxBytes) break;
      current = fat[current];
    }

    const out = new Uint8Array(maxBytes !== undefined ? Math.min(total, maxBytes) : total);
    let pos = 0;
    for (const c of chunks) {
      const take = Math.min(c.byteLength, out.byteLength - pos);
      out.set(c.subarray(0, take), pos);
      pos += take;
      if (pos >= out.byteLength) break;
    }
    return out;
  };

  const dirData = readChain(firstDirSector);
  const dirView = new DataView(dirData.buffer, dirData.byteOffset, dirData.byteLength);
  const streams = new Map<string, Uint8Array>();

  for (let off = 0; off + 128 <= dirData.byteLength; off += 128) {
    const nameByteLen = dirView.getUint16(off + 64, true);
    const objType = dirData[off + 66]; // 2 = Stream, 5 = Root
    if (objType !== 2 || nameByteLen < 2 || nameByteLen > 64) continue;

    const nameBuf = dirData.subarray(off, off + nameByteLen - 2);
    const name = new TextDecoder("utf-16le").decode(nameBuf);
    const startSector = dirView.getInt32(off + 116, true);
    const streamSize = dirView.getUint32(off + 120, true);

    if (startSector >= 0 && streamSize > 0) {
      streams.set(name, readChain(startSector, streamSize));
    }
  }

  return streams;
}

/**
 * HWP 5.0 레코드 스트림에서 HWPTAG_PARA_TEXT(67) 텍스트 디코딩
 */
function decodeHwp5SectionRecords(sectionBytes: Uint8Array): string[] {
  const view = new DataView(sectionBytes.buffer, sectionBytes.byteOffset, sectionBytes.byteLength);
  const lines: string[] = [];
  let pos = 0;

  while (pos + 4 <= sectionBytes.byteLength) {
    const header = view.getUint32(pos, true);
    pos += 4;
    const tagId = header & 0x3ff;
    let size = (header >>> 20) & 0xfff;
    if (size === 0xfff) {
      if (pos + 4 > sectionBytes.byteLength) break;
      size = view.getUint32(pos, true);
      pos += 4;
    }

    if (pos + size > sectionBytes.byteLength) break;
    if (tagId === HWP_PARSER_CONFIG.HWPTAG_PARA_TEXT) {
      const chars: string[] = [];
      const recView = new DataView(sectionBytes.buffer, sectionBytes.byteOffset + pos, size);
      const wcharCount = Math.floor(size / 2);

      for (let i = 0; i < wcharCount; i++) {
        const ch = recView.getUint16(i * 2, true);
        if (ch === 0) break;
        if (ch === 10 || ch === 13) {
          chars.push("\n");
          continue;
        }
        if (ch === 9) {
          chars.push("\t");
          continue;
        }
        if (ch < 32) {
          // HWP 5.0 확장/인라인 컨트롤(8 WCHAR) 스킵
          i += HWP_PARSER_CONFIG.HWP_CONTROL_SKIP_WCHARS;
          continue;
        }
        chars.push(String.fromCharCode(ch));
      }

      const line = chars.join("").trim();
      if (line) lines.push(line);
    }

    pos += size;
  }

  return lines;
}

/**
 * HWP 5.0 (OLE2 + zlib) 파싱
 */
export function parseHwp5Buffer(
  buf: Uint8Array,
  title: string = "HWP 5.0 문서",
  collection: string = HWP_PARSER_CONFIG.DEFAULT_COLLECTION
): HwpParseResult {
  const streams = extractOle2Streams(buf);
  const fileHeader = streams.get("FileHeader");
  let isCompressed = true;
  if (fileHeader && fileHeader.byteLength >= 40) {
    const flags = new DataView(fileHeader.buffer, fileHeader.byteOffset, fileHeader.byteLength).getUint32(36, true);
    isCompressed = (flags & 0x01) !== 0;
  }

  const sectionNames = Array.from(streams.keys())
    .filter((k) => /^Section\d+$/i.test(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, HWP_PARSER_CONFIG.MAX_SECTIONS);

  if (sectionNames.length === 0) {
    throw new Error("[Synapse-HWP] HWP 5.0 스트림 내 Section* 본문이 없습니다.");
  }

  const allLines: string[] = [];
  for (const name of sectionNames) {
    const raw = streams.get(name);
    if (!raw) continue;
    const plain = isCompressed ? new Uint8Array(inflateRawSync(raw)) : raw;
    allLines.push(...decodeHwp5SectionRecords(plain));
  }

  const text = allLines.join("\n");
  const wikilinks = extractKoreanLegalLinks(text, collection);

  return {
    format: "hwp5",
    title,
    text,
    markdownBody: text,
    sectionsCount: sectionNames.length,
    tablesCount: 0,
    wikilinks,
  };
}

/**
 * 매직 바이트 기반 HWP/HWPX 자동 판별 파싱 및 SynapseDocument 생성
 */
export function parseHwpBufferToDocument(
  buf: Uint8Array,
  options: HwpIngestOptions = {}
): { document: SynapseDocument; parsed: HwpParseResult } {
  if (buf.byteLength === 0 || buf.byteLength > HWP_PARSER_CONFIG.MAX_FILE_BYTES) {
    throw new Error(`[Synapse-HWP] 지원 범위를 벗어난 파일 크기입니다: ${buf.byteLength} bytes`);
  }

  const collection = options.collection || HWP_PARSER_CONFIG.DEFAULT_COLLECTION;
  const id = options.id || `doc-${Date.now()}`;
  const title = options.title || id;

  const isZip = buf.byteLength >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  const parsed = isZip
    ? parseHwpxBuffer(buf, title, collection)
    : parseHwp5Buffer(buf, title, collection);

  const now = new Date().toISOString();
  const document: SynapseDocument = {
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

  return { document, parsed };
}

/**
 * 디스크상의 .hwp / .hwpx 파일을 읽어 SynapseConnectome에 즉시 적재
 */
export function ingestHwpFile(
  connectome: SynapseConnectome,
  filePath: string,
  options: HwpIngestOptions = {}
): { document: SynapseDocument; parsed: HwpParseResult } {
  const bytes = new Uint8Array(readFileSync(filePath));
  const ext = extname(filePath);
  const baseId = options.id || basename(filePath, ext);
  const result = parseHwpBufferToDocument(bytes, {
    ...options,
    id: baseId,
    title: options.title || baseId,
  });

  connectome.putDocument(result.document);
  return result;
}
