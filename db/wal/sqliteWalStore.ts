/**
 * SQLite WAL 영속성 및 무손실 크래시 복구 스토리지 엔진 (SQLite Causal-WAL Store)
 * - bun:sqlite 네이티브 바인딩 + PRAGMA journal_mode = WAL + mmap 제로-카피 페이징
 * - 비정상 강제 종료 후 재기동 시 WAL 로그 리플레이를 통한 100% 무손실 커넥톰 복구 보장
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import {
  CausalWalEventType,
  WAL_CONFIG_DEFAULTS,
} from "./config";
import type { CausalWalEntry } from "./ringBuffer";

interface SqliteWalRow {
  lsn: number;
  timestamp_ms: number;
  event_type: string;
  collection: string;
  doc_id: string;
  prev_doc_json: string | null;
  next_doc_json: string | null;
  edges_added_json: string;
  edges_removed_json: string;
  compiler_metric_json: string | null;
}

export class SqliteCausalWalStore {
  public readonly dbPath: string;
  private sqlite: Database | null = null;
  private insertStmt: ReturnType<Database["prepare"]> | null = null;
  private batchTx: ((items: readonly CausalWalEntry[]) => number) | null = null;
  private totalFlushedSinceCheckpoint = 0;
  private lastFlushedLsn = 0;

  constructor(
    dbPath: string,
    private readonly syncMode: "NORMAL" | "FULL" | "OFF" = WAL_CONFIG_DEFAULTS.SQLITE_SYNC_MODE
  ) {
    this.dbPath = resolve(dbPath);
  }

  /**
   * SQLite 데이터베이스 초기화 및 WAL / mmap PRAGMA 활성화
   */
  public init(): void {
    if (this.sqlite) return;

    try {
      const parentDir = dirname(this.dbPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      this.sqlite = new Database(this.dbPath, { create: true });

      // 시냅스 고성능 PRAGMA 구성: WAL 모드 + OS 가상 메모리 mmap 제로-카피 매핑
      this.sqlite.exec(`PRAGMA journal_mode = WAL;`);
      this.sqlite.exec(`PRAGMA synchronous = ${this.syncMode};`);
      this.sqlite.exec(`PRAGMA temp_store = MEMORY;`);
      this.sqlite.exec(`PRAGMA mmap_size = ${WAL_CONFIG_DEFAULTS.SQLITE_MMAP_SIZE_BYTES};`);
      this.sqlite.exec(`PRAGMA busy_timeout = ${WAL_CONFIG_DEFAULTS.SQLITE_BUSY_TIMEOUT_MS};`);

      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS causal_wal_log (
          lsn INTEGER PRIMARY KEY,
          timestamp_ms INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          collection TEXT NOT NULL,
          doc_id TEXT NOT NULL,
          prev_doc_json TEXT,
          next_doc_json TEXT,
          edges_added_json TEXT NOT NULL,
          edges_removed_json TEXT NOT NULL,
          compiler_metric_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_causal_wal_ts ON causal_wal_log(timestamp_ms);
        CREATE INDEX IF NOT EXISTS idx_causal_wal_doc ON causal_wal_log(collection, doc_id);
      `);

      const maxRow = this.sqlite
        .query(`SELECT MAX(lsn) as max_lsn FROM causal_wal_log`)
        .get() as { max_lsn: number | null } | null;
      this.lastFlushedLsn = maxRow?.max_lsn ?? 0;

      // Prepared Statement 및 원자적 배치 트랜잭션 사전 컴파일 캐싱 (매 호출 시 재컴파일 오버헤드 제거)
      const stmt = this.sqlite.prepare(`
        INSERT OR REPLACE INTO causal_wal_log (
          lsn, timestamp_ms, event_type, collection, doc_id,
          prev_doc_json, next_doc_json, edges_added_json, edges_removed_json, compiler_metric_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.insertStmt = stmt;
      this.batchTx = this.sqlite.transaction((items: readonly CausalWalEntry[]) => {
        let written = 0;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.lsn <= this.lastFlushedLsn) continue;
          stmt.run(
            item.lsn,
            item.timestampMs,
            item.eventType,
            item.collection,
            item.docId,
            item.prevDoc ? JSON.stringify(item.prevDoc) : null,
            item.nextDoc ? JSON.stringify(item.nextDoc) : null,
            item.edgesAdded.length === 0 ? "[]" : JSON.stringify(item.edgesAdded),
            item.edgesRemoved.length === 0 ? "[]" : JSON.stringify(item.edgesRemoved),
            item.compilerMetric ? JSON.stringify(item.compilerMetric) : null
          );
          if (item.lsn > this.lastFlushedLsn) {
            this.lastFlushedLsn = item.lsn;
          }
          written++;
        }
        return written;
      });
    } catch (err: any) {
      throw new Error(
        `[SqliteCausalWalStore] SQLite WAL 초기화 실패 (${this.dbPath}): ${err?.message || err}`
      );
    }
  }

  /**
   * WAL 엔트리 배치를 사전 컴파일된 단일 원자적 트랜잭션으로 SQLite WAL에 영속화
   */
  public flushEntries(entries: readonly CausalWalEntry[]): number {
    if (!this.sqlite || !this.batchTx || entries.length === 0) return 0;

    try {
      const written = this.batchTx(entries);
      this.totalFlushedSinceCheckpoint += written;
      if (this.totalFlushedSinceCheckpoint >= 1000) {
        this.checkpoint('TRUNCATE');
      }
      return written;
    } catch (err: any) {
      throw new Error(
        `[SqliteCausalWalStore] WAL 엔트리 배치 플러시 실패: ${err?.message || err}`
      );
    }
  }

  /**
   * SQLite WAL 체크포인트 수동 또는 자동 실행 (TRUNCATE 모드로 WAL 파일 0바이트 회수)
   */
  public checkpoint(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'TRUNCATE'): void {
    if (!this.sqlite) return;
    try {
      this.sqlite.exec(`PRAGMA wal_checkpoint(${mode});`);
      this.totalFlushedSinceCheckpoint = 0;
    } catch {
      // 체크포인트 실패가 메인 파이프라인을 방해하지 않도록 보호
    }
  }

  /**
   * 디스크에 영속화된 전체 WAL 엔트리 로드 (크래시 복구 및 링 버퍼 재구성용)
   */
  public loadAllEntries(): CausalWalEntry[] {
    if (!this.sqlite) return [];

    try {
      const rows = this.sqlite
        .query(`SELECT * FROM causal_wal_log ORDER BY lsn ASC`)
        .all() as SqliteWalRow[];

      return rows.map((row) => ({
        lsn: row.lsn,
        timestampMs: row.timestamp_ms,
        eventType: row.event_type as CausalWalEventType,
        collection: row.collection,
        docId: row.doc_id,
        prevDoc: row.prev_doc_json ? JSON.parse(row.prev_doc_json) : null,
        nextDoc: row.next_doc_json ? JSON.parse(row.next_doc_json) : null,
        edgesAdded: JSON.parse(row.edges_added_json),
        edgesRemoved: JSON.parse(row.edges_removed_json),
        compilerMetric: row.compiler_metric_json
          ? JSON.parse(row.compiler_metric_json)
          : undefined,
      }));
    } catch (err: any) {
      throw new Error(
        `[SqliteCausalWalStore] WAL 복구 로그 로드 실패: ${err?.message || err}`
      );
    }
  }

  /**
   * 현재 활성화된 journal_mode 조회 (WAL 검증용)
   */
  public getJournalMode(): string {
    if (!this.sqlite) return "closed";
    const row = this.sqlite.query(`PRAGMA journal_mode;`).get() as {
      journal_mode: string;
    } | null;
    return row?.journal_mode ?? "unknown";
  }

  /**
   * 마지막으로 디스크에 플러시된 LSN 번호
   */
  public getLastFlushedLsn(): number {
    return this.lastFlushedLsn;
  }

  /**
   * 저장된 총 WAL 레코드 수
   */
  public getPersistedCount(): number {
    if (!this.sqlite) return 0;
    const row = this.sqlite
      .query(`SELECT COUNT(*) as cnt FROM causal_wal_log`)
      .get() as { cnt: number } | null;
    return row?.cnt ?? 0;
  }

  /**
   * WAL 체크포인트 강제 실행 및 파일 핸들 안전 해제 (Windows EBUSY 잠금 방지)
   */
  public close(): void {
    if (!this.sqlite) return;
    try {
      this.insertStmt?.finalize();
    } catch {}
    this.insertStmt = null;
    this.batchTx = null;
    try {
      this.sqlite.exec(`PRAGMA wal_checkpoint(TRUNCATE);`);
    } catch {}
    try {
      this.sqlite.close();
    } catch {}
    this.sqlite = null;
  }
}
