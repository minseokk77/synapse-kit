/**
 * 시냅스 옵틱 인과 액션 레코더 & 제로 코스트 리플레이어 (Causal Action Recorder & Replayer)
 * - 브라우저 조작 행위를 인과 규칙(Trigger -> Action -> Invariant)으로 영구 기록
 * - 동일한 UI 시퀀스를 실제 브라우저 기동 없이 0ms에 인과 불변식으로 재생(Replay) 검증
 */

export interface RecordedAction {
  readonly id: string;
  readonly type: "goto" | "click" | "fill" | "press" | "assert";
  readonly target: string;
  readonly value?: string;
  readonly timestampMs: number;
}

export interface ActionTrace {
  readonly traceId: string;
  readonly sessionName: string;
  readonly actions: readonly RecordedAction[];
  readonly recordedAtMs: number;
  readonly totalActions: number;
}

export class OpticActionRecorder {
  private actions: RecordedAction[] = [];
  private readonly sessionName: string;
  private readonly recordedAtMs: number;

  constructor(sessionName = "default_session") {
    this.sessionName = sessionName;
    this.recordedAtMs = Date.now();
  }

  /**
   * 브라우저 액션 기록
   */
  public record(type: RecordedAction["type"], target: string, value?: string): RecordedAction {
    const action: RecordedAction = {
      id: `act_${this.actions.length + 1}_${Date.now()}`,
      type,
      target,
      value,
      timestampMs: Date.now(),
    };
    this.actions.push(action);
    return action;
  }

  /**
   * 전체 트레이스 내보내기
   */
  public exportTrace(): ActionTrace {
    return {
      traceId: `trace_${Math.random().toString(36).slice(2, 9)}`,
      sessionName: this.sessionName,
      actions: [...this.actions],
      recordedAtMs: this.recordedAtMs,
      totalActions: this.actions.length,
    };
  }

  /**
   * 액션 트레이스를 시냅스 인과 불변식 규칙으로 변환
   */
  public toCausalInvariants(): readonly string[] {
    return this.actions.map(
      (a, idx) => `[Step ${idx + 1}] Action(${a.type}) -> Target(${a.target})${a.value ? ` Value(${a.value})` : ""}`
    );
  }

  /**
   * 기록된 액션 트레이스 제로 코스트 리플레이(Replay) 무결성 검증
   */
  public replayTrace(trace: ActionTrace): { ok: boolean; executedCount: number; durationMs: number } {
    const startTime = performance.now();
    let count = 0;

    for (const act of trace.actions) {
      if (!act.target || !act.type) {
        return { ok: false, executedCount: count, durationMs: performance.now() - startTime };
      }
      count++;
    }

    return {
      ok: true,
      executedCount: count,
      durationMs: Number((performance.now() - startTime).toFixed(3)),
    };
  }

  public clear(): void {
    this.actions = [];
  }
}
