/**
 * 시냅스 보안 방화벽 타입 명세 (Synapse Guard Types)
 */

export type SecurityViolationType =
  | "EXPOSED_SECRET"
  | "SQL_INJECTION"
  | "XSS_SCRIPT"
  | "UNSAFE_EVAL"
  | "TS_PROTOTYPE_POLLUTION"
  | "TS_TYPE_ERASURE_BYPASS"
  | "TS_REDOS_RISK"
  | "RUST_UNSAFE_BLOCK"
  | "RUST_INT_CAST_WRAP"
  | "RUST_PANIC_RISK"
  | "CPP_BUFFER_OVERFLOW"
  | "CPP_FORMAT_STRING"
  | "SVELTE_RAW_HTML_XSS"
  | "JAVA_INSECURE_DESERIALIZE"
  | "JAVA_JNDI_OR_EXEC"
  | "JAVA_XXE_RISK"
  | "CSHARP_INSECURE_DESERIALIZE"
  | "CSHARP_SQL_INTERPOLATION"
  | "CSHARP_SHELL_EXEC"
  | "GO_UNSAFE_POINTER"
  | "GO_TEMPLATE_XSS"
  | "GO_WEAK_RAND"
  | "PY_INSECURE_DESERIALIZE"
  | "PY_SHELL_OR_EXEC"
  | "PY_ASSERT_SECURITY";

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
