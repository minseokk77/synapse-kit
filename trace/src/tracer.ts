/**
 * Synapse-Trace: AI 에이전트 타임트래블 관측성 · 턴 리플레이 · 토큰 비용 프로파일러
 */
export const TRACE_CONFIG = {
  MAX_SPANS: 10_000,
  DEFAULT_COST_PER_1K_TOKENS_USD: 0.002,
} as const;

export interface TraceSpan {
  readonly spanId: string;
  readonly turn: number;
  readonly agentId: string;
  readonly toolName: string;
  readonly status: "ok" | "error";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly stateSnapshot: Record<string, unknown>;
  readonly timestampMs: number;
  readonly errorMessage?: string;
}

export interface TokenHotspot {
  readonly turn: number;
  readonly toolName: string;
  readonly totalTokens: number;
  readonly durationMs: number;
}

export interface TraceProfileReport {
  readonly sessionId: string;
  readonly totalTurns: number;
  readonly totalSpans: number;
  readonly errorSpans: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
  readonly totalDurationMs: number;
  readonly hotspots: readonly TokenHotspot[];
}

export class SynapseTracer {
  public readonly sessionId: string;
  private readonly spans: TraceSpan[] = [];
  private readonly costPer1kUsd: number;

  constructor(sessionId: string, costPer1kUsd: number = TRACE_CONFIG.DEFAULT_COST_PER_1K_TOKENS_USD) {
    this.sessionId = sessionId;
    this.costPer1kUsd = costPer1kUsd;
  }

  public recordSpan(input: Omit<TraceSpan, "spanId" | "timestampMs">): TraceSpan {
    if (this.spans.length >= TRACE_CONFIG.MAX_SPANS) {
      throw new Error(`[Synapse-Trace] 최대 스팬 수(${TRACE_CONFIG.MAX_SPANS}) 초과`);
    }
    const span: TraceSpan = {
      ...input,
      spanId: `span-${this.spans.length + 1}`,
      timestampMs: Date.now(),
    };
    this.spans.push(span);
    return span;
  }

  /**
   * 특정 턴(Turn)까지의 누적 상태 타임트래블 리플레이
   */
  public replayAtTurn(targetTurn: number): {
    turn: number;
    spansExecuted: number;
    mergedState: Record<string, unknown>;
    lastStatus: "ok" | "error" | "none";
  } {
    const filtered = this.spans.filter((s) => s.turn <= targetTurn);
    const mergedState: Record<string, unknown> = {};
    for (const s of filtered) {
      Object.assign(mergedState, s.stateSnapshot);
    }
    const last = filtered[filtered.length - 1];
    return {
      turn: targetTurn,
      spansExecuted: filtered.length,
      mergedState,
      lastStatus: last ? last.status : "none",
    };
  }

  /**
   * 토큰 및 레이턴시 핫스팟 프로파일 리포트 생성
   */
  public profile(topHotspots: number = 3): TraceProfileReport {
    let totalIn = 0;
    let totalOut = 0;
    let totalMs = 0;
    let errors = 0;
    let maxTurn = 0;

    for (const s of this.spans) {
      totalIn += s.inputTokens;
      totalOut += s.outputTokens;
      totalMs += s.durationMs;
      if (s.status === "error") errors++;
      if (s.turn > maxTurn) maxTurn = s.turn;
    }

    const totalTokens = totalIn + totalOut;
    const hotspots = [...this.spans]
      .map((s) => ({
        turn: s.turn,
        toolName: s.toolName,
        totalTokens: s.inputTokens + s.outputTokens,
        durationMs: s.durationMs,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, topHotspots);

    return {
      sessionId: this.sessionId,
      totalTurns: maxTurn,
      totalSpans: this.spans.length,
      errorSpans: errors,
      totalInputTokens: totalIn,
      totalOutputTokens: totalOut,
      totalTokens,
      estimatedCostUsd: Number(((totalTokens / 1000) * this.costPer1kUsd).toFixed(6)),
      totalDurationMs: Number(totalMs.toFixed(4)),
      hotspots,
    };
  }
}
