/**
 * 자가치유 프로세스 슈퍼바이저 코어 (Process Supervisor Core)
 * - 하위 프로세스 생명주기 관리, 자동 복구, 크래시 감지 및 지수 백오프
 * - OS 시그널 감지 시 데이터베이스 무손실 플러시 가드 (Zero-Loss Flush Guard)
 */
import { spawn, type Subprocess } from "bun";
import { RUNNER_DEFAULTS, type ProcessSpec, type RunnerConfig } from "./config";
import type { ProcessState, ProcessStatus, RunnerStats, CrashHarvestRecord } from "./types";

export class ProcessSupervisor {
  private readonly states = new Map<string, ProcessState>();
  private readonly subprocesses = new Map<string, Subprocess>();
  private readonly stderrBuffers = new Map<string, string[]>();
  private readonly restartTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private totalRestartsTriggered = 0;
  private isShuttingDown = false;

  constructor(
    private readonly config: RunnerConfig = {},
    private readonly onCrashHarvest?: (record: CrashHarvestRecord) => void
  ) {
    if (config.processes) {
      for (const spec of config.processes) {
        this.registerProcess(spec);
      }
    }

    this.registerSignalHandlers();
  }

  /**
   * 프로세스 사양 등록
   */
  public registerProcess(spec: ProcessSpec): void {
    if (this.states.has(spec.id)) {
      throw new Error(`[ProcessSupervisor] 이미 등록된 프로세스 ID입니다: ${spec.id}`);
    }

    this.states.set(spec.id, {
      spec,
      status: "STOPPED",
      pid: null,
      startedAtMs: null,
      restartCount: 0,
      lastCrashError: null,
      lastExitCode: null,
    });
    this.stderrBuffers.set(spec.id, []);
  }

  /**
   * 단일 프로세스 기동
   */
  public startProcess(id: string): boolean {
    if (this.isShuttingDown) return false;
    const state = this.states.get(id);
    if (!state) {
      throw new Error(`[ProcessSupervisor] 존재하지 않는 프로세스입니다: ${id}`);
    }

    if (state.status === "RUNNING" || state.status === "STARTING") {
      return false;
    }

    const timer = this.restartTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(id);
    }

    state.status = "STARTING";
    const spec = state.spec;
    const cmd = [...spec.command];
    if (cmd[0] === "bun") {
      cmd[0] = process.execPath;
    }
    const cwd = spec.cwd || process.cwd();
    const env = { ...process.env, ...spec.env };

    try {
      const proc = spawn({
        cmd,
        cwd,
        env,
        stdout: "pipe",
        stderr: "pipe",
        onExit: (_proc, exitCode, signalCode, error) => {
          this.handleProcessExit(id, exitCode, signalCode, error);
        },
      });

      this.subprocesses.set(id, proc);
      state.pid = proc.pid;
      state.startedAtMs = Date.now();
      state.status = "RUNNING";

      // stderr 비동기 캡처 루프
      this.captureStderr(id, proc);

      // 일정 시간 이상 안정 실행 시 재시작 카운터 리셋
      const minUptime = spec.minUptimeMs ?? RUNNER_DEFAULTS.MIN_UPTIME_MS;
      setTimeout(() => {
        if (state.status === "RUNNING" && this.subprocesses.get(id) === proc) {
          state.restartCount = 0;
        }
      }, minUptime);

      return true;
    } catch (err: any) {
      state.status = "CRASHED";
      state.lastCrashError = err?.message || String(err);
      return false;
    }
  }

  /**
   * 프로세스 stderr 실시간 캡처
   */
  private async captureStderr(id: string, proc: Subprocess): Promise<void> {
    if (!proc.stderr) return;
    const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const buffer = this.stderrBuffers.get(id) || [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.trim().length > 0) {
            buffer.push(line);
            if (buffer.length > 50) buffer.shift();
          }
        }
      }
    } catch {}
  }

  /**
   * 프로세스 종료 감지 및 자동 복구 핸들러
   */
  private handleProcessExit(
    id: string,
    exitCode: number | null,
    signalCode: number | string | null,
    error?: Error
  ): void {
    const state = this.states.get(id);
    if (!state) return;

    this.subprocesses.delete(id);
    state.pid = null;
    state.lastExitCode = exitCode;

    if (this.isShuttingDown || state.status === "STOPPED") {
      state.status = "STOPPED";
      return;
    }

    const isAbnormal = exitCode !== 0 || signalCode !== null || error !== undefined;
    if (isAbnormal) {
      state.status = "CRASHED";
      const buffer = this.stderrBuffers.get(id) || [];
      const tail = buffer.slice(-5).join("\n");
      const errSig = error?.message || (exitCode !== null ? `Exit code ${exitCode}` : `Signal ${signalCode}`);
      state.lastCrashError = `${errSig}\n${tail}`.trim();

      // 크래시 덤프 자동 수집 피드백
      if (this.config.autoHarvestCrash !== false && this.onCrashHarvest) {
        this.onCrashHarvest({
          processId: id,
          timestampMs: Date.now(),
          exitCode,
          errorSignature: errSig,
          tailStderr: tail,
        });
      }

      // 자동 재기동 수행 여부 결정
      if (this.config.autoRestart !== false) {
        this.scheduleAutoRestart(id);
      }
    } else {
      state.status = "STOPPED";
    }
  }

  /**
   * 지수 백오프 기반 자동 재시작 스케줄링
   */
  private scheduleAutoRestart(id: string): void {
    const state = this.states.get(id);
    if (!state) return;

    const maxRestarts = state.spec.maxRestarts ?? RUNNER_DEFAULTS.MAX_RESTARTS;
    if (state.restartCount >= maxRestarts) {
      state.status = "BACKOFF_LIMIT";
      process.stderr.write(
        `[ProcessSupervisor] 프로세스 (${id}) 재시작 한도 초과 (${maxRestarts}회). 감시 중단.\n`
      );
      return;
    }

    state.restartCount++;
    this.totalRestartsTriggered++;
    state.status = "RESTARTING";

    const baseDelay = state.spec.restartDelayMs ?? RUNNER_DEFAULTS.RESTART_DELAY_MS;
    const delay = Math.min(baseDelay * Math.pow(1.5, state.restartCount - 1), 30000);

    const timer = setTimeout(() => {
      this.restartTimers.delete(id);
      this.startProcess(id);
    }, delay);

    this.restartTimers.set(id, timer);
  }

  /**
   * 프로세스 정지
   */
  public stopProcess(id: string): void {
    const timer = this.restartTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(id);
    }

    const state = this.states.get(id);
    if (state) {
      state.status = "STOPPED";
    }

    const proc = this.subprocesses.get(id);
    if (proc) {
      try {
        proc.kill();
        if (typeof proc.kill === "function") {
          try {
            proc.kill(9);
          } catch {}
        }
      } catch {}
      this.subprocesses.delete(id);
    }
  }

  /**
   * 모든 등록된 프로세스 일괄 기동
   */
  public startAll(): void {
    for (const id of this.states.keys()) {
      this.startProcess(id);
    }
  }

  /**
   * 모든 프로세스 일괄 정지
   */
  public stopAll(): void {
    for (const id of this.states.keys()) {
      this.stopProcess(id);
    }
  }

  /**
   * 실시간 통계 조회
   */
  public getStats(): RunnerStats {
    let runningCount = 0;
    let crashedCount = 0;
    const now = Date.now();

    const processStates = Array.from(this.states.values()).map((s) => {
      if (s.status === "RUNNING") runningCount++;
      if (s.status === "CRASHED" || s.status === "BACKOFF_LIMIT") crashedCount++;

      const uptimeMs =
        s.status === "RUNNING" && s.startedAtMs ? Math.max(0, now - s.startedAtMs) : 0;

      return {
        id: s.spec.id,
        status: s.status,
        pid: s.pid,
        uptimeMs,
        restartCount: s.restartCount,
      };
    });

    return {
      totalManagedProcesses: this.states.size,
      runningCount,
      crashedCount,
      totalRestartsTriggered: this.totalRestartsTriggered,
      processStates,
    };
  }

  /**
   * OS 종료 시그널 핸들러 및 DB 안전 플러시 가드
   */
  private registerSignalHandlers(): void {
    const handleShutdown = async (sig: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      // 1. 등록된 DB 안전 플러시 가드 즉시 실행
      if (this.config.onShutdownFlush) {
        try {
          await this.config.onShutdownFlush();
        } catch (err: any) {
          process.stderr.write(`[ProcessSupervisor] 종료 플러시 실패: ${err?.message || err}\n`);
        }
      }

      // 2. 모든 자식 프로세스 정리
      this.stopAll();
    };

    try {
      process.on("SIGINT", () => handleShutdown("SIGINT"));
      process.on("SIGTERM", () => handleShutdown("SIGTERM"));
      process.on("beforeExit", () => handleShutdown("beforeExit"));
      process.on("exit", () => handleShutdown("exit"));
    } catch {}
  }

  /**
   * 고아 프로세스 강제 정리 (Orphan Process Reaper)
   */
  public reapOrphans(): number {
    let reapedCount = 0;
    for (const [id, proc] of this.subprocesses.entries()) {
      try {
        if (!proc.killed) {
          proc.kill(9);
          reapedCount++;
        }
      } catch {}
      this.subprocesses.delete(id);
      const state = this.states.get(id);
      if (state) state.status = "STOPPED";
    }
    return reapedCount;
  }

  /**
   * 슈퍼바이저 종료
   */
  public close(): void {
    this.isShuttingDown = true;
    for (const timer of this.restartTimers.values()) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();
    this.stopAll();
    this.states.clear();
    this.stderrBuffers.clear();
  }
}
