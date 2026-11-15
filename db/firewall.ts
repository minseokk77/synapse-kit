/**
 * 시냅스 DB 정확성 방화벽 (Correctness Firewall & Round-Trip Equivalence Guard)
 * - arXiv:2611.05173 (Correctness Firewalls for Synthesized Database Components)
 * - arXiv:2611.02779 (GenDB-V Formally Verified Index Equivalence)
 */

export const DB_FIREWALL_CONFIG = {
  DEFAULT_LABEL: "fast-path",
} as const;

export interface CorrectnessFirewallOutcome<T> {
  readonly value: T;
  readonly usedFallback: boolean;
  readonly reason?: string;
  readonly durationMs: number;
}

/**
 * 초고속 Fast-Path 실행 후 불변식 검증 실패 또는 예외 발생 시 0ms 안전 경로로 무손실 폴백
 */
export function withCorrectnessFirewall<T>(
  fastPath: () => T,
  safeFallback: () => T,
  invariantCheck: (candidate: T) => boolean,
  label: string = DB_FIREWALL_CONFIG.DEFAULT_LABEL
): CorrectnessFirewallOutcome<T> {
  const start = performance.now();
  try {
    const candidate = fastPath();
    if (invariantCheck(candidate)) {
      return {
        value: candidate,
        usedFallback: false,
        durationMs: Number((performance.now() - start).toFixed(4)),
      };
    }
    const fallbackValue = safeFallback();
    return {
      value: fallbackValue,
      usedFallback: true,
      reason: `[CorrectnessFirewall:${label}] 불변식 검증 실패로 안전 경로 폴백`,
      durationMs: Number((performance.now() - start).toFixed(4)),
    };
  } catch (err: any) {
    const fallbackValue = safeFallback();
    return {
      value: fallbackValue,
      usedFallback: true,
      reason: `[CorrectnessFirewall:${label}] Fast-Path 예외로 안전 경로 폴백: ${err?.message || err}`,
      durationMs: Number((performance.now() - start).toFixed(4)),
    };
  }
}

/**
 * 두 쿼리/인덱스 결과 집합의 동치성(Equivalence) 검증
 */
export function verifyIndexEquivalence<T>(
  fastIds: readonly T[],
  baselineIds: readonly T[]
): { equivalent: boolean; missingCount: number; extraCount: number } {
  const fastSet = new Set(fastIds);
  const baseSet = new Set(baselineIds);

  let missingCount = 0;
  for (const item of baseSet) {
    if (!fastSet.has(item)) missingCount++;
  }
  let extraCount = 0;
  for (const item of fastSet) {
    if (!baseSet.has(item)) extraCount++;
  }

  return {
    equivalent: missingCount === 0 && extraCount === 0,
    missingCount,
    extraCount,
  };
}
