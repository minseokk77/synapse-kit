import { describe, expect, it } from "bun:test";
import { SynapseTracer } from "../index";

describe("⏱️ Synapse-Trace 검증", () => {
  it("1. 턴별 스팬 기록, 타임트래블 리플레이 및 토큰 핫스팟 프로파일", () => {
    const tracer = new SynapseTracer("sess-1");
    tracer.recordSpan({
      turn: 1,
      agentId: "planner",
      toolName: "dci_pull",
      status: "ok",
      inputTokens: 120,
      outputTokens: 40,
      durationMs: 2.1,
      stateSnapshot: { step: "pulled", docs: 5 },
    });
    tracer.recordSpan({
      turn: 2,
      agentId: "worker",
      toolName: "batch_grep",
      status: "ok",
      inputTokens: 300,
      outputTokens: 80,
      durationMs: 1.5,
      stateSnapshot: { step: "grepped", matches: 2 },
    });
    tracer.recordSpan({
      turn: 3,
      agentId: "verifier",
      toolName: "eval_check",
      status: "error",
      inputTokens: 80,
      outputTokens: 20,
      durationMs: 0.9,
      stateSnapshot: { step: "failed" },
      errorMessage: "assert failed",
    });

    const replay2 = tracer.replayAtTurn(2);
    expect(replay2.spansExecuted).toBe(2);
    expect(replay2.mergedState).toEqual({ step: "grepped", docs: 5, matches: 2 });
    expect(replay2.lastStatus).toBe("ok");

    const prof = tracer.profile(2);
    expect(prof.totalTurns).toBe(3);
    expect(prof.errorSpans).toBe(1);
    expect(prof.totalTokens).toBe(640);
    expect(prof.hotspots[0].toolName).toBe("batch_grep");
  });
});
