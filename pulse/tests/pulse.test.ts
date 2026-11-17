import { describe, expect, it } from "bun:test";
import { PulseEngine } from "../index";

describe("⚡ Synapse-Pulse 검증", () => {
  it("1. 0-토큰 로컬 조건부 필터링으로 불필요한 이벤트 스킵 및 임계 이벤트만 AI 트리거", async () => {
    const pulse = new PulseEngine();
    const firedPayloads: string[] = [];

    pulse.registerRule({
      id: "oom-watch",
      topic: "system.log",
      minSeverity: "critical",
      pattern: /OOM|OutOfMemory/i,
      cooldownMs: 0,
      onTrigger: (ev) => {
        firedPayloads.push(ev.payload);
      },
    });

    for (let i = 0; i < 99; i++) {
      const r = await pulse.ingest({ topic: "system.log", severity: "info", payload: `정상 하트비트 ${i}` });
      expect(r.skippedZeroToken).toBe(true);
    }

    const trig = await pulse.ingest({
      topic: "system.log",
      severity: "critical",
      payload: "Worker crashed: OutOfMemory",
    });
    expect(trig.skippedZeroToken).toBe(false);
    expect(trig.triggeredRuleIds).toEqual(["oom-watch"]);
    expect(firedPayloads.length).toBe(1);
    expect(pulse.getStats().tokenSkipRatio).toBe(0.99);
  });
});
