/**
 * 인과 불변식 정적 검증기 (Invariant Checker)
 * - npm 금지, 파이썬 금지, console.log 금지 등 개발자 절대 불변식 준수 검사
 */
import { MANDATORY_INVARIANT_RULES, type InvariantRuleDef } from "./config";
import type { InvariantAuditResult, InvariantViolation } from "./types";

export class InvariantChecker {
  private readonly rules: InvariantRuleDef[] = [...MANDATORY_INVARIANT_RULES];

  constructor(customRules: readonly InvariantRuleDef[] = []) {
    this.rules.push(...customRules);
  }

  /**
   * 커스텀 인과 규칙 추가
   */
  public addRule(rule: InvariantRuleDef): void {
    this.rules.push(rule);
  }

  /**
   * 단일 소스 파일 내용 검사
   */
  public checkSource(content: string, fileName = "source.ts"): InvariantAuditResult {
    const violations: InvariantViolation[] = [];
    const lines = content.split("\n");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      // 주석 라인은 가볍게 필터링하되 코드 내 인라인 위반 검출
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

      for (const rule of this.rules) {
        if (rule.pattern.test(line)) {
          violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            targetFile: fileName,
            line: lineIdx + 1,
            snippet: line.trim(),
            severity: rule.severity,
            recommendation: rule.recommendation,
          });
        }
      }
    }

    return {
      ok: violations.length === 0,
      target: fileName,
      violations,
    };
  }
}
