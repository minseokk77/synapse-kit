/**
 * 시냅스 정형 시제 논리 런타임 모니터 (Formal Temporal Policy Monitor)
 * - arXiv:2610.09793 (Formal Runtime Verification for Tool-Using LLM Agents)
 */

export const TEMPORAL_MONITOR_CONFIG = {
  /** 기본 전이 이력 최대 보관 개수 */
  MAX_TRACE_HISTORY: 2048,
} as const;

export interface TemporalPolicyRule {
  /** 정책 ID */
  readonly id: string;
  /** 선행 검증이 필요한 보호 대상 액션/도구명 목록 */
  readonly protectedActions: readonly string[];
  /** 사전에 반드시 통과해야 하는 선행 액션/도구명 목록 (OR 조건) */
  readonly requiresPriorAnyOf: readonly string[];
  /** 위반 시 설명 메시지 */
  readonly description: string;
}

export interface TemporalTransitionCheck {
  readonly allowed: boolean;
  readonly action: string;
  readonly violatedPolicyId?: string;
  readonly reason: string;
}

/**
 * 도구 호출 시퀀스의 선행-후행 인과 순서(Temporal Ordering)를 0ms로 검증하는 상태 머신 모니터
 */
export class TemporalPolicyMonitor {
  private readonly policies: TemporalPolicyRule[] = [];
  private readonly history: string[] = [];
  private readonly completedActions = new Set<string>();

  constructor(initialPolicies: readonly TemporalPolicyRule[] = []) {
    for (const p of initialPolicies) {
      this.policies.push(p);
    }
  }

  /**
   * 정책 규칙 동적 추가 (OCP)
   */
  public addPolicy(policy: TemporalPolicyRule): void {
    this.policies.push(policy);
  }

  /**
   * 액션 실행 직전 시제 정책 준수 여부 검증 (위반 시 상태 미전이)
   */
  public checkTransition(nextAction: string): TemporalTransitionCheck {
    const cleanAction = nextAction.trim();
    for (const policy of this.policies) {
      if (!policy.protectedActions.includes(cleanAction)) continue;

      const satisfied = policy.requiresPriorAnyOf.some((req) =>
        this.completedActions.has(req)
      );
      if (!satisfied) {
        return {
          allowed: false,
          action: cleanAction,
          violatedPolicyId: policy.id,
          reason: `[TemporalPolicy:${policy.id}] '${cleanAction}' 실행 전 선행 작업(${policy.requiresPriorAnyOf.join(" 또는 ")})이 완료되지 않았습니다: ${policy.description}`,
        };
      }
    }

    return {
      allowed: true,
      action: cleanAction,
      reason: `시제 정책 통과 ('${cleanAction}')`,
    };
  }

  /**
   * 검증 통과 후 액션 실행 이력 기록
   */
  public recordTransition(action: string): TemporalTransitionCheck {
    const check = this.checkTransition(action);
    if (!check.allowed) {
      return check;
    }

    const cleanAction = action.trim();
    this.completedActions.add(cleanAction);
    this.history.push(cleanAction);
    if (this.history.length > TEMPORAL_MONITOR_CONFIG.MAX_TRACE_HISTORY) {
      this.history.shift();
    }
    return check;
  }

  /**
   * 실행 트레이스 및 완료 집합 초기화
   */
  public reset(): void {
    this.history.length = 0;
    this.completedActions.clear();
  }

  /**
   * 현재 기록된 액션 시퀀스 반환
   */
  public getTrace(): readonly string[] {
    return this.history;
  }
}
