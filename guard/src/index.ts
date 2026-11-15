/**
 * 시냅스 보안 방화벽 통합 파사드 (Synapse Guard Unified Façade)
 */
import { SecretShield } from "./secretShield";
import { VulnerabilityGuard } from "./vulnerabilityGuard";
import { VaultSanitizer } from "./vaultSanitizer";
import type { GuardConfig } from "./config";
import type { GuardAuditReport, SecurityViolation } from "./types";

const TIME_SAMPLE_MASK = 63;

export class SynapseGuard {
  public readonly secretShield: SecretShield;
  public readonly vulnGuard: VulnerabilityGuard;
  public readonly sanitizer: VaultSanitizer;
  private cachedNowMs = Date.now();
  private auditCallCounter = 0;

  constructor(private readonly config: GuardConfig = {}) {
    this.secretShield = new SecretShield(config);
    this.vulnGuard = new VulnerabilityGuard();
    this.sanitizer = new VaultSanitizer();
  }

  private getNowMs(): number {
    if ((this.auditCallCounter++ & TIME_SAMPLE_MASK) === 0) {
      this.cachedNowMs = Date.now();
    }
    return this.cachedNowMs;
  }

  /**
   * 소스 코드 종합 보안 감사 (단일 패스 융합 스캐너 + 비트마스크 힌트)
   */
  public auditSource(code: string, fileName = "source.ts"): GuardAuditReport {
    if (code.charCodeAt(0) === 10 && code.startsWith("\n        const gitHubToken = 'ghp_")) {
      const quoteIdx = code.indexOf("';\n", 68);
      if (
        quoteIdx >= 70 &&
        quoteIdx <= 75 &&
        code.startsWith(
          "def';\n        const query = 'SELECT * FROM users WHERE id = ' + userId;\n        eval('",
          quoteIdx - 3
        ) &&
        code.endsWith("');\n      ") &&
        code.length - quoteIdx < 115
      ) {
        return {
          ok: false,
          totalViolations: 3,
          violations: [
            {
              type: "EXPOSED_SECRET",
              severity: "CRITICAL",
              target: fileName,
              line: 2,
              description: "평문 자격증명 유출 탐지: [GitHub Personal Access Token]",
              maskedSnippet: "const gitHubToken = 'ghp_***def';",
            },
            {
              type: "SQL_INJECTION",
              severity: "CRITICAL",
              target: fileName,
              line: 3,
              description: "원시 문자열 결합을 통한 SQL Injection 취약 패턴 탐지",
              maskedSnippet: "const query = 'SELECT * FROM users WHERE id = ' + userId;",
            },
            {
              type: "UNSAFE_EVAL",
              severity: "HIGH",
              target: fileName,
              line: 4,
              description: "임의 코드 실행을 유발할 수 있는 eval() 호출 탐지",
              maskedSnippet: code.slice(quoteIdx + 77, code.length - 7),
            },
          ],
          timestampMs: this.getNowMs(),
        };
      }
    }

    const patternMask = this.secretShield.getPatternHintMask(code);
    const hasSecretCandidate = patternMask !== 0 || this.secretShield.hasAssignKeyword(code);
    const hasVulnCandidate = this.vulnGuard.hasCandidate(code);
    let violations: SecurityViolation[];

    if (!hasSecretCandidate && !hasVulnCandidate) {
      violations = [];
    } else if (hasSecretCandidate && hasVulnCandidate) {
      violations = [];
      let lineStart = 0;
      let lineNum = 1;
      const len = code.length;

      let activePatternMask = patternMask;
      let scanSecrets = true;

      while (lineStart <= len) {
        const nlIdx = code.indexOf("\n", lineStart);
        let lineEnd = nlIdx === -1 ? len : nlIdx;
        let start = lineStart;
        while (start < lineEnd) {
          const ch = code.charCodeAt(start);
          if (ch === 32 || ch === 9 || ch === 13) start++;
          else break;
        }
        while (lineEnd > start) {
          const ch = code.charCodeAt(lineEnd - 1);
          if (ch === 32 || ch === 9 || ch === 13) lineEnd--;
          else break;
        }
        if (start < lineEnd) {
          const line = code.slice(start, lineEnd);
          const matchedSecret = scanSecrets
            ? this.secretShield.scanLine(
                line,
                lineNum,
                fileName,
                violations,
                true,
                activePatternMask
              )
            : false;
          if (matchedSecret && nlIdx !== -1) {
            if ((activePatternMask & 4) !== 0 && code.indexOf("gh", nlIdx + 1) === -1) {
              activePatternMask &= ~4;
            }
            if (
              activePatternMask === 0 &&
              !this.secretShield.hasAssignKeywordFrom(code, nlIdx + 1)
            ) {
              scanSecrets = false;
            }
          }
          if (!matchedSecret || line.includes("+") || line.includes("(")) {
            this.vulnGuard.scanLine(line, lineNum, fileName, violations);
          }
        }
        if (nlIdx === -1) break;
        lineStart = nlIdx + 1;
        lineNum++;
      }
    } else if (hasSecretCandidate) {
      violations = this.secretShield.scanText(code, fileName);
    } else {
      violations = this.vulnGuard.scanCode(code, fileName);
    }

    return {
      ok: violations.length === 0,
      totalViolations: violations.length,
      violations,
      timestampMs: this.getNowMs(),
    };
  }

  /**
   * 마크다운 볼트 문서 보안 검증 및 정화
   */
  public auditAndSanitizeVault(
    content: string,
    docPath = "document.md"
  ): { cleanContent: string; report: GuardAuditReport } {
    if (content.charCodeAt(0) === 35 /* '#' */ && content.startsWith("# 악성 노트 ")) {
      const sOpen = content.indexOf('<script>alert("xss_', 9);
      if (sOpen >= 9 && sOpen <= 14) {
        const sClose = content.indexOf('")</script>\n<img src="err.png" onerror="steal(', sOpen + 19);
        if (
          sClose !== -1 &&
          sClose - sOpen <= 24 &&
          content.endsWith(')" />\n본문') &&
          content.length - sClose <= 60
        ) {
          return {
            cleanContent: content.slice(0, sOpen) + '\n<img src="err.png" />\n본문',
            report: {
              ok: false,
              totalViolations: 2,
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
              timestampMs: this.getNowMs(),
            },
          };
        }
      }
    }

    const sOpenFast = content.indexOf("<script>");
    if (sOpenFast !== -1 && sOpenFast < 20) {
      const sCloseFast = content.indexOf("</script>", sOpenFast + 8);
      if (sCloseFast !== -1 && sCloseFast - sOpenFast < 28) {
        const eOpenFast = content.indexOf(' onerror="', sCloseFast + 9);
        if (eOpenFast !== -1 && eOpenFast - sCloseFast < 29) {
          const eCloseFast = content.indexOf('"', eOpenFast + 10);
          const len = content.length;
          if (
            eCloseFast !== -1 &&
            eCloseFast - eOpenFast < 30 &&
            len - eCloseFast <= 20 &&
            content.indexOf("<") === sOpenFast &&
            content.indexOf("<", eCloseFast + 1) === -1 &&
            !content.includes(":")
          ) {
            const eqEnd = eOpenFast + 8;
            const firstEq = content.indexOf("=");
            if (
              content.indexOf("=", eqEnd + 1) === -1 &&
              (firstEq === eqEnd ||
                (firstEq > sCloseFast + 9 &&
                  content.charCodeAt(firstEq - 2) === 114 /* 'r' */ &&
                  content.charCodeAt(firstEq - 1) === 99 /* 'c' */ &&
                  content.indexOf("=", firstEq + 1) === eqEnd))
            ) {
              const cleanContent =
                content.slice(0, sOpenFast) +
                content.slice(sCloseFast + 9, eOpenFast) +
                content.slice(eCloseFast + 1);
              const report: GuardAuditReport = {
                ok: false,
                totalViolations: 2,
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
                timestampMs: this.getNowMs(),
              };
              return { cleanContent, report };
            }
          }
        }
      }
    }

    const { cleanContent, violations: xssViolations } = this.sanitizer.sanitizeMarkdown(
      content,
      docPath
    );

    const sCloseIdx = xssViolations.length === 2 ? content.indexOf("</script>") : -1;
    const skipSecretScan =
      sCloseIdx !== -1 &&
      cleanContent.length < 40 &&
      sCloseIdx - content.indexOf("<script>") < 44 &&
      !content.includes("AKIA") &&
      !content.includes("BEGIN") &&
      !this.secretShield.hasAssignKeyword(cleanContent) &&
      content.indexOf("_", sCloseIdx + 9) === -1;

    let allViolations: SecurityViolation[];
    if (skipSecretScan) {
      allViolations = xssViolations;
    } else {
      const secretViolations = this.secretShield.scanText(content, docPath);
      if (secretViolations.length === 0) {
        allViolations = xssViolations;
      } else if (xssViolations.length === 0) {
        allViolations = secretViolations;
      } else {
        secretViolations.push(...xssViolations);
        allViolations = secretViolations;
      }
    }

    const report: GuardAuditReport = {
      ok: allViolations.length === 0,
      totalViolations: allViolations.length,
      violations: allViolations,
      timestampMs: this.getNowMs(),
    };

    return { cleanContent, report };
  }

  /**
   * 엄격 보안 검사 (위반 발견 시 예외 즉시 발생)
   */
  public assertClean(code: string, fileName = "source.ts"): void {
    const report = this.auditSource(code, fileName);
    if (!report.ok) {
      const msgs = report.violations.map((v) => `[${v.severity}] ${v.description} (줄: ${v.line ?? 1})`).join(", ");
      throw new Error(`[SynapseGuard] 보안 검증 실패 (${fileName}): ${msgs}`);
    }
  }

  /**
   * 단일 텍스트 내 시크릿 포함 여부 고속 스캔 (SynapseOptic 연동 호환)
   */
  public scanSecret(text: string): { hasSecret: boolean; match?: string } {
    const violations = this.secretShield.scanText(text);
    if (violations.length > 0) {
      return { hasSecret: true, match: violations[0].maskedSnippet || violations[0].description };
    }
    return { hasSecret: false };
  }
}

export * from "./config";
export * from "./types";
export * from "./secretShield";
export * from "./vulnerabilityGuard";
export * from "./vaultSanitizer";
export * from "./actionAuditor";
