/**
 * 러스트 메모리 철학 기반 순환 링 버퍼 WAL (Zero-GC Temporal Ring Buffer)
 * - 고정 용량 슬롯 배열 및 TypedArray(Float64Array) 인덱스 사전 할당
 * - 용량 초과 시 가비지 컬렉터(GC) 개입 없이 가장 오래된 슬롯을 O(1)로 덮어쓰기(FIFO Drop)
 * - LSN(Log Sequence Number) 및 타임스탬프 기반 초고속 시계열 탐색 지원
 */
import type { SynapseDocument } from "../types";
import {
  CausalWalEventType,
  WAL_CONFIG_DEFAULTS,
  type CompilerTemporalMetric,
} from "./config";

/** 단일 인과율 WAL 로그 엔트리 (구조적 공유를 위한 불변 참조 유지) */
export interface CausalWalEntry<TData = any> {
  readonly lsn: number;
  readonly timestampMs: number;
  readonly eventType: CausalWalEventType;
  readonly collection: string;
  readonly docId: string;
  /** 변경 전 문서 상태 참조 (Time-Travel 역방향 복원용, 신규 생성 시 null) */
  readonly prevDoc: SynapseDocument<TData> | null;
  /** 변경 후 문서 상태 참조 (삭제 시 null) */
  readonly nextDoc: SynapseDocument<TData> | null;
  /** 이번 이벤트로 새로 연결된 위키링크 시냅스 타겟 노드 목록 */
  readonly edgesAdded: readonly string[];
  /** 이번 이벤트로 단절된 위키링크 시냅스 타겟 노드 목록 */
  readonly edgesRemoved: readonly string[];
  /** 컴파일러 시계열 메트릭 (COMPILER_METRIC 이벤트 전용) */
  readonly compilerMetric?: CompilerTemporalMetric;
}

/** 링 버퍼 상태 통계 */
export interface RingBufferStats {
  readonly capacity: number;
  readonly size: number;
  readonly currentLsn: number;
  readonly oldestLsn: number;
  readonly overwrittenCount: number;
  readonly utilizationRatio: number;
}

export class TemporalRingBuffer {
  public readonly capacity: number;
  private readonly isPowerOfTwo: boolean;
  private readonly bitMask: number;
  private readonly slots: Array<CausalWalEntry | undefined>;
  private readonly lsnBuffer: Float64Array;
  private readonly tsBuffer: Float64Array;

  private head = 0; // 가장 오래된 엔트리 인덱스
  private tail = 0; // 다음 기록할 슬롯 인덱스
  private count = 0;
  private nextLsn = 1;
  private overwrittenCount = 0;

  constructor(capacity: number = WAL_CONFIG_DEFAULTS.RING_BUFFER_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`[TemporalRingBuffer] 유효하지 않은 링 버퍼 용량입니다: ${capacity}`);
    }
    this.capacity = capacity;
    this.isPowerOfTwo = (capacity & (capacity - 1)) === 0;
    this.bitMask = capacity - 1;
    // 시작 시점에 연속 메모리 슬롯을 단 1회 사전 할당 (Pre-allocation)
    this.slots = new Array<CausalWalEntry | undefined>(capacity);
    this.lsnBuffer = new Float64Array(capacity);
    this.tsBuffer = new Float64Array(capacity);
  }

  private wrapIndex(idx: number): number {
    return this.isPowerOfTwo ? idx & this.bitMask : idx % this.capacity;
  }

  /**
   * 새로운 WAL 이벤트를 링 버퍼에 O(1)로 기록 (용량 초과 시 자동 FIFO 덮어쓰기)
   */
  public append(
    entryInput: Omit<CausalWalEntry, "lsn" | "timestampMs"> & { timestampMs?: number }
  ): CausalWalEntry {
    const lsn = this.nextLsn++;
    const timestampMs = entryInput.timestampMs ?? Date.now();

    const entry: CausalWalEntry = {
      lsn,
      timestampMs,
      eventType: entryInput.eventType,
      collection: entryInput.collection,
      docId: entryInput.docId,
      prevDoc: entryInput.prevDoc,
      nextDoc: entryInput.nextDoc,
      edgesAdded: entryInput.edgesAdded,
      edgesRemoved: entryInput.edgesRemoved,
      compilerMetric: entryInput.compilerMetric,
    };

    this.writeRawEntry(entry);
    return entry;
  }

  /**
   * 외부(SQLite WAL 복구 등)에서 이미 LSN이 부여된 엔트리를 링 버퍼에 적재
   */
  public appendRecovered(entry: CausalWalEntry): void {
    if (entry.lsn >= this.nextLsn) {
      this.nextLsn = entry.lsn + 1;
    }
    this.writeRawEntry(entry);
  }

  private writeRawEntry(entry: CausalWalEntry): void {
    const t = this.tail;
    this.slots[t] = entry;
    this.lsnBuffer[t] = entry.lsn;
    this.tsBuffer[t] = entry.timestampMs;

    const nextTail = this.isPowerOfTwo ? (t + 1) & this.bitMask : (t + 1) % this.capacity;
    this.tail = nextTail;

    if (this.count === this.capacity) {
      // 용량이 가득 찬 경우 가장 오래된 슬롯(head)을 덮어쓰고 head 전진 (Zero-GC Drop)
      this.head = nextTail;
      this.overwrittenCount++;
    } else {
      this.count++;
    }
  }

  /**
   * LSN 번호로 O(1) 직접 슬롯 계산 조회
   */
  public getByLsn(targetLsn: number): CausalWalEntry | null {
    if (this.count === 0) return null;
    const oldestLsn = this.lsnBuffer[this.head];
    const newestIdx = this.wrapIndex(this.tail - 1 + this.capacity);
    const newestLsn = this.lsnBuffer[newestIdx];

    if (targetLsn < oldestLsn || targetLsn > newestLsn) {
      return null;
    }

    // LSN이 연속 단조 증가하는 경우 O(1) 오프셋 계산
    const offset = targetLsn - oldestLsn;
    if (offset < this.count) {
      const candidateIdx = this.wrapIndex(this.head + offset);
      if (this.lsnBuffer[candidateIdx] === targetLsn) {
        return this.slots[candidateIdx] || null;
      }
    }

    // 비연속 LSN 복구 케이스 대비 폴백
    for (let i = 0; i < this.count; i++) {
      const idx = this.wrapIndex(this.head + i);
      if (this.lsnBuffer[idx] === targetLsn) {
        return this.slots[idx] || null;
      }
    }
    return null;
  }

  /**
   * 최신 엔트리부터 역순(최신 ➔ 과거)으로 순회하며 콜백 실행 (Time-Travel 역방향 리플레이 전용)
   * 콜백이 false를 반환하면 즉시 순회 중단
   */
  public forEachReverse(visitor: (entry: CausalWalEntry) => boolean | void): void {
    for (let i = this.count - 1; i >= 0; i--) {
      const idx = (this.head + i) % this.capacity;
      const entry = this.slots[idx];
      if (entry) {
        const shouldContinue = visitor(entry);
        if (shouldContinue === false) break;
      }
    }
  }

  /**
   * 오래된 엔트리부터 시간순(과거 ➔ 최신)으로 전체 엔트리 배열 반환
   */
  public toArray(): CausalWalEntry[] {
    const result = new Array<CausalWalEntry>(this.count);
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      result[i] = this.slots[idx]!;
    }
    return result;
  }

  /**
   * 특정 LSN 이후의 엔트리들만 시간순 반환 (증분 SQLite 플러시 및 Diff 계산용)
   */
  public getEntriesSinceLsn(afterLsn: number): CausalWalEntry[] {
    const result: CausalWalEntry[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const entry = this.slots[idx];
      if (entry && entry.lsn > afterLsn) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * 현재 최신 LSN 번호 반환 (기록된 엔트리가 없으면 0)
   */
  public getCurrentLsn(): number {
    return this.nextLsn - 1;
  }

  /**
   * 링 버퍼에 남아 있는 가장 오래된 LSN 번호 반환
   */
  public getOldestLsn(): number {
    if (this.count === 0) return 0;
    return this.lsnBuffer[this.head];
  }

  /**
   * 링 버퍼 실시간 통계 반환
   */
  public getStats(): RingBufferStats {
    return {
      capacity: this.capacity,
      size: this.count,
      currentLsn: this.getCurrentLsn(),
      oldestLsn: this.getOldestLsn(),
      overwrittenCount: this.overwrittenCount,
      utilizationRatio: Number((this.count / this.capacity).toFixed(4)),
    };
  }

  /**
   * 링 버퍼 전체 슬롯 O(1) 리셋
   */
  public clear(): void {
    this.slots.fill(undefined);
    this.lsnBuffer.fill(0);
    this.tsBuffer.fill(0);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.nextLsn = 1;
    this.overwrittenCount = 0;
  }
}
