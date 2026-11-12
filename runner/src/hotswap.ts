/**
 * 무중단 원자적 핫스왑 매니저 (Zero-Downtime Hot-Swap Manager)
 * - 신규 프로세스를 백그라운드에 먼저 띄워 헬스체크 완료 후 기존 프로세스 교체 (Blue-Green Swap)
 * - 신규 버전 실패 시 기존 프로세스를 무중단 유지하고 0ns 자동 롤백
 */
import { spawn, type Subprocess } from "bun";
import type { ProcessSpec } from "./config";

export interface HotSwapOptions {
  /** 헬스체크 성공 판정 대기 시간 (ms, 기본: 1000) */
  readonly healthCheckWaitMs?: number;
  /** 커스텀 헬스체크 함수 */
  readonly healthCheckFn?: (proc: Subprocess) => Promise<boolean> | boolean;
}

export class HotSwapManager {
  private activeProcess: Subprocess | null = null;
  private currentSpec: ProcessSpec | null = null;

  constructor() {}

  /**
   * 현재 실행 중인 프로세스 조회
   */
  public getActiveProcess(): Subprocess | null {
    return this.activeProcess;
  }

  /**
   * 무중단 핫스왑 실행
   */
  public async swap(
    nextSpec: ProcessSpec,
    options: HotSwapOptions = {}
  ): Promise<{ success: boolean; pid: number | null; error?: string }> {
    const healthWait = options.healthCheckWaitMs ?? 1000;
    const cmd = [...nextSpec.command];
    if (cmd[0] === "bun") {
      cmd[0] = process.execPath;
    }
    const cwd = nextSpec.cwd || process.cwd();
    const env = { ...process.env, ...nextSpec.env };

    let candidateProc: Subprocess | null = null;

    try {
      // 1. 신규 후보(Candidate) 프로세스 백그라운드 스폰
      candidateProc = spawn({
        cmd,
        cwd,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      // 2. 헬스체크 대기 시간 동안 후보 프로세스 생존 여부 확인
      await new Promise((resolve) => setTimeout(resolve, healthWait));

      // 3. 프로세스가 비정상 종료되었는지 확인
      if (candidateProc.exitCode !== null) {
        throw new Error(
          `[HotSwapManager] 신규 프로세스 즉시 종료됨 (Exit code: ${candidateProc.exitCode})`
        );
      }

      // 커스텀 헬스체크가 지정된 경우 실행
      if (options.healthCheckFn) {
        const isHealthy = await options.healthCheckFn(candidateProc);
        if (!isHealthy) {
          throw new Error("[HotSwapManager] 신규 프로세스 헬스체크 불합격");
        }
      }

      // 4. 스왑 성공: 기존 구버전 프로세스 안전 종료
      const oldProc = this.activeProcess;
      this.activeProcess = candidateProc;
      this.currentSpec = nextSpec;

      if (oldProc && !oldProc.killed) {
        try {
          oldProc.kill();
        } catch {}
      }

      return {
        success: true,
        pid: candidateProc.pid,
      };
    } catch (err: any) {
      // 스왑 실패: 신규 후보 프로세스 강제 정리 및 기존 프로세스 유지 (자동 롤백)
      if (candidateProc && !candidateProc.killed) {
        try {
          candidateProc.kill();
        } catch {}
      }

      return {
        success: false,
        pid: this.activeProcess?.pid ?? null,
        error: err?.message || String(err),
      };
    }
  }

  /**
   * 활성 프로세스 안전 종료
   */
  public close(): void {
    if (this.activeProcess && !this.activeProcess.killed) {
      try {
        this.activeProcess.kill();
      } catch {}
      this.activeProcess = null;
    }
  }
}
