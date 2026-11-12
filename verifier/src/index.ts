/**
 * 시냅스 인과 불변식 자율 무결성 검증기 통합 파사드 (Synapse Verifier Façade)
 */
import { InvariantChecker } from "./invariantChecker";
import { RuntimeVerifier, type GraphSymmetryCheckInput, type GraphSymmetryResult } from "./runtimeVerifier";
import { VerifierReporter } from "./reporter";
import type { InvariantAuditResult, InvariantViolation, VerifierAuditSummary } from "./types";
import type { InvariantRuleDef } from "./config";

export class SynapseVerifier {
  public readonly checker: InvariantChecker;
  public readonly runtime: RuntimeVerifier;
  public readonly reporter: VerifierReporter;

  constructor(customRules: readonly InvariantRuleDef[] = []) {
    this.checker = new InvariantChecker(customRules);
    this.runtime = new RuntimeVerifier();
    this.reporter = new VerifierReporter();
  }

  /**
   * 단일 소스 검사
   */
  public checkSource(content: string, fileName = "source.ts"): InvariantAuditResult {
    return this.checker.checkSource(content, fileName);
  }

  /**
   * 다중 파일 맵 일괄 검증 및 요약 생성
   */
  public verifyFiles(files: Record<string, string>): VerifierAuditSummary {
    const start = performance.now();
    const allViolations: InvariantViolation[] = [];
    let criticalCount = 0;
    let highCount = 0;
    let mediumCount = 0;

    for (const [fileName, content] of Object.entries(files)) {
      const res = this.checker.checkSource(content, fileName);
      for (const v of res.violations) {
        allViolations.push(v);
        if (v.severity === "CRITICAL") criticalCount++;
        else if (v.severity === "HIGH") highCount++;
        else mediumCount++;
      }
    }

    const durationMs = performance.now() - start;

    return {
      ok: allViolations.length === 0,
      totalFilesChecked: Object.keys(files).length,
      totalViolationsCount: allViolations.length,
      criticalCount,
      highCount,
      mediumCount,
      violations: allViolations,
      durationMs,
    };
  }

  /**
   * 그래프 무결성 검증
   */
  public verifyGraphSymmetry(graph: GraphSymmetryCheckInput): GraphSymmetryResult {
    return this.runtime.verifyGraphSymmetry(graph);
  }

  /**
   * 한국어 진단 보고서 생성
   */
  public generateReport(summary: VerifierAuditSummary): string {
    return this.reporter.generateMarkdownReport(summary);
  }

  /**
   * 엄격 무결성 검증 (위반 발견 시 에러 throw)
   */
  public assertIntegrity(files: Record<string, string>): void {
    const summary = this.verifyFiles(files);
    if (!summary.ok) {
      throw new Error(
        `[SynapseVerifier] 인과 불변식 위반 발견 (${summary.totalViolationsCount}건): ${summary.violations[0].ruleName} (${summary.violations[0].targetFile})`
      );
    }
  }
}

export * from "./config";
export * from "./types";
export * from "./invariantChecker";
export * from "./runtimeVerifier";
export * from "./reporter";
