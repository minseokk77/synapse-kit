/**
 * Synapse-Pulse: 0-토큰 로컬 이벤트 필터 & 조건부 자율 AI 트리거 엔진
 * - 평상시 로그/파일/메트릭 감시는 0-토큰 로컬 룰로 처리하고, 임계 조건 충족 시에만 AI 에이전트를 깨움
 */
export const PULSE_CONFIG = {
  MAX_RULES: 512,
  DEFAULT_COOLDOWN_MS: 5000,
} as const;

export interface PulseEvent {
  readonly topic: string;
  readonly severity: "info" | "warn" | "critical";
  readonly payload: string;
  readonly metricValue?: number;
  readonly timestampMs?: number;
}

export interface PulseTriggerRule {
  readonly id: string;
  readonly topic: string;
  readonly minSeverity?: PulseEvent["severity"];
  readonly pattern?: RegExp;
  readonly metricThreshold?: number;
  readonly cooldownMs?: number;
  readonly onTrigger: (ev: PulseEvent) => Promise<void> | void;
}

export interface PulseStats {
  readonly totalEventsEvaluated: number;
  readonly zeroTokenFilteredOut: number;
  readonly aiTriggersFired: number;
  readonly tokenSkipRatio: number;
}

const SEVERITY_RANK: Record<PulseEvent["severity"], number> = {
  info: 1,
  warn: 2,
  critical: 3,
};

export class PulseEngine {
  private readonly rules = new Map<string, PulseTriggerRule>();
  private readonly lastFiredAt = new Map<string, number>();
  private evaluated = 0;
  private filteredOut = 0;
  private fired = 0;

  public registerRule(rule: PulseTriggerRule): void {
    if (this.rules.size >= PULSE_CONFIG.MAX_RULES) {
      throw new Error(`[Synapse-Pulse] 최대 규칙 수(${PULSE_CONFIG.MAX_RULES}) 초과`);
    }
    this.rules.set(rule.id, rule);
  }

  public async ingest(event: PulseEvent): Promise<{ triggeredRuleIds: string[]; skippedZeroToken: boolean }> {
    this.evaluated++;
    const now = event.timestampMs ?? Date.now();
    const triggeredRuleIds: string[] = [];

    for (const rule of this.rules.values()) {
      if (rule.topic !== "*" && rule.topic !== event.topic) continue;
      if (rule.minSeverity && SEVERITY_RANK[event.severity] < SEVERITY_RANK[rule.minSeverity]) continue;
      if (rule.pattern && !rule.pattern.test(event.payload)) continue;
      if (
        rule.metricThreshold !== undefined &&
        (event.metricValue === undefined || event.metricValue < rule.metricThreshold)
      ) {
        continue;
      }

      const cooldown = rule.cooldownMs ?? PULSE_CONFIG.DEFAULT_COOLDOWN_MS;
      const last = this.lastFiredAt.get(rule.id) ?? 0;
      if (last > 0 && now - last < cooldown) continue;

      this.lastFiredAt.set(rule.id, now);
      await rule.onTrigger(event);
      triggeredRuleIds.push(rule.id);
      this.fired++;
    }

    const skippedZeroToken = triggeredRuleIds.length === 0;
    if (skippedZeroToken) this.filteredOut++;

    return { triggeredRuleIds, skippedZeroToken };
  }

  public getStats(): PulseStats {
    return {
      totalEventsEvaluated: this.evaluated,
      zeroTokenFilteredOut: this.filteredOut,
      aiTriggersFired: this.fired,
      tokenSkipRatio:
        this.evaluated === 0 ? 0 : Number((this.filteredOut / this.evaluated).toFixed(4)),
    };
  }
}
