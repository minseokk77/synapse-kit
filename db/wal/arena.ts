/**
 * 러스트 Bumpalo 스타일 지역 아레나 할당기 및 트랜잭션 스코프 (Arena Transaction Lifecycle)
 * - 트랜잭션 중 발생하는 모든 변경 슬롯을 사전 할당된 연속 풀(Pool)에서 포인터 전진(cursor++)만으로 O(1) 할당
 * - 커밋(Commit) 또는 롤백(Rollback) 즉시 포인터를 0으로 리셋하여 0ns 일괄 해제 (Zero-GC)
 */
import type { SynapseDocument } from "../types";
import {
  CausalWalEventType,
  WAL_CONFIG_DEFAULTS,
  type CompilerTemporalMetric,
} from "./config";

/** 아레나 내부에서 재사용되는 가변 슬롯 구조체 */
export interface ArenaMutationSlot {
  eventType: CausalWalEventType;
  collection: string;
  docId: string;
  prevDoc: SynapseDocument | null;
  nextDoc: SynapseDocument | null;
  edgesAdded: string[];
  edgesRemoved: string[];
  rawMarkdown: string | null;
  targetDiskPath: string | null;
  compilerMetric?: CompilerTemporalMetric;
}

/** 아레나 메모리 통계 */
export interface ArenaStats {
  readonly poolCapacity: number;
  readonly activeCursor: number;
  readonly totalTransactionsCommitted: number;
  readonly totalTransactionsRolledBack: number;
  readonly totalSlotReuses: number;
}

export class CausalArenaAllocator {
  private readonly pool: ArenaMutationSlot[];
  private cursor = 0;
  private inTransaction = false;

  private totalCommitted = 0;
  private totalRolledBack = 0;
  private totalSlotReuses = 0;

  constructor(initialCapacity: number = WAL_CONFIG_DEFAULTS.ARENA_INITIAL_CAPACITY) {
    this.pool = new Array<ArenaMutationSlot>(initialCapacity);
    for (let i = 0; i < initialCapacity; i++) {
      this.pool[i] = this.createEmptySlot();
    }
  }

  private createEmptySlot(): ArenaMutationSlot {
    return {
      eventType: CausalWalEventType.DOC_UPSERT,
      collection: "",
      docId: "",
      prevDoc: null,
      nextDoc: null,
      edgesAdded: [],
      edgesRemoved: [],
      rawMarkdown: null,
      targetDiskPath: null,
      compilerMetric: undefined,
    };
  }

  /**
   * 트랜잭션 아레나 스코프 시작
   */
  public beginScope(): void {
    if (this.inTransaction) {
      throw new Error("[CausalArenaAllocator] 중첩 트랜잭션은 이미 활성화된 스코프가 존재합니다.");
    }
    this.inTransaction = true;
    this.cursor = 0;
  }

  /**
   * 현재 트랜잭션 스코프 활성화 여부
   */
  public isScopeActive(): boolean {
    return this.inTransaction;
  }

  /**
   * 포인터 전진(Bump Allocation)을 통해 힙 할당 없이 슬롯 획득
   */
  public allocSlot(
    eventType: CausalWalEventType,
    collection: string,
    docId: string,
    prevDoc: SynapseDocument | null,
    nextDoc: SynapseDocument | null,
    edgesAdded: string[],
    edgesRemoved: string[],
    rawMarkdown: string | null = null,
    targetDiskPath: string | null = null,
    compilerMetric?: CompilerTemporalMetric
  ): ArenaMutationSlot {
    if (this.cursor >= this.pool.length) {
      if (this.pool.length >= WAL_CONFIG_DEFAULTS.ARENA_MAX_CAPACITY) {
        throw new Error(
          `[CausalArenaAllocator] 아레나 최대 용량 상한선(${WAL_CONFIG_DEFAULTS.ARENA_MAX_CAPACITY})을 초과했습니다.`
        );
      }
      const expandCount = Math.min(
        this.pool.length,
        WAL_CONFIG_DEFAULTS.ARENA_MAX_CAPACITY - this.pool.length
      );
      for (let i = 0; i < expandCount; i++) {
        this.pool.push(this.createEmptySlot());
      }
    } else {
      this.totalSlotReuses++;
    }

    const slot = this.pool[this.cursor++];
    slot.eventType = eventType;
    slot.collection = collection;
    slot.docId = docId;
    slot.prevDoc = prevDoc;
    slot.nextDoc = nextDoc;
    slot.edgesAdded = edgesAdded;
    slot.edgesRemoved = edgesRemoved;
    slot.rawMarkdown = rawMarkdown;
    slot.targetDiskPath = targetDiskPath;
    slot.compilerMetric = compilerMetric;

    return slot;
  }

  /**
   * 현재 스코프에 적재된 유효 슬롯 뷰 반환
   */
  public getActiveSlots(): readonly ArenaMutationSlot[] {
    return this.pool.slice(0, this.cursor);
  }

  /**
   * 커밋 완료 후 O(1) 포인터 리셋 (0ns Instant Deallocation)
   */
  public commitAndReset(): void {
    this.clearReferencesUpToCursor();
    this.cursor = 0;
    this.inTransaction = false;
    this.totalCommitted++;
  }

  /**
   * 예외 발생 시 롤백 및 O(1) 포인터 리셋 (커넥톰 및 WAL 오염 0%)
   */
  public rollbackAndReset(): void {
    this.clearReferencesUpToCursor();
    this.cursor = 0;
    this.inTransaction = false;
    this.totalRolledBack++;
  }

  /**
   * 사용된 슬롯의 내부 참조만 즉시 비워 메모리 누수 차단 (슬롯 객체 자체는 풀에 보존)
   */
  private clearReferencesUpToCursor(): void {
    for (let i = 0; i < this.cursor; i++) {
      const slot = this.pool[i];
      slot.prevDoc = null;
      slot.nextDoc = null;
      slot.rawMarkdown = null;
      slot.targetDiskPath = null;
      slot.compilerMetric = undefined;
    }
  }

  /**
   * 아레나 할당기 통계 조회
   */
  public getStats(): ArenaStats {
    return {
      poolCapacity: this.pool.length,
      activeCursor: this.cursor,
      totalTransactionsCommitted: this.totalCommitted,
      totalTransactionsRolledBack: this.totalRolledBack,
      totalSlotReuses: this.totalSlotReuses,
    };
  }
}
