/**
 * Synapse-DB 메인 진입점 (Universal Markdown-First & In-Memory Connectome Database)
 * Part of Synapse Kit | AI-Native Unified Framework
 */
import { SynapseEngine } from "./engine";
import { SynapseCollection } from "./collection";
import { SynapseMigrator } from "./migrator";
import { SynapseConnectome } from "./connectome";
import { exportToObsidianCanvas, type CanvasData } from "./canvasExporter";
import type { SynapseDBConfig, SynapseDBStats } from "./types";
import type {
  CausalTimelineDiff,
  CausalWalEntry,
  CausalWalUnifiedStats,
  CompilerTemporalMetric,
} from "./wal";

export class SynapseDB {
  public readonly engine: SynapseEngine;
  private readonly collections = new Map<string, SynapseCollection<any>>();

  constructor(config: SynapseDBConfig) {
    this.engine = new SynapseEngine(config);
  }

  /**
   * 데이터베이스 초기화 (볼트 스캔 및 인메모리 커넥톰 적재)
   */
  public async init(): Promise<void> {
    await this.engine.init();
  }

  /**
   * 특정 컬렉션 획득 (타입 세이프)
   */
  public collection<TData = Record<string, any>>(name: string): SynapseCollection<TData> {
    let col = this.collections.get(name);
    if (!col) {
      col = new SynapseCollection<TData>(name, this.engine);
      this.collections.set(name, col);
    }
    return col as SynapseCollection<TData>;
  }

  /**
   * 전체 시냅스 망을 옵시디언 캔버스(.canvas) 파일로 내보내기
   */
  public exportCanvas(targetFilePath: string, options?: Parameters<typeof exportToObsidianCanvas>[2]): CanvasData {
    return exportToObsidianCanvas(this.engine.connectome, targetFilePath, options);
  }

  /**
   * SQLite / JSON 변환 마이그레이터 도구 인스턴스 생성
   */
  public createMigrator(): SynapseMigrator {
    return new SynapseMigrator(this.engine);
  }

  /**
   * 전체 데이터베이스 통계 요약
   */
  public stats(): SynapseDBStats {
    return this.engine.getStats();
  }

  /**
   * 대기 중인 모든 디스크 I/O 플러시
   */
  public flush(): void {
    this.engine.flushPendingWrites();
  }

  /**
   * 아레나 할당기 기반 원자적 트랜잭션 실행 (예외 발생 시 0ns 롤백)
   */
  public async transaction<TResult>(
    fn: () => Promise<TResult> | TResult
  ): Promise<TResult> {
    return this.engine.executeTransaction(fn);
  }

  /**
   * 특정 LSN 시점의 시냅스 커넥톰을 즉시 복원 (Time-Travel)
   */
  public asOfLsn(targetLsn: number): SynapseConnectome {
    return this.engine.wal.asOfLsn(this.engine.connectome, targetLsn);
  }

  /**
   * 특정 타임스탬프(밀리초 또는 ISO 문자열) 시점의 시냅스 커넥톰 즉시 복원 (Time-Travel)
   */
  public asOf(timestampMsOrIso: number | string): SynapseConnectome {
    return this.engine.wal.asOf(this.engine.connectome, timestampMsOrIso);
  }

  /**
   * 두 LSN 시점 사이의 문서 생성·수정·삭제 및 위키링크 변화 차분(Diff) 조회
   */
  public diffBetweenLsn(fromLsn: number, toLsn: number): CausalTimelineDiff {
    return this.engine.wal.diffBetweenLsn(fromLsn, toLsn);
  }

  /**
   * 컴파일러 빌드 지연시간 및 바이너리 크기 시계열 메트릭 기록
   */
  public recordCompilerMetric(metric: CompilerTemporalMetric): CausalWalEntry {
    return this.engine.wal.recordCompilerMetric(metric);
  }

  /**
   * Causal-WAL (링 버퍼, 아레나, SQLite WAL) 통합 상태 통계
   */
  public walStats(): CausalWalUnifiedStats {
    return this.engine.wal.getStats();
  }

  /**
   * 데이터베이스 종료 및 워처 해제
   */
  public close(): void {
    this.engine.close();
  }
}

// 하위 핵심 타입 및 모듈 재익스포트
export * from "./types";
export * from "./collection";
export * from "./connectome";
export * from "./serializer";
export * from "./engine";
export * from "./migrator";
export * from "./canvasExporter";
export * from "./wal";
