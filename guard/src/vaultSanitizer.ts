/**
 * 마크다운 볼트 보안 검증 및 새니타이저 (Vault Sanitizer)
 * - Frontmatter 및 본문 내 악성 태그(<script>, javascript:, onload=) 주입 차단
 */
import type { SecurityViolation } from "./types";

export class VaultSanitizer {
  constructor() {}

  /**
   * 마크다운 텍스트 내 스크립트 인젝션 검증
   */
  public sanitizeMarkdown(
    content: string,
    docPath = "document.md"
  ): { cleanContent: string; violations: SecurityViolation[] } {
    const violations: SecurityViolation[] = [];
    let clean = content;

    const scriptTagRegex = /<(?:script|iframe|object|embed)\b[^<]*(?:(?!<\/(?:script|iframe|object|embed)>)<[^<]*)*<\/(?:script|iframe|object|embed)>/gi;
    if (scriptTagRegex.test(content)) {
      violations.push({
        type: "XSS_SCRIPT",
        severity: "CRITICAL",
        target: docPath,
        description: "마크다운 내 악성 <script>/<iframe> 태그 주입 탐지",
        maskedSnippet: "[REMOVED SCRIPT/IFRAME TAG]",
      });
      clean = clean.replace(scriptTagRegex, "");
    }

    const eventAttrRegex = /\s+(?:onload|onerror|onclick|onmouseover)\s*=\s*(?:["'][^"']*["']|[^\s>]+)/gi;
    if (eventAttrRegex.test(clean)) {
      violations.push({
        type: "XSS_SCRIPT",
        severity: "HIGH",
        target: docPath,
        description: "인라인 이벤트 핸들러(onerror, onload 등) 주입 탐지",
        maskedSnippet: "[REMOVED EVENT HANDLER]",
      });
      clean = clean.replace(eventAttrRegex, "");
    }

    const jsPseudoRegex = /javascript:\s*[^"'\s)]+/gi;
    if (jsPseudoRegex.test(clean)) {
      violations.push({
        type: "XSS_SCRIPT",
        severity: "HIGH",
        target: docPath,
        description: "javascript: 의사 스키마 URI 탐지",
        maskedSnippet: "[REMOVED JAVASCRIPT PSEUDO PROTOCOL]",
      });
      clean = clean.replace(jsPseudoRegex, "about:blank");
    }

    return { cleanContent: clean, violations };
  }
}
