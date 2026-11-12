/**
 * 시냅스 보안 방화벽 통합 파사드 (Synapse Guard Unified Façade)
 */
import { SecretShield } from "./secretShield";
import { VulnerabilityGuard } from "./vulnerabilityGuard";
import { VaultSanitizer } from "./vaultSanitizer";
import type { GuardConfig } from "./config";
import type { GuardAuditReport, SecurityViolation } from "./types";

export class SynapseGuard {
  public readonly secretShield: SecretShield;
  public readonly vulnGuard: VulnerabilityGuard;
  public readonly sanitizer: VaultSanitizer;

  constructor(private readonly config: GuardConfig = {}) {
    this.secretShield = new SecretShield(config);
    this.vulnGuard = new VulnerabilityGuard();
    this.sanitizer = new VaultSanitizer();
  }

  /**
   * 소스 코드 종합 보안 감사
   */
  public auditSource(code: string, fileName = "source.ts"): GuardAuditReport {
    const violations: SecurityViolation[] = [
      ...this.secretShield.scanText(code, fileName),
      ...this.vulnGuard.scanCode(code, fileName),
    ];

    return {
      ok: violations.length === 0,
      totalViolations: violations.length,
      violations,
      timestampMs: Date.now(),
    };
  }

  /**
   * 마크다운 볼트 문서 보안 검증 및 정화
   */
  public auditAndSanitizeVault(
    content: string,
    docPath = "document.md"
  ): { cleanContent: string; report: GuardAuditReport } {
    const secretViolations = this.secretShield.scanText(content, docPath);
    const { cleanContent, violations: xssViolations } = this.sanitizer.sanitizeMarkdown(
      content,
      docPath
    );

    const allViolations = [...secretViolations, ...xssViolations];
    const report: GuardAuditReport = {
      ok: allViolations.length === 0,
      totalViolations: allViolations.length,
      violations: allViolations,
      timestampMs: Date.now(),
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
}

export * from "./config";
export * from "./types";
export * from "./secretShield";
export * from "./vulnerabilityGuard";
export * from "./vaultSanitizer";
