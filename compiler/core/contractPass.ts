/**
 * 시냅스 검증 인지형 컴파일 계약 패스 (Verification-Aware Compilation Contract Pass)
 * - arXiv:2609.34619 (Executable Multi-Agent Specifications & Verification-Aware Compilation)
 */

export const CONTRACT_PASS_CONFIG = {
  MAX_ALLOWABLE_POSTCONDITION_EMPTY: false,
} as const;

export interface AgentToolContract {
  readonly toolName: string;
  readonly preconditions: readonly string[];
  readonly postconditions: readonly string[];
  readonly idempotent: boolean;
  readonly requiresGuardAudit?: boolean;
}

export interface ContractPassViolation {
  readonly toolName: string;
  readonly code: "EMPTY_PRECONDITION" | "EMPTY_POSTCONDITION" | "UNPROTECTED_SIDE_EFFECT";
  readonly message: string;
}

export interface ContractPassResult {
  readonly ok: boolean;
  readonly checkedCount: number;
  readonly violations: readonly ContractPassViolation[];
  readonly durationMs: number;
}

/**
 * 컴파일 단계에서 다중 에이전트 도구 계약(사전/사후 조건 및 부작용 가드) 정적 검증
 */
export function verifyAgentContracts(
  contracts: readonly AgentToolContract[]
): ContractPassResult {
  const start = performance.now();
  const violations: ContractPassViolation[] = [];

  for (const contract of contracts) {
    if (!contract.preconditions || contract.preconditions.length === 0) {
      violations.push({
        toolName: contract.toolName,
        code: "EMPTY_PRECONDITION",
        message: `도구 '${contract.toolName}'의 사전 조건(preconditions)이 명시되지 않았습니다.`,
      });
    }
    if (
      !CONTRACT_PASS_CONFIG.MAX_ALLOWABLE_POSTCONDITION_EMPTY &&
      (!contract.postconditions || contract.postconditions.length === 0)
    ) {
      violations.push({
        toolName: contract.toolName,
        code: "EMPTY_POSTCONDITION",
        message: `도구 '${contract.toolName}'의 사후 조건(postconditions)이 명시되지 않았습니다.`,
      });
    }
    if (!contract.idempotent && !contract.requiresGuardAudit) {
      violations.push({
        toolName: contract.toolName,
        code: "UNPROTECTED_SIDE_EFFECT",
        message: `비멱등(non-idempotent) 도구 '${contract.toolName}'는 requiresGuardAudit: true 선언이 필수입니다.`,
      });
    }
  }

  return {
    ok: violations.length === 0,
    checkedCount: contracts.length,
    violations,
    durationMs: Number((performance.now() - start).toFixed(3)),
  };
}
