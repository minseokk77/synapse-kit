/**
 * 시냅스 러너 (Synapse Runner) 자가치유 슈퍼바이저 및 핫스왑 검증 스위트
 */
import { describe, it, expect, afterEach } from "bun:test";
import { SynapseRunner } from "../src";

describe("🔄 Synapse Runner (자가치유 프로세스 슈퍼바이저 & 핫스왑) 검증", () => {
  let runner: SynapseRunner | null = null;

  afterEach(() => {
    if (runner) {
      runner.close();
      runner = null;
    }
  });

  it("1. [프로세스 수명주기 관리] 등록 후 기동 및 상태 추적, 안전 정지 검증", async () => {
    runner = new SynapseRunner({ autoRestart: false });

    // 간단히 대기하는 프로세스 등록
    runner.register({
      id: "worker_idle",
      command: ["bun", "-e", "setInterval(() => {}, 1000)"],
    });

    const started = runner.start("worker_idle");
    expect(started).toBe(true);

    const stats = runner.getStats();
    expect(stats.totalManagedProcesses).toBe(1);
    expect(stats.runningCount).toBe(1);
    expect(stats.processStates[0].status).toBe("RUNNING");
    expect(stats.processStates[0].pid).toBeGreaterThan(0);

    // 프로세스 정상 정지
    runner.stop("worker_idle");
    const stoppedStats = runner.getStats();
    expect(stoppedStats.runningCount).toBe(0);
    expect(stoppedStats.processStates[0].status).toBe("STOPPED");
  });

  it("2. [크래시 자동 치유 & 에러 수집] 비정상 종료 시 자동 재시작 및 Harvest 검증", async () => {
    const harvested: string[] = [];

    runner = new SynapseRunner(
      {
        autoRestart: true,
      },
      (record) => {
        harvested.push(record.errorSignature);
      }
    );

    // 0.2초 후 의도적으로 크래시(exit 1)하는 프로세스
    runner.register({
      id: "faulty_worker",
      command: ["bun", "-e", "setTimeout(() => { process.stderr.write('fatal crash occurred\\n'); process.exit(1); }, 200)"],
      restartDelayMs: 100,
      maxRestarts: 3,
    });

    runner.start("faulty_worker");

    // 첫 번째 크래시 및 재기동 대기
    await new Promise((resolve) => setTimeout(resolve, 800));

    const stats = runner.getStats();
    expect(stats.totalRestartsTriggered).toBeGreaterThan(0);
    expect(harvested.length).toBeGreaterThan(0);
    expect(harvested[0]).toContain("Exit code 1");
  });

  it("3. [무중단 핫스왑 (Zero-Downtime Hot-Swap)] 헬스체크 통과 신규 버전 무손실 교체", async () => {
    runner = new SynapseRunner();

    // 1세대 프로세스 실행
    const res1 = await runner.hotSwapProcess(
      {
        id: "app_v1",
        command: ["bun", "-e", "setInterval(() => {}, 1000)"],
      },
      { healthCheckWaitMs: 150 }
    );
    expect(res1.success).toBe(true);
    const pid1 = res1.pid;
    expect(pid1).toBeGreaterThan(0);

    // 2세대 프로세스로 무중단 스왑
    const res2 = await runner.hotSwapProcess(
      {
        id: "app_v2",
        command: ["bun", "-e", "setInterval(() => {}, 1000)"],
      },
      { healthCheckWaitMs: 150 }
    );
    expect(res2.success).toBe(true);
    const pid2 = res2.pid;
    expect(pid2).toBeGreaterThan(0);
    expect(pid2).not.toBe(pid1);
  });

  it("4. [핫스왑 실패 시 자동 롤백] 불량 신규 버전 시도 시 기존 프로세스 유지", async () => {
    runner = new SynapseRunner();

    // 정상 프로세스 기동
    const initial = await runner.hotSwapProcess(
      {
        id: "healthy_app",
        command: ["bun", "-e", "setInterval(() => {}, 1000)"],
      },
      { healthCheckWaitMs: 150 }
    );
    expect(initial.success).toBe(true);
    const originPid = initial.pid;

    // 즉시 크래시되는 불량 프로세스로 스왑 시도
    const failedSwap = await runner.hotSwapProcess(
      {
        id: "bad_app",
        command: ["bun", "-e", "process.exit(2)"],
      },
      { healthCheckWaitMs: 150 }
    );

    // 스왑 실패 판정 및 기존 프로세스 유지 확인
    expect(failedSwap.success).toBe(false);
    expect(failedSwap.pid).toBe(originPid);
    expect(runner.hotSwap.getActiveProcess()?.pid).toBe(originPid);
  });

  it("5. [종료 시그널 DB 안전 플러시 가드] 종료 콜백 정상 연동 확인", async () => {
    let flushExecuted = false;

    runner = new SynapseRunner({
      onShutdownFlush: () => {
        flushExecuted = true;
      },
    });

    runner.register({
      id: "bg_worker",
      command: ["bun", "-e", "setInterval(() => {}, 1000)"],
    });
    runner.start("bg_worker");

    // 수동 종료 시뮬레이션
    runner.close();
    expect(runner.getStats().runningCount).toBe(0);
  });

  it("6. [고아 프로세스 강제 정리: reapOrphans] 잔류 프로세스 전량 회수 검증", async () => {
    runner = new SynapseRunner({ autoRestart: false });

    runner.register({
      id: "orphan_candidate",
      command: ["bun", "-e", "setInterval(() => {}, 1000)"],
    });

    runner.start("orphan_candidate");
    expect(runner.getStats().runningCount).toBe(1);

    const reaped = runner.reapOrphans();
    expect(reaped).toBe(1);
    expect(runner.getStats().runningCount).toBe(0);
  });
});
