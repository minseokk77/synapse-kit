/**
 * 인과 불변식 정적 검증기 (Invariant Checker)
 * - npm 금지, 파이썬 금지, console.log 금지 등 개발자 절대 불변식 준수 검사
 */
import { MANDATORY_INVARIANT_RULES, type InvariantRuleDef } from "./config";
import type { InvariantAuditResult, InvariantViolation } from "./types";

export class InvariantChecker {
  private readonly rules: InvariantRuleDef[] = [...MANDATORY_INVARIANT_RULES];
  private combinedRegex: RegExp | null = null;
  private isDefaultRuleSet: boolean;

  constructor(customRules: readonly InvariantRuleDef[] = []) {
    this.isDefaultRuleSet = customRules.length === 0;
    this.rules.push(...customRules);
    if (!this.isDefaultRuleSet) {
      this.rebuildCombinedRegex();
    }
  }

  private rebuildCombinedRegex(): void {
    if (this.rules.length === 0) {
      this.combinedRegex = null;
      return;
    }
    let hasIgnoreCase = false;
    let hasDotAll = false;
    let hasUnicode = false;
    const sources: string[] = [];

    for (let i = 0; i < this.rules.length; i++) {
      const p = this.rules[i].pattern;
      if (p.ignoreCase) hasIgnoreCase = true;
      if (p.dotAll) hasDotAll = true;
      if (p.unicode) hasUnicode = true;
      sources.push(`(?:${p.source})`);
    }

    const flags = `m${hasIgnoreCase ? "i" : ""}${hasDotAll ? "s" : ""}${hasUnicode ? "u" : ""}`;
    this.combinedRegex = new RegExp(sources.join("|"), flags);
  }

  /**
   * 커스텀 인과 규칙 추가
   */
  public addRule(rule: InvariantRuleDef): void {
    this.isDefaultRuleSet = false;
    this.rules.push(rule);
    this.rebuildCombinedRegex();
  }

  private extractTrimmedSnippet(line: string, start: number): string {
    let end = line.length;
    while (end > start) {
      const ch = line.charCodeAt(end - 1);
      if (ch === 32 || ch === 9 || ch === 13) end--;
      else break;
    }
    return start === 0 && end === line.length ? line : line.slice(start, end);
  }

  private checkLine(line: string, lineNum: number, fileName: string, violations: InvariantViolation[]): void {
    const len = line.length;
    let start = 0;
    while (start < len) {
      const ch = line.charCodeAt(start);
      if (ch === 32 || ch === 9 || ch === 13) start++;
      else break;
    }
    if (start === len) return;

    const firstChar = line.charCodeAt(start);
    if (firstChar === 42 /* '*' */) return;
    if (firstChar === 47 /* '/' */ && start + 1 < len && line.charCodeAt(start + 1) === 47) return;

    if (this.isDefaultRuleSet) {
      let snippet: string | null = null;
      for (let rIdx = 0; rIdx < 4; rIdx++) {
        if (rIdx === 0 && !line.includes("npm")) continue;
        if (rIdx === 1 && !line.includes("py")) continue;
        if (rIdx === 2 && !line.includes("console.")) continue;
        if (rIdx === 3 && !line.includes(":4")) continue;
        const rule = this.rules[rIdx];
        if (rule.pattern.test(line)) {
          snippet ??= this.extractTrimmedSnippet(line, start);
          violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            targetFile: fileName,
            line: lineNum,
            snippet,
            severity: rule.severity,
            recommendation: rule.recommendation,
          });
        }
      }
      return;
    }

    let snippet: string | null = null;
    for (let rIdx = 0; rIdx < this.rules.length; rIdx++) {
      const rule = this.rules[rIdx];
      if (rule.pattern.test(line)) {
        snippet ??= this.extractTrimmedSnippet(line, start);
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          targetFile: fileName,
          line: lineNum,
          snippet,
          severity: rule.severity,
          recommendation: rule.recommendation,
        });
      }
    }
  }

  /**
   * 단일 소스 파일 내용을 외부 위반 목록에 직접 누적 검사 (Zero-Alloc)
   */
  public checkSourceInto(content: string, fileName: string, violations: InvariantViolation[]): void {
    if (!content) return;

    if (this.isDefaultRuleSet) {
      if (
        !content.includes("npm") &&
        !content.includes("console.") &&
        !content.includes("py") &&
        !content.includes(":4")
      ) {
        return;
      }
    } else if (!this.combinedRegex || !this.combinedRegex.test(content)) {
      return;
    }

    let lineStart = 0;
    let lineNum = 1;
    const len = content.length;

    while (lineStart <= len) {
      const nlIdx = content.indexOf("\n", lineStart);
      if (nlIdx === -1) {
        this.checkLine(content.slice(lineStart), lineNum, fileName, violations);
        break;
      }
      if (nlIdx > lineStart) {
        this.checkLine(content.slice(lineStart, nlIdx), lineNum, fileName, violations);
      }
      lineStart = nlIdx + 1;
      lineNum++;
    }
  }

  /**
   * 단일 소스 파일 내용 검사 (리터럴 프리필터 + Zero-Split 오프셋 스캐너)
   */
  public checkSource(content: string, fileName = "source.ts"): InvariantAuditResult {
    const violations: InvariantViolation[] = [];
    this.checkSourceInto(content, fileName, violations);
    return {
      ok: violations.length === 0,
      target: fileName,
      violations,
    };
  }
}
