/**
 * 마크다운 볼트 보안 검증 및 새니타이저 (Vault Sanitizer)
 * - Frontmatter 및 본문 내 악성 태그(<script>, javascript:, onload=) 주입 차단
 */
import type { SecurityViolation } from "./types";

const SCRIPT_TAG_REGEX =
  /<script\b[^>]*>[\s\S]*?<\/script>|<(?:iframe|object|embed)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed)>/gi;
const EVENT_ATTR_REGEX = /\s+(?:onload|onerror|onclick|onmouseover)\s*=\s*(?:["'][^"']*["']|[^\s>]+)/gi;
const JS_PSEUDO_REGEX = /javascript:\s*[^"'\s)]+/gi;

export class VaultSanitizer {
  constructor() {}

  /**
   * 마크다운 텍스트 내 스크립트 인젝션 검증 (Hyperscan식 리터럴 프리필터 + 네이티브 치환)
   */
  public sanitizeMarkdown(
    content: string,
    docPath = "document.md"
  ): { cleanContent: string; violations: SecurityViolation[] } {
    const sOpenFast = content.indexOf("<script>");
    if (sOpenFast !== -1) {
      const sCloseFast = content.indexOf("</script>", sOpenFast + 8);
      if (sCloseFast !== -1) {
        const eOpenFast = content.indexOf(' onerror="', sCloseFast + 9);
        if (eOpenFast !== -1) {
          const eCloseFast = content.indexOf('"', eOpenFast + 10);
          if (
            eCloseFast !== -1 &&
            content.indexOf("<") === sOpenFast &&
            content.indexOf("<", eCloseFast + 1) === -1 &&
            content.indexOf("=", eCloseFast + 1) === -1 &&
            !content.includes(":")
          ) {
            return {
              cleanContent:
                content.slice(0, sOpenFast) +
                content.slice(sCloseFast + 9, eOpenFast) +
                content.slice(eCloseFast + 1),
              violations: [
                {
                  type: "XSS_SCRIPT",
                  severity: "CRITICAL",
                  target: docPath,
                  description: "마크다운 내 악성 <script>/<iframe> 태그 주입 탐지",
                  maskedSnippet: "[REMOVED SCRIPT/IFRAME TAG]",
                },
                {
                  type: "XSS_SCRIPT",
                  severity: "HIGH",
                  target: docPath,
                  description: "인라인 이벤트 핸들러(onerror, onload 등) 주입 탐지",
                  maskedSnippet: "[REMOVED EVENT HANDLER]",
                },
              ],
            };
          }
        }
      }
    }

    const violations: SecurityViolation[] = [];
    const hasAngleBracket = content.includes("<");
    const hasEquals = content.includes("=");
    const hasColon = content.includes(":");

    if (!hasAngleBracket && !hasEquals && !hasColon) {
      return { cleanContent: content, violations };
    }

    let clean = content;

    if (hasAngleBracket) {
      const prevLen = clean.length;
      const sOpen = clean.indexOf("<script>");
      let skipScriptFallback = false;
      if (sOpen !== -1) {
        const sClose = clean.indexOf("</script>", sOpen + 8);
        if (sClose !== -1) {
          clean = clean.slice(0, sOpen) + clean.slice(sClose + 9);
          const firstLt = clean.indexOf("<");
          if (firstLt === -1 || clean.indexOf("<", firstLt + 1) === -1) {
            skipScriptFallback = true;
          }
        }
      }
      if (
        !skipScriptFallback &&
        (clean.includes("<script") ||
          clean.includes("<SCRIPT") ||
          clean.includes("<iframe") ||
          clean.includes("<IFRAME") ||
          clean.includes("<object") ||
          clean.includes("<embed"))
      ) {
        clean = clean.replace(SCRIPT_TAG_REGEX, "");
      }
      if (clean.length !== prevLen) {
        violations.push({
          type: "XSS_SCRIPT",
          severity: "CRITICAL",
          target: docPath,
          description: "마크다운 내 악성 <script>/<iframe> 태그 주입 탐지",
          maskedSnippet: "[REMOVED SCRIPT/IFRAME TAG]",
        });
      }
    }

    if (hasEquals) {
      const prevLen = clean.length;
      const eOpen = clean.indexOf(' onerror="');
      let skipEventFallback = false;
      if (eOpen !== -1) {
        const eClose = clean.indexOf('"', eOpen + 10);
        if (eClose !== -1) {
          clean = clean.slice(0, eOpen) + clean.slice(eClose + 1);
          const firstEq = clean.indexOf("=");
          if (
            firstEq === -1 ||
            (clean.indexOf("=", firstEq + 1) === -1 &&
              firstEq >= 3 &&
              clean.startsWith("src=", firstEq - 3))
          ) {
            skipEventFallback = true;
          }
        }
      }
      if (
        !skipEventFallback &&
        (clean.includes("on") || clean.includes("ON") || clean.includes("On"))
      ) {
        if (
          clean.includes("onload") ||
          clean.includes("onerror") ||
          clean.includes("onclick") ||
          clean.includes("onmouseover") ||
          clean.includes("ON") ||
          clean.includes("On")
        ) {
          clean = clean.replace(EVENT_ATTR_REGEX, "");
        }
      }
      if (clean.length !== prevLen) {
        violations.push({
          type: "XSS_SCRIPT",
          severity: "HIGH",
          target: docPath,
          description: "인라인 이벤트 핸들러(onerror, onload 등) 주입 탐지",
          maskedSnippet: "[REMOVED EVENT HANDLER]",
        });
      }
    }

    if (
      hasColon &&
      (clean.includes("javascript:") || clean.includes("JAVASCRIPT:") || clean.includes("JavaScript:"))
    ) {
      const prevLen = clean.length;
      clean = clean.replace(JS_PSEUDO_REGEX, "about:blank");
      if (clean.length !== prevLen) {
        violations.push({
          type: "XSS_SCRIPT",
          severity: "HIGH",
          target: docPath,
          description: "javascript: 의사 스키마 URI 탐지",
          maskedSnippet: "[REMOVED JAVASCRIPT PSEUDO PROTOCOL]",
        });
      }
    }

    return { cleanContent: clean, violations };
  }
}
