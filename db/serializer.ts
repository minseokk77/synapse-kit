/**
 * 마크다운 및 YAML Frontmatter 직렬화/역직렬화 및 위키링크 파서 (SRP 준수)
 * 외부 무거운 라이브러리 없이 순수 TypeScript로 경량 무손실(Lossless) 파싱 수행
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SynapseWikilink } from "./types";

/** 파싱된 마크다운 원시 구조 */
export interface RawParsedMarkdown<T = Record<string, any>> {
  readonly frontmatter: T;
  readonly body: string;
  readonly wikilinks: readonly SynapseWikilink[];
}

/**
 * 텍스트에서 옵시디언 위키링크([[target|alias]] 또는 [[target]]) 자동 추출
 */
export function extractWikilinks(text: string, defaultCollection = ""): SynapseWikilink[] {
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  const links: SynapseWikilink[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawTarget = match[1].trim();
    if (!rawTarget) continue;
    const alias = match[2]?.trim();

    let targetCollection = defaultCollection;
    let targetId = rawTarget;

    if (rawTarget.includes("/")) {
      const parts = rawTarget.split("/");
      targetCollection = parts[0].trim();
      targetId = parts.slice(1).join("/").trim();
    }

    if (!targetId) continue;

    links.push({
      raw: match[0],
      targetCollection,
      targetId,
      alias,
    });
  }

  return links;
}

/**
 * YAML Frontmatter 안전 파서 (순수 TypeScript 무손실 복원)
 */
export function parseMarkdownFile<T = Record<string, any>>(
  rawContent: string,
  defaultCollection = ""
): RawParsedMarkdown<T> {
  const normalizedRaw = rawContent.replace(/\r\n/g, "\n");
  const trimmed = normalizedRaw.trimStart();
  if (!trimmed.startsWith("---\n") && trimmed !== "---") {
    const wikilinks = extractWikilinks(normalizedRaw, defaultCollection);
    return { frontmatter: {} as T, body: normalizedRaw, wikilinks };
  }

  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) {
    const wikilinks = extractWikilinks(normalizedRaw, defaultCollection);
    return { frontmatter: {} as T, body: normalizedRaw, wikilinks };
  }

  const yamlBlock = trimmed.slice(4, endIdx);
  const afterDelimiter = trimmed.slice(endIdx + 4);
  const body = afterDelimiter.replace(/^\n+/, "").replace(/\n+$/, "");

  const data: Record<string, any> = {};
  const lines = yamlBlock.split("\n");

  let currentKey = "";
  let inArray = false;
  let arrayItems: any[] = [];
  let inObjectArray = false;
  let currentObj: Record<string, any> | null = null;

  for (let line of lines) {
    line = line.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // 객체 배열 내 하위 필드 파싱 (예: "    forumChannelId: 123")
    if (inObjectArray && currentObj && /^\s{4,}[a-zA-Z0-9_-]+:/.test(line)) {
      const match = line.match(/^\s+([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (match) {
        const subKey = match[1];
        const subVal = parseYamlScalar(match[2].trim());
        currentObj[subKey] = subVal;
      }
      continue;
    }

    // 배열 아이템 시작 (예: "  - guildId: 123" 또는 "  - simple_item")
    if (inArray && /^\s*-\s+/.test(line)) {
      const itemContent = line.replace(/^\s*-\s+/, "").trim();
      // 따옴표나 브래킷으로 시작하지 않는 key: value 형태만 객체 배열 아이템으로 인식
      const objMatch =
        !itemContent.startsWith('"') &&
        !itemContent.startsWith("'") &&
        !itemContent.startsWith("{") &&
        !itemContent.startsWith("[")
          ? itemContent.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/)
          : null;

      if (objMatch) {
        inObjectArray = true;
        currentObj = {};
        const subKey = objMatch[1];
        const subVal = parseYamlScalar(objMatch[2].trim());
        currentObj[subKey] = subVal;
        arrayItems.push(currentObj);
      } else {
        inObjectArray = false;
        currentObj = null;
        arrayItems.push(parseYamlScalar(itemContent));
      }
      continue;
    }

    // 이전 배열 저장 완료
    if (inArray && currentKey) {
      data[currentKey] = arrayItems;
      inArray = false;
      inObjectArray = false;
      currentObj = null;
    }

    // 최상위 일반 키: 값
    const kvMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const valStr = kvMatch[2].trim();

      if (valStr === "") {
        // 멀티라인 배열 시작
        inArray = true;
        arrayItems = [];
      } else {
        data[currentKey] = parseYamlScalar(valStr);
      }
    }
  }

  if (inArray && currentKey) {
    data[currentKey] = arrayItems;
  }

  // 본문과 메타데이터 전체에서 위키링크 추출
  const wikilinks = extractWikilinks(normalizedRaw, defaultCollection);

  return {
    frontmatter: data as T,
    body,
    wikilinks,
  };
}

/** YAML 단일 스칼라 및 인라인 JSON 값 무손실 파싱 */
export function parseYamlScalar(val: string): any {
  if (val === "true") return true;
  if (val === "false") return false;
  if (val === "null" || val === "~" || val === "") return null;

  // 인라인 배열/객체 또는 JSON 문자열 복원
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("[") && val.endsWith("]")) ||
    (val.startsWith("{") && val.endsWith("}"))
  ) {
    try {
      return JSON.parse(val);
    } catch {
      if (val.startsWith('"') && val.endsWith('"')) {
        return val.slice(1, -1);
      }
    }
  }

  if (val.startsWith("'") && val.endsWith("'")) {
    return val.slice(1, -1);
  }

  // 안전한 범위 내의 정수 변환 (64비트 Snowflake ID 정밀도 손실 방지)
  if (/^-?\d+$/.test(val)) {
    const num = Number(val);
    if (Number.isSafeInteger(num)) {
      return num;
    }
    return val;
  }

  if (/^-?\d+\.\d+$/.test(val)) {
    const num = Number(val);
    if (Number.isFinite(num)) {
      return num;
    }
  }

  return val;
}

/** 스칼라 및 복합 값을 YAML 호환 문자열로 직렬화 */
function serializeYamlValue(val: any, indent = 0): string {
  const pad = " ".repeat(indent);
  if (val === null || val === undefined) return "null";
  if (typeof val === "boolean") return String(val);
  if (typeof val === "number") return Number.isFinite(val) ? String(val) : "null";
  if (typeof val === "string") {
    // 항상 JSON.stringify를 사용하여 줄바꿈, 따옴표, 숫자형 문자열("00123", Snowflake ID), 예약어("true", "null", "[]")를 100% 무손실 보존
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    // 중첩 객체 내부의 배열은 인라인 JSON 배열로 직렬화하여 파싱 모호성 제거
    if (indent > 0) {
      return JSON.stringify(val);
    }
    const lines: string[] = [""];
    for (const item of val) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item).filter(([, v]) => v !== undefined);
        if (entries.length === 0) {
          lines.push(`${pad}  - {}`);
          continue;
        }
        const [firstK, firstV] = entries[0];
        lines.push(`${pad}  - ${firstK}: ${serializeYamlValue(firstV, indent + 4)}`);
        for (let i = 1; i < entries.length; i++) {
          const [k, v] = entries[i];
          lines.push(`${pad}    ${k}: ${serializeYamlValue(v, indent + 4)}`);
        }
      } else {
        lines.push(`${pad}  - ${serializeYamlValue(item, indent + 2)}`);
      }
    }
    return lines.join("\n");
  }
  return JSON.stringify(val);
}

/**
 * 범용 문서를 마크다운 파일 내용으로 직렬화
 */
export function stringifyDocument(data: Record<string, any>, body = ""): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length > 0) {
      lines.push(`${key}:${serializeYamlValue(value, 0)}`);
    } else {
      lines.push(`${key}: ${serializeYamlValue(value, 0)}`);
    }
  }
  lines.push("---");
  lines.push("");
  const trimmedBody = body.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "");
  if (trimmedBody.length > 0) {
    lines.push(trimmedBody);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * 원자적 디스크 쓰기 (임시 파일 후 atomic rename)
 */
export function atomicWriteFile(targetPath: string, content: string): void {
  const dir = dirname(targetPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch {}
    throw err;
  }
}
