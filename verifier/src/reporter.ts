/**
 * 한국어 무결성 진단 보고서 생성기 (Verifier Reporter)
 */
import type { VerifierAuditSummary } from "./types";

export class VerifierReporter {
  constructor() {}

  /**
   * 감사 요약 데이터를 구조화된 한국어 마크다운 보고서로 포맷
   */
  public generateMarkdownReport(summary: VerifierAuditSummary): string {
    const lines: string[] = [
      "# 🛡️ Synapse 인과 불변식 및 코드 무결성 검증 보고서",
      "",
      `> **검증 상태**: ${summary.ok ? "✅ 100% 무결성 통과 (PASSED)" : "❌ 위반 사항 발견 (FAILED)"}`,
      `> **검사 파일 수**: ${summary.totalFilesChecked}개 | **총 소요 시간**: ${summary.durationMs.toFixed(2)}ms`,
      `> **위반 합계**: ${summary.totalViolationsCount}건 (치명: ${summary.criticalCount}, 높음: ${summary.highCount}, 보통: ${summary.mediumCount})`,
      "",
      "---",
      "",
      "## 📊 세부 위반 내역",
      "",
    ];

    if (summary.violations.length === 0) {
      lines.push("🎉 모든 인과 불변 규칙(Invariants)을 준수하고 있습니다. 위반 사항이 없습니다.");
    } else {
      lines.push("| 파일 | 라인 | 규칙 명 (ID) | 심각도 | 권장 조치 |");
      lines.push("| :--- | :---: | :--- | :---: | :--- |");
      for (const v of summary.violations) {
        lines.push(
          `| \`${v.targetFile}\` | ${v.line ?? "-"} | ${v.ruleName} (\`${v.ruleId}\`) | **${v.severity}** | ${v.recommendation} |`
        );
      }
    }

    lines.push("");
    return lines.join("\n");
  }
}
