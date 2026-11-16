/**
 * Synapse-Repair: Structured Output Repair & Schema Enforcer
 * - LLM이 생성한 깨진 JSON(마크다운 펜스, 주석, 후행 콤마, 닫히지 않은 괄호, 작은따옴표 키)을
 *   재호출(토큰 낭비) 없이 로컬에서 O(n) 즉시 복구하고 선언적 스키마로 검증·강제 변환
 */

export const REPAIR_CONFIG = {
  MAX_INPUT_BYTES: 2 * 1024 * 1024,
} as const;

export type SchemaFieldType = "string" | "number" | "boolean" | "array" | "object";

export interface SchemaFieldRule {
  readonly type: SchemaFieldType;
  readonly required?: boolean;
  readonly enumValues?: readonly (string | number | boolean)[];
}

export type ObjectSchemaSpec = Record<string, SchemaFieldRule>;

export interface RepairOutcome<T = Record<string, unknown>> {
  readonly ok: boolean;
  readonly repaired: boolean;
  readonly data: T | null;
  readonly appliedFixes: readonly string[];
  readonly errors: readonly string[];
}

/**
 * 깨진 JSON 문자열 로컬 자가 복구
 */
export function repairJsonString(raw: string): { jsonText: string; fixes: string[] } {
  if (raw.length > REPAIR_CONFIG.MAX_INPUT_BYTES) {
    throw new Error(`[Synapse-Repair] 입력 크기 초과: ${raw.length} bytes`);
  }

  const fixes: string[] = [];
  let text = raw.trim();

  // 1. 마크다운 코드 펜스(```json ... ```) 제거
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
    fixes.push("strip_markdown_fence");
  }

  // 2. 앞뒤 잡음 텍스트 제거 (첫 '{' 또는 '[' 부터 마지막까지)
  const firstObj = text.indexOf("{");
  const firstArr = text.indexOf("[");
  const startIdx =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (startIdx > 0) {
    text = text.slice(startIdx);
    fixes.push("trim_leading_prose");
  }

  // 3. 한 줄 주석(// ...) 제거 (문자열 외부만 간단히 처리)
  const withoutComments = text.replace(/^\s*\/\/.*$/gm, "");
  if (withoutComments !== text) {
    text = withoutComments;
    fixes.push("strip_comments");
  }

  // 4. 비quoted 또는 작은따옴표 키를 표준 큰따옴표 키로 복구
  const quotedKeys = text.replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":');
  if (quotedKeys !== text) {
    text = quotedKeys;
    fixes.push("normalize_single_quoted_keys");
  }

  // 5. 닫히지 않은 괄호 자동 균형 맞추기
  const stack: string[] = [];
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inStr) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
    }
  }

  if (inStr) {
    text += '"';
    fixes.push("close_unterminated_string");
  }
  if (stack.length > 0) {
    text += stack.reverse().join("");
    fixes.push("balance_closing_brackets");
  }

  // 6. 괄호 균형 복구 후 모든 후행 콤마(, } / , ]) 제거
  const noTrailingComma = text.replace(/,\s*([}\]])/g, "$1");
  if (noTrailingComma !== text) {
    text = noTrailingComma;
    fixes.push("remove_trailing_commas");
  }

  return { jsonText: text, fixes };
}

/**
 * JSON 복구 + 선언적 스키마 검증 및 경량 타입 강제 변환
 */
export function parseAndEnforceSchema<T extends Record<string, unknown> = Record<string, unknown>>(
  raw: string,
  schema: ObjectSchemaSpec
): RepairOutcome<T> {
  const { jsonText, fixes } = repairJsonString(raw);
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(jsonText);
  } catch (err: any) {
    return {
      ok: false,
      repaired: fixes.length > 0,
      data: null,
      appliedFixes: fixes,
      errors: [`[Synapse-Repair] JSON 파싱 복구 실패: ${err?.message || String(err)}`],
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      repaired: fixes.length > 0,
      data: null,
      appliedFixes: fixes,
      errors: ["[Synapse-Repair] 루트 JSON은 객체여야 합니다."],
    };
  }

  const errors: string[] = [];
  const out: Record<string, unknown> = { ...parsed };

  for (const [key, rule] of Object.entries(schema)) {
    const val = out[key];
    if (val === undefined || val === null) {
      if (rule.required) {
        errors.push(`필수 필드 누락: ${key}`);
      }
      continue;
    }

    // 경량 타입 강제 변환 (예: "42" -> 42, "true" -> true)
    if (rule.type === "number" && typeof val === "string" && val.trim() !== "" && !Number.isNaN(Number(val))) {
      out[key] = Number(val);
      fixes.push(`coerce_number:${key}`);
    } else if (rule.type === "boolean" && typeof val === "string") {
      if (val.toLowerCase() === "true") {
        out[key] = true;
        fixes.push(`coerce_boolean:${key}`);
      } else if (val.toLowerCase() === "false") {
        out[key] = false;
        fixes.push(`coerce_boolean:${key}`);
      }
    }

    const finalVal = out[key];
    const actualType = Array.isArray(finalVal) ? "array" : typeof finalVal;
    if (actualType !== rule.type) {
      errors.push(`타입 불일치(${key}): 기대=${rule.type}, 실제=${actualType}`);
      continue;
    }

    if (rule.enumValues && !rule.enumValues.includes(finalVal as any)) {
      errors.push(`허용되지 않은 enum 값(${key}): ${String(finalVal)}`);
    }
  }

  return {
    ok: errors.length === 0,
    repaired: fixes.length > 0,
    data: errors.length === 0 ? (out as T) : null,
    appliedFixes: fixes,
    errors,
  };
}
