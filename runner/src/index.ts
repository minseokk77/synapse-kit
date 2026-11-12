/**
 * 시냅스 자가치유 프로세스 슈퍼바이저 통합 파사드 (Synapse Runner Unified Façade)
 */
import { ProcessSupervisor } from "./supervisor";
import { HotSwapManager, type HotSwapOptions } from "./hotswap";
import type { ProcessSpec, RunnerConfig } from "./config";
import type { RunnerStats, CrashHarvestRecord } from "./types";

export class SynapseRunner {
  public readonly supervisor: ProcessSupervisor;
  public readonly hotSwap: HotSwapManager;
  private readonly harvestedCrashes: CrashHarvestRecord[] = [];

  constructor(
    config: RunnerConfig = {},
    private readonly onHarvest?: (record: CrashHarvestRecord) => void
  ) {
    this.hotSwap = new HotSwapManager();
    this.supervisor = new ProcessSupervisor(config, (record) => {
      this.harvestedCrashes.push(record);
      if (this.onHarvest) {
        this.onHarvest(record);
      }
    });
  }

  /**
   * 프로세스 등록
   */
  public register(spec: ProcessSpec): void {
    this.supervisor.registerProcess(spec);
  }

  /**
   * 단일 프로세스 시작
   */
  public start(id: string): boolean {
    return this.supervisor.startProcess(id);
  }

  /**
   * 전체 프로세스 시작
   */
  public startAll(): void {
    this.supervisor.startAll();
  }

  /**
   * 단일 프로세스 정지
   */
  public stop(id: string): void {
    this.supervisor.stopProcess(id);
  }

  /**
   * 전체 프로세스 정지
   */
  public stopAll(): void {
    this.supervisor.stopAll();
  }

  /**
   * 무중단 핫스왑 실행
   */
  public async hotSwapProcess(
    spec: ProcessSpec,
    options?: HotSwapOptions
  ): Promise<{ success: boolean; pid: number | null; error?: string }> {
    return this.hotSwap.swap(spec, options);
  }

  /**
   * 실시간 통계 조회
   */
  public getStats(): RunnerStats {
    return this.supervisor.getStats();
  }

  /**
   * 수집된 크래시 기록 목록 반환
   */
  public getHarvestedCrashes(): readonly CrashHarvestRecord[] {
    return this.harvestedCrashes;
  }

  /**
   * 고아 프로세스 강제 정리 (Orphan Process Reaper)
   */
  public reapOrphans(): number {
    return this.supervisor.reapOrphans();
  }

  /**
   * 모든 리소스 정리 및 프로세스 안전 종료
   */
  public close(): void {
    this.supervisor.close();
    this.hotSwap.close();
  }
}

export * from "./config";
export * from "./types";
export * from "./supervisor";
export * from "./hotswap";
