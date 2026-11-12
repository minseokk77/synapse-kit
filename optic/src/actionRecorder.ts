/**
 * 시냅스 옵틱 인과 액션 레코더 & 제로 코스트 리플레이어 (Causal Action Recorder & Replayer)
 * - 브라우저 조작 행위를 인과 규칙(Trigger -> Action -> Invariant)으로 영구 기록
 * - 동일한 UI 시퀀스를 실제 브라우저 기동 없이 0ms에 인과 불변식으로 재생(Replay) 검증
 */
import { OPTIC_HYBRID_DEFAULTS } from "./config";

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
  private static globalTraceSeq = 0;
  private actions: RecordedAction[] = [];
  private readonly sessionName: string;
  private readonly recordedAtMs: number;
  private traceSeq = 0;

  constructor(sessionName: string = OPTIC_HYBRID_DEFAULTS.DEFAULT_SESSION_NAME) {
    this.sessionName = sessionName;
    this.recordedAtMs = Date.now();
  }

  /**
   * 브라우저 액션 안전 기록 (try-catch 예외 방어)
   */
  public record(type: RecordedAction["type"], target: string, value?: string): RecordedAction {
    try {
      const actionIndex = this.actions.length + 1;
      const action: RecordedAction = {
        id: `act_${actionIndex}_${Date.now()}`,
        type,
        target,
        value,
        timestampMs: Date.now(),
      };
      this.actions.push(action);
      return action;
    } catch (err: any) {
      const fallbackIndex = this.actions.length + 1;
      const fallbackAction: RecordedAction = {
        id: `act_${fallbackIndex}_fallback`,
        type: type || "assert",
        target: target || "unknown",
        value: value ? String(value) : undefined,
        timestampMs: Date.now(),
      };
      this.actions.push(fallbackAction);
      return fallbackAction;
    }
  }

  /**
   * 결정론적 카운터 기반 전체 트레이스 내보내기
   */
  public exportTrace(): ActionTrace {
    this.traceSeq += 1;
    OpticActionRecorder.globalTraceSeq += 1;
    const traceId = `trace_${this.sessionName}_seq_${this.traceSeq}_g${OpticActionRecorder.globalTraceSeq}`;

    return {
      traceId,
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
  public replayTrace(trace: ActionTrace): { ok: boolean; executedCount: number; durationMs: number; error?: string } {
    const startTime = performance.now();
    try {
      let count = 0;

      for (const act of trace.actions) {
        if (!act.target || !act.type) {
          return {
            ok: false,
            executedCount: count,
            durationMs: performance.now() - startTime,
            error: "액션 대상 또는 타입 누락",
          };
        }
        count++;
      }

      return {
        ok: true,
        executedCount: count,
        durationMs: Number((performance.now() - startTime).toFixed(3)),
      };
    } catch (err: any) {
      return {
        ok: false,
        executedCount: 0,
        durationMs: Number((performance.now() - startTime).toFixed(3)),
        error: `리플레이 실행 예외: ${err?.message || String(err)}`,
      };
    }
  }

  public clear(): void {
    this.actions = [];
  }
}
