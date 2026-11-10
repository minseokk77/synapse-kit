/**
 * 시냅스 Causal-WAL 통합 오케스트레이터 (Causal-WAL Engine Facade)
 * - TemporalRingBuffer (순환 링 버퍼) + CausalArenaAllocator (아레나 트랜잭션) + SqliteCausalWalStore (SQLite WAL) 통합
 */
import { join } from "node:path";
import { SynapseConnectome } from "../connectome";
import type { SynapseDocument } from "../types";
import {
  CausalWalEventType,
  WAL_CONFIG_DEFAULTS,
  type CausalWalConfig,
  type CompilerTemporalMetric,
} from "./config";
import {
  TemporalRingBuffer,
  type CausalWalEntry,
  type RingBufferStats,
} from "./ringBuffer";
import {
  CausalArenaAllocator,
  type ArenaMutationSlot,
  type ArenaStats,
} from "./arena";
import { SqliteCausalWalStore } from "./sqliteWalStore";
import { CausalTimeTravelEngine, type CausalTimelineDiff } from "./timeTravel";

export interface CausalWalUnifiedStats {
  readonly ringBuffer: RingBufferStats;
  readonly arena: ArenaStats;
  readonly sqlite: {
    readonly enabled: boolean;
    readonly dbPath: string | null;
    readonly journalMode: string;
    readonly lastFlushedLsn: number;
    readonly persistedCount: number;
  };
}

const EMPTY_EDGES: string[] = [];
const EMPTY_EDGE_DIFF = { edgesAdded: EMPTY_EDGES, edgesRemoved: EMPTY_EDGES };

export class CausalWalEngine {
  public readonly ringBuffer: TemporalRingBuffer;
  public readonly arena: CausalArenaAllocator;
  public readonly sqliteStore: SqliteCausalWalStore | null;

  constructor(vaultDir: string, config?: CausalWalConfig) {
    this.ringBuffer = new TemporalRingBuffer(
      config?.ringCapacity ?? WAL_CONFIG_DEFAULTS.RING_BUFFER_CAPACITY
    );
    this.arena = new CausalArenaAllocator(
      config?.arenaCapacity ?? WAL_CONFIG_DEFAULTS.ARENA_INITIAL_CAPACITY
    );

    if (config?.persistSqlite || config?.sqlitePath) {
      const targetSqlitePath =
        config.sqlitePath || join(vaultDir, WAL_CONFIG_DEFAULTS.SQLITE_WAL_FILENAME);
      this.sqliteStore = new SqliteCausalWalStore(
        targetSqlitePath,
        config.syncMode ?? WAL_CONFIG_DEFAULTS.SQLITE_SYNC_MODE
      );
    } else {
      this.sqliteStore = null;
    }
  }

  /**
   * SQLite WAL 스토어 초기화 및 기존 WAL 로그로부터 크래시 복구 수행
   */
  public initAndRecover(connectome: SynapseConnectome): number {
    if (!this.sqliteStore) return 0;

    this.sqliteStore.init();
    const persistedEntries = this.sqliteStore.loadAllEntries();
    let recoveredCount = 0;

    for (const entry of persistedEntries) {
      this.ringBuffer.appendRecovered(entry);
      if (entry.eventType === CausalWalEventType.DOC_UPSERT && entry.nextDoc) {
        connectome.putDocument(entry.nextDoc);
        recoveredCount++;
      } else if (entry.eventType === CausalWalEventType.DOC_DELETE) {
        connectome.removeDocument(entry.collection, entry.docId);
        recoveredCount++;
      }
    }

    return recoveredCount;
  }

  /**
   * 이전 문서와 신규 문서 간의 위키링크 시냅스 간선 차분(Added / Removed) 계산
   * Zero-Allocation Fast-Path: 위키링크가 없거나 단일 링크가 동일한 경우 Set/배열 할당 완전 생략
   */
  public static computeEdgeDiff(
    prevDoc: SynapseDocument | null,
    nextDoc: SynapseDocument | null
  ): { edgesAdded: string[]; edgesRemoved: string[] } {
    const prevLinks = prevDoc ? prevDoc.wikilinks : EMPTY_EDGES;
    const nextLinks = nextDoc ? nextDoc.wikilinks : EMPTY_EDGES;
    const prevLen = prevLinks.length;
    const nextLen = nextLinks.length;

    if (prevLen === 0 && nextLen === 0) {
      return EMPTY_EDGE_DIFF;
    }

    if (prevLen === 0 && nextLen === 1 && nextDoc) {
      const l = nextDoc.wikilinks[0];
      return {
        edgesAdded: [SynapseConnectome.makeNodeId(l.targetCollection || nextDoc.collection, l.targetId)],
        edgesRemoved: EMPTY_EDGES,
      };
    }

    if (prevLen === 1 && nextLen === 1 && prevDoc && nextDoc) {
      const pl = prevDoc.wikilinks[0];
      const nl = nextDoc.wikilinks[0];
      const pTarget = SynapseConnectome.makeNodeId(pl.targetCollection || prevDoc.collection, pl.targetId);
      const nTarget = SynapseConnectome.makeNodeId(nl.targetCollection || nextDoc.collection, nl.targetId);
      if (pTarget === nTarget) {
        return EMPTY_EDGE_DIFF;
      }
      return {
        edgesAdded: [nTarget],
        edgesRemoved: [pTarget],
      };
    }

    const prevTargets = new Set<string>();
    const nextTargets = new Set<string>();

    if (prevDoc) {
      for (let i = 0; i < prevLen; i++) {
        const link = prevDoc.wikilinks[i];
        prevTargets.add(
          SynapseConnectome.makeNodeId(link.targetCollection || prevDoc.collection, link.targetId)
        );
      }
    }

    if (nextDoc) {
      for (let i = 0; i < nextLen; i++) {
        const link = nextDoc.wikilinks[i];
        nextTargets.add(
          SynapseConnectome.makeNodeId(link.targetCollection || nextDoc.collection, link.targetId)
        );
      }
    }

    const edgesAdded: string[] = [];
    const edgesRemoved: string[] = [];

    for (const target of nextTargets) {
      if (!prevTargets.has(target)) {
        edgesAdded.push(target);
      }
    }

    for (const target of prevTargets) {
      if (!nextTargets.has(target)) {
        edgesRemoved.push(target);
      }
    }

    return { edgesAdded, edgesRemoved };
  }

  /**
   * 문서 생성/수정 이벤트를 WAL에 기록 (트랜잭션 중이면 아레나에 스테이징, 아니면 즉시 커밋)
   */
  public recordDocumentUpsert(
    prevDoc: SynapseDocument | null,
    nextDoc: SynapseDocument,
    rawMarkdown: string | null = null,
    targetDiskPath: string | null = null,
    timestampMs?: number
  ): CausalWalEntry | null {
    const { edgesAdded, edgesRemoved } = CausalWalEngine.computeEdgeDiff(prevDoc, nextDoc);

    if (this.arena.isScopeActive()) {
      this.arena.allocSlot(
        CausalWalEventType.DOC_UPSERT,
        nextDoc.collection,
        nextDoc.id,
        prevDoc,
        nextDoc,
        edgesAdded,
        edgesRemoved,
        rawMarkdown,
        targetDiskPath
      );
      return null;
    }

    const entry = this.ringBuffer.append({
      timestampMs,
      eventType: CausalWalEventType.DOC_UPSERT,
      collection: nextDoc.collection,
      docId: nextDoc.id,
      prevDoc,
      nextDoc,
      edgesAdded,
      edgesRemoved,
    });

    if (this.sqliteStore) {
      this.sqliteStore.flushEntries([entry]);
    }

    return entry;
  }

  /**
   * 문서 삭제 이벤트를 WAL에 기록
   */
  public recordDocumentDelete(
    prevDoc: SynapseDocument,
    targetDiskPath: string | null = null,
    timestampMs?: number
  ): CausalWalEntry | null {
    const { edgesAdded, edgesRemoved } = CausalWalEngine.computeEdgeDiff(prevDoc, null);

    if (this.arena.isScopeActive()) {
      this.arena.allocSlot(
        CausalWalEventType.DOC_DELETE,
        prevDoc.collection,
        prevDoc.id,
        prevDoc,
        null,
        edgesAdded,
        edgesRemoved,
        null,
        targetDiskPath
      );
      return null;
    }

    const entry = this.ringBuffer.append({
      timestampMs,
      eventType: CausalWalEventType.DOC_DELETE,
      collection: prevDoc.collection,
      docId: prevDoc.id,
      prevDoc,
      nextDoc: null,
      edgesAdded,
      edgesRemoved,
    });

    if (this.sqliteStore) {
      this.sqliteStore.flushEntries([entry]);
    }

    return entry;
  }

  /**
   * 컴파일러 빌드 지연시간 및 바이너리 크기 시계열 메트릭을 WAL에 기록
   */
  public recordCompilerMetric(
    metric: CompilerTemporalMetric,
    timestampMs?: number
  ): CausalWalEntry {
    const entry = this.ringBuffer.append({
      timestampMs,
      eventType: CausalWalEventType.COMPILER_METRIC,
      collection: "_compiler_metrics",
      docId: metric.targetFile,
      prevDoc: null,
      nextDoc: null,
      edgesAdded: [],
      edgesRemoved: [],
      compilerMetric: metric,
    });

    if (this.sqliteStore) {
      this.sqliteStore.flushEntries([entry]);
    }

    return entry;
  }

  /**
   * 아레나 기반 원자적 트랜잭션 실행 (예외 발생 시 0ns 롤백, 성공 시 일괄 커밋)
   */
  public executeArenaTransaction<TResult>(
    fn: () => TResult,
    onCommitSlot: (slot: ArenaMutationSlot) => void
  ): TResult {
    this.arena.beginScope();
    try {
      const result = fn();
      const activeSlots = this.arena.getActiveSlots();
      const committedEntries: CausalWalEntry[] = [];

      for (const slot of activeSlots) {
        onCommitSlot(slot);
        const entry = this.ringBuffer.append({
          eventType: slot.eventType,
          collection: slot.collection,
          docId: slot.docId,
          prevDoc: slot.prevDoc,
          nextDoc: slot.nextDoc,
          edgesAdded: [...slot.edgesAdded],
          edgesRemoved: [...slot.edgesRemoved],
          compilerMetric: slot.compilerMetric,
        });
        committedEntries.push(entry);
      }

      this.arena.commitAndReset();

      if (this.sqliteStore && committedEntries.length > 0) {
        this.sqliteStore.flushEntries(committedEntries);
      }

      return result;
    } catch (err) {
      this.arena.rollbackAndReset();
      throw err;
    }
  }

  /**
   * 아레나 기반 비동기 원자적 트랜잭션 실행 (async 콜백 내 save/delete 완벽 지원)
   */
  public async executeArenaTransactionAsync<TResult>(
    fn: () => Promise<TResult> | TResult,
    onCommitSlot: (slot: ArenaMutationSlot) => void
  ): Promise<TResult> {
    this.arena.beginScope();
    try {
      const result = await fn();
      const activeSlots = this.arena.getActiveSlots();
      const committedEntries: CausalWalEntry[] = [];

      for (const slot of activeSlots) {
        onCommitSlot(slot);
        const entry = this.ringBuffer.append({
          eventType: slot.eventType,
          collection: slot.collection,
          docId: slot.docId,
          prevDoc: slot.prevDoc,
          nextDoc: slot.nextDoc,
          edgesAdded: [...slot.edgesAdded],
          edgesRemoved: [...slot.edgesRemoved],
          compilerMetric: slot.compilerMetric,
        });
        committedEntries.push(entry);
      }

      this.arena.commitAndReset();

      if (this.sqliteStore && committedEntries.length > 0) {
        this.sqliteStore.flushEntries(committedEntries);
      }

      return result;
    } catch (err) {
      this.arena.rollbackAndReset();
      throw err;
    }
  }

  /**
   * 특정 LSN 시점의 시냅스 커넥톰 즉시 복원 (Time-Travel)
   */
  public asOfLsn(connectome: SynapseConnectome, targetLsn: number): SynapseConnectome {
    return CausalTimeTravelEngine.asOfLsn(connectome, this.ringBuffer, targetLsn);
  }

  /**
   * 특정 타임스탬프 시점의 시냅스 커넥톰 즉시 복원 (Time-Travel)
   */
  public asOf(
    connectome: SynapseConnectome,
    timestampMsOrIso: number | string
  ): SynapseConnectome {
    return CausalTimeTravelEngine.asOf(connectome, this.ringBuffer, timestampMsOrIso);
  }

  /**
   * 두 LSN 시점 간의 인과율 차분(Diff) 조회
   */
  public diffBetweenLsn(fromLsn: number, toLsn: number): CausalTimelineDiff {
    return CausalTimeTravelEngine.diffBetweenLsn(this.ringBuffer, fromLsn, toLsn);
  }

  /**
   * 통합 WAL 통계 조회
   */
  public getStats(): CausalWalUnifiedStats {
    return {
      ringBuffer: this.ringBuffer.getStats(),
      arena: this.arena.getStats(),
      sqlite: {
        enabled: this.sqliteStore !== null,
        dbPath: this.sqliteStore?.dbPath ?? null,
        journalMode: this.sqliteStore ? this.sqliteStore.getJournalMode() : "disabled",
        lastFlushedLsn: this.sqliteStore ? this.sqliteStore.getLastFlushedLsn() : 0,
        persistedCount: this.sqliteStore ? this.sqliteStore.getPersistedCount() : 0,
      },
    };
  }

  /**
   * SQLite WAL 스토어 안전 종료
   */
  public close(): void {
    if (this.sqliteStore) {
      this.sqliteStore.close();
    }
  }
}

export * from "./config";
export * from "./ringBuffer";
export * from "./arena";
export * from "./sqliteWalStore";
export * from "./timeTravel";
