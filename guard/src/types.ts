/**
 * 시냅스 보안 방화벽 타입 명세 (Synapse Guard Types)
 */

export type SecurityViolationType =
  | "EXPOSED_SECRET"
  | "SQL_INJECTION"
  | "XSS_SCRIPT"
  | "UNSAFE_EVAL";

export type SecuritySeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface SecurityViolation {
  readonly type: SecurityViolationType;
  readonly severity: SecuritySeverity;
  readonly target: string;
  readonly line?: number;
  readonly description: string;
  readonly maskedSnippet: string;
}

export interface GuardAuditReport {
  readonly ok: boolean;
  readonly totalViolations: number;
  readonly violations: readonly SecurityViolation[];
  readonly timestampMs: number;
}
