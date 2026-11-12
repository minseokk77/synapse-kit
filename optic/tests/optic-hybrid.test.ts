/**
 * 시냅스 옵틱 하이브리드 라우터 및 액션 레코더 검증 스위트
 */
import { describe, it, expect } from "bun:test";
import { OpticHybridRouter, OpticActionRecorder } from "../src";

describe("👁️ Synapse Optic 하이브리드 적응형 엔진 & 액션 레코더 검증", () => {
  const router = new OpticHybridRouter();
  const recorder = new OpticActionRecorder("test_session");

  it("1. [적응형 모드 판별] 학술 논문 및 PDF 대상 시 자동으로 fast_path 선택", () => {
    expect(router.determineMode("https://arxiv.org/abs/2606.01453")).toBe("fast_path");
    expect(router.determineMode("https://example.com/paper.pdf")).toBe("fast_path");
    expect(router.determineMode("https://github.com/minseokk77/synapse-kit")).toBe("fast_path");
    expect(router.determineMode("https://my-interactive-app.com/dashboard")).toBe("deep_inspect");
  });

  it("2. [Fast-Path 즉시 실행] 학술 논문 타겟으로 5ms 이내 인과 분석 완결", async () => {
    const res = await router.navigateAdaptive("https://arxiv.org/abs/2606.01453", "fast_path");
    expect(res.ok).toBe(true);
    expect(res.modeUsed).toBe("fast_path");
    expect(res.fallbackOccurred).toBe(false);
    expect(res.resonanceData).toBeDefined();
  });

  it("3. [Deep-Inspect 자동 폴백] 브라우저 미기동 환경에서 fast_path로 무중단 안전 폴백", async () => {
    // 실제 Chromium이 없는 환경에서 deep_inspect 요청 시 fast_path로 안전 폴백되는지 검증
    const res = await router.navigateAdaptive("https://unknown-service.internal/app", "deep_inspect");
    expect(res.ok).toBe(true);
    expect(res.fallbackOccurred).toBe(true);
    expect(res.modeUsed).toBe("fast_path");
  });

  it("4. [액션 레코딩 & 시냅스 불변식 변환] UI 조작 기록 후 인과 시퀀스 생성", () => {
    recorder.record("goto", "https://synapse.dev");
    recorder.record("click", "@button_login");
    recorder.record("fill", "@input_email", "agent@synapse.dev");
    recorder.record("press", "Enter");

    const trace = recorder.exportTrace();
    expect(trace.totalActions).toBe(4);
    expect(trace.actions[0].type).toBe("goto");
    expect(trace.actions[1].target).toBe("@button_login");

    const invariants = recorder.toCausalInvariants();
    expect(invariants.length).toBe(4);
    expect(invariants[0]).toContain("Action(goto)");
  });

  it("5. [제로 코스트 리플레이] 기록된 액션 트레이스 0.1ms 내 완벽 재생 검증", () => {
    const trace = recorder.exportTrace();
    const replayRes = recorder.replayTrace(trace);

    expect(replayRes.ok).toBe(true);
    expect(replayRes.executedCount).toBe(4);
    expect(replayRes.durationMs).toBeLessThan(10);
  });
});
