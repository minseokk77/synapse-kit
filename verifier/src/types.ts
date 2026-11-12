/**
 * 시냅스 인과 불변식 검증기 타입 명세 (Synapse Verifier Types)
 */

export interface InvariantViolation {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly targetFile: string;
  readonly line?: number;
  readonly snippet: string;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly recommendation: string;
}

export interface InvariantAuditResult {
  readonly ok: boolean;
  readonly target: string;
  readonly violations: readonly InvariantViolation[];
}

export interface VerifierAuditSummary {
  readonly ok: boolean;
  readonly totalFilesChecked: number;
  readonly totalViolationsCount: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly mediumCount: number;
  readonly violations: readonly InvariantViolation[];
  readonly durationMs: number;
}
