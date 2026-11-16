/**
 * Synapse-Evals: AI 응답 근거 충실도(Groundedness) · 환각 탐지(Hallucination Scorer) · A/B 회귀 평가 엔진
 */

export const EVAL_CONFIG = {
  DEFAULT_PASS_THRESHOLD: 0.75,
  MIN_CLAIM_TOKEN_LEN: 2,
  CHARS_PER_TOKEN: 4,
} as const;

export interface EvalCaseInput {
  readonly id: string;
  readonly query: string;
  readonly expectedKeyFacts: readonly string[];
  readonly evidenceCorpus: readonly string[];
  readonly modelAnswer: string;
  readonly estimatedTokens?: number;
}

export interface EvalCaseScore {
  readonly id: string;
  readonly factRecall: number;
  readonly groundedness: number;
  readonly hallucinationRate: number;
  readonly ungroundedClaims: readonly string[];
  readonly passed: boolean;
  readonly estimatedTokens: number;
}

export interface EvalSuiteReport {
  readonly label: string;
  readonly totalCases: number;
  readonly passedCases: number;
  readonly passRate: number;
  readonly avgFactRecall: number;
  readonly avgGroundedness: number;
  readonly avgHallucinationRate: number;
  readonly totalTokens: number;
  readonly results: readonly EvalCaseScore[];
}

export interface EvalRegressionComparison {
  readonly baselineLabel: string;
  readonly candidateLabel: string;
  readonly passRateDelta: number;
  readonly groundednessDelta: number;
  readonly hallucinationDelta: number;
  readonly tokenSavingsRatio: number;
  readonly improved: boolean;
}

/**
 * 답변 내 문장/주장(Claims)과 수치·코드 식별자가 근거 코퍼스(evidenceCorpus)에 뒷받침되는지 채점
 */
export function scoreEvalCase(
  input: EvalCaseInput,
  passThreshold: number = EVAL_CONFIG.DEFAULT_PASS_THRESHOLD
): EvalCaseScore {
  const answerLower = input.modelAnswer.toLowerCase();
  const evidenceJoined = input.evidenceCorpus.join("\n").toLowerCase();

  // 1. 정답 핵심 사실 회수율 (Fact Recall)
  let matchedFacts = 0;
  for (const fact of input.expectedKeyFacts) {
    if (answerLower.includes(fact.toLowerCase())) matchedFacts++;
  }
  const factRecall =
    input.expectedKeyFacts.length === 0
      ? 1
      : Number((matchedFacts / input.expectedKeyFacts.length).toFixed(4));

  // 2. 근거 충실도 (Groundedness): 답변의 문장별 핵심 수치·식별자·키워드 검증
  const sentences = input.modelAnswer
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);

  const ungroundedClaims: string[] = [];
  let groundedCount = 0;

  for (const sentence of sentences) {
    const tokens = sentence
      .toLowerCase()
      .split(/[^a-z0-9가-힣_=.-]+/)
      .filter((t) => t.length >= EVAL_CONFIG.MIN_CLAIM_TOKEN_LEN);

    // 숫자나 대문자 코드/식별자가 포함된 주장일수록 엄격하게 근거 대조
    const criticalTokens = tokens.filter((t) => /\d|=|_|-/.test(t));
    const checkSet = criticalTokens.length > 0 ? criticalTokens : tokens;

    let hit = 0;
    for (const tok of checkSet) {
      if (evidenceJoined.includes(tok)) hit++;
    }

    const ratio = checkSet.length === 0 ? 1 : hit / checkSet.length;
    if (criticalTokens.length > 0 ? ratio >= 0.8 : ratio >= 0.5) {
      groundedCount++;
    } else {
      ungroundedClaims.push(sentence);
    }
  }

  const groundedness =
    sentences.length === 0 ? 0 : Number((groundedCount / sentences.length).toFixed(4));
  const hallucinationRate = Number((1 - groundedness).toFixed(4));
  const passed = factRecall >= passThreshold && groundedness >= passThreshold;
  const estimatedTokens =
    input.estimatedTokens ?? Math.ceil(input.modelAnswer.length / EVAL_CONFIG.CHARS_PER_TOKEN);

  return {
    id: input.id,
    factRecall,
    groundedness,
    hallucinationRate,
    ungroundedClaims,
    passed,
    estimatedTokens,
  };
}

/**
 * Eval 스위트 전체 실행
 */
export function runEvalSuite(
  label: string,
  cases: readonly EvalCaseInput[],
  passThreshold: number = EVAL_CONFIG.DEFAULT_PASS_THRESHOLD
): EvalSuiteReport {
  if (cases.length === 0) {
    throw new Error("[Synapse-Evals] 평가할 테스트 케이스가 최소 1개 이상 필요합니다.");
  }

  const results = cases.map((c) => scoreEvalCase(c, passThreshold));
  const passedCases = results.filter((r) => r.passed).length;
  const sum = (fn: (r: EvalCaseScore) => number) =>
    results.reduce((acc, r) => acc + fn(r), 0);

  return {
    label,
    totalCases: results.length,
    passedCases,
    passRate: Number((passedCases / results.length).toFixed(4)),
    avgFactRecall: Number((sum((r) => r.factRecall) / results.length).toFixed(4)),
    avgGroundedness: Number((sum((r) => r.groundedness) / results.length).toFixed(4)),
    avgHallucinationRate: Number((sum((r) => r.hallucinationRate) / results.length).toFixed(4)),
    totalTokens: sum((r) => r.estimatedTokens),
    results,
  };
}

/**
 * Baseline vs Candidate A/B 회귀 비교
 */
export function compareEvalRuns(
  baseline: EvalSuiteReport,
  candidate: EvalSuiteReport
): EvalRegressionComparison {
  const passRateDelta = Number((candidate.passRate - baseline.passRate).toFixed(4));
  const groundednessDelta = Number((candidate.avgGroundedness - baseline.avgGroundedness).toFixed(4));
  const hallucinationDelta = Number((candidate.avgHallucinationRate - baseline.avgHallucinationRate).toFixed(4));
  const tokenSavingsRatio = Number(
    ((baseline.totalTokens - candidate.totalTokens) / Math.max(1, baseline.totalTokens)).toFixed(4)
  );

  return {
    baselineLabel: baseline.label,
    candidateLabel: candidate.label,
    passRateDelta,
    groundednessDelta,
    hallucinationDelta,
    tokenSavingsRatio,
    improved: passRateDelta >= 0 && groundednessDelta >= 0,
  };
}
