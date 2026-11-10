/**
 * 범용 마크다운 시냅스 엔진 (Synapse Engine Core)
 * 디스크 상의 마크다운 볼트와 인메모리 시냅스 커넥톰 간의 완전 동기화 및 생명주기 관리
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, watch } from "node:fs";
import { basename, join, resolve } from "node:path";
import { SynapseConnectome } from "./connectome";
import {
  parseMarkdownFile,
  stringifyDocument,
  atomicWriteFile,
  extractWikilinksFromDataAndBody,
} from "./serializer";
import { CausalWalEngine, CausalWalEventType } from "./wal";
import type {
  SynapseDBConfig,
  SynapseDocument,
  SynapseDocumentInput,
  SynapseDBStats,
} from "./types";

export class SynapseEngine {
  public readonly vaultDir: string;
  public readonly connectome: SynapseConnectome;
  public readonly wal: CausalWalEngine;
  public readonly config: SynapseDBConfig;

  private isInitialized = false;
  private pendingWriteQueue = new Map<string, () => void>();
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private nextTimerFlushAtMs = 0;
  private cachedIsoMs = -1;
  private cachedIsoStr = "";
  private watcherDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private internalWriteResetTimer: ReturnType<typeof setTimeout> | null = null;
  private fileWatcher: ReturnType<typeof watch> | null = null;
  private isWritingInternally = false;

  constructor(config: SynapseDBConfig) {
    this.config = {
      autoWatch: true,
      persistDebounceMs: 100,
      ...config,
      vaultDir: resolve(config.vaultDir),
    };
    this.vaultDir = this.config.vaultDir;
    this.connectome = new SynapseConnectome();
    this.wal = new CausalWalEngine(this.vaultDir, this.config.wal);
  }

  /**
   * 볼트 디렉터리 초기화 및 기존 마크다운 파일 전체 로드 + SQLite WAL 크래시 복구
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;

    if (!existsSync(this.vaultDir)) {
      mkdirSync(this.vaultDir, { recursive: true });
    }

    // 1. 전체 디스크 볼트 스캔 및 인메모리 커넥톰 적재
    this.reloadVault();

    // 2. SQLite Causal-WAL 활성화 시 미반영 로그 자동 리플레이 복구
    this.wal.initAndRecover(this.connectome);

    // 3. 외부 마크다운 파일 수정 감시자(File Watcher) 가동
    if (this.config.autoWatch) {
      this.startWatcher();
    }

    this.isInitialized = true;
  }

  /**
   * 볼트 내 모든 컬렉션과 마크다운 파일을 재스캔하여 커넥톰 구축
   */
  public reloadVault(): void {
    this.connectome.clear();

    if (!existsSync(this.vaultDir)) return;

    const entries = readdirSync(this.vaultDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const collectionName = entry.name;
        const colPath = join(this.vaultDir, collectionName);
        this.loadCollectionDir(collectionName, colPath);
      }
    }
  }

  /**
   * 단일 컬렉션 디렉터리 내 .md 파일들을 순회 로드
   */
  private loadCollectionDir(collectionName: string, dirPath: string): void {
    try {
      const files = readdirSync(dirPath);
      for (const file of files) {
        if (!file.endsWith(".md") || file.includes(".tmp")) continue;

        const id = basename(file, ".md");
        const fullPath = join(dirPath, file);
        try {
          const raw = readFileSync(fullPath, "utf-8");
          const parsed = parseMarkdownFile<Record<string, any>>(raw, collectionName);

          const rawFm = { ...parsed.frontmatter };
          const createdAt =
            typeof rawFm._createdAt === "string"
              ? rawFm._createdAt
              : typeof rawFm.createdAt === "string"
                ? rawFm.createdAt
                : new Date().toISOString();
          const updatedAt =
            typeof rawFm._updatedAt === "string"
              ? rawFm._updatedAt
              : typeof rawFm.updatedAt === "string"
                ? rawFm.updatedAt
                : new Date().toISOString();

          delete rawFm._createdAt;
          delete rawFm._updatedAt;

          const doc: SynapseDocument = {
            id,
            collection: collectionName,
            data: rawFm,
            body: parsed.body,
            createdAt,
            updatedAt,
            wikilinks: parsed.wikilinks,
          };

          this.connectome.putDocument(doc);
        } catch (err: any) {
          process.stderr.write(`[SynapseEngine] 파일 로드 실패 (${file}): ${err?.message || err}\n`);
        }
      }
    } catch {}
  }

  /**
   * 트랜잭션 아레나 스코프 내부일 경우 스테이징된 최신 문서를 우선 조회
   */
  private getEffectiveDocument<TData = any>(
    collection: string,
    id: string
  ): SynapseDocument<TData> | null {
    if (this.wal.arena.isScopeActive()) {
      const slots = this.wal.arena.getActiveSlots();
      for (let i = slots.length - 1; i >= 0; i--) {
        const slot = slots[i];
        if (slot.collection === collection && slot.docId === id) {
          if (slot.eventType === CausalWalEventType.DOC_DELETE) return null;
          if (slot.eventType === CausalWalEventType.DOC_UPSERT) {
            return (slot.nextDoc as SynapseDocument<TData>) || null;
          }
        }
      }
    }
    return this.connectome.getDocument<TData>(collection, id);
  }

  private isValidSafeIdentifier(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (
        code === 47 || // /
        code === 92 || // \
        code === 58 || // :
        code === 42 || // *
        code === 63 || // ?
        code === 34 || // "
        code === 60 || // <
        code === 62 || // >
        code === 124   // |
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * 동일 밀리초 내 Date.toISOString() 반복 문자열 할당을 제거하는 O(1) 시계열 타임스탬프 생성기
   */
  private getNowIso(nowMs: number): string {
    if (nowMs === this.cachedIsoMs) {
      return this.cachedIsoStr;
    }
    this.cachedIsoMs = nowMs;
    this.cachedIsoStr = new Date(nowMs).toISOString();
    return this.cachedIsoStr;
  }

  /**
   * 문서 저장 (Causal-WAL 링 버퍼 기록 + 인메모리 즉시 반영 + 지연(Lazy) 직렬화 원자적 디스크 쓰기)
   */
  public async saveDocument<TData = Record<string, any>>(
    collection: string,
    input: SynapseDocumentInput<TData>
  ): Promise<SynapseDocument<TData>> {
    const nowMs = Date.now();
    const now = this.getNowIso(nowMs);
    const existing = this.getEffectiveDocument<TData>(collection, input.id);

    const createdAt = input.createdAt || existing?.createdAt || now;
    const updatedAt = input.updatedAt || now;
    const rawBody = input.body || "";
    const cleanBody =
      rawBody.length > 0 &&
      (rawBody.includes("\r") || rawBody.charCodeAt(0) === 10 || rawBody.charCodeAt(rawBody.length - 1) === 10)
        ? rawBody.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "")
        : rawBody;

    // 쓰기 핫패스에서 YAML 문자열 직렬화/역파싱 왕복을 완전히 제거하고 메모리에서 직접 위키링크 추출
    const wikilinks = extractWikilinksFromDataAndBody(
      input.data as Record<string, any>,
      cleanBody,
      collection
    );

    const finalDoc: SynapseDocument<TData> = {
      id: input.id,
      collection,
      data: input.data,
      body: cleanBody,
      createdAt,
      updatedAt,
      wikilinks,
    };

    const safeCol = this.isValidSafeIdentifier(collection)
      ? collection
      : collection.replace(/[\/\\:*?"<>|]/g, "_");
    const safeId = this.isValidSafeIdentifier(input.id)
      ? input.id
      : input.id.replace(/[\/\\:*?"<>|]/g, "_");
    const targetPath = `${this.vaultDir}/${safeCol}/${safeId}.md`;

    // 1. Causal-WAL 기록 (아레나 트랜잭션 활성 시 아레나 슬롯에만 스테이징하고 커넥톰 반영 보류)
    this.wal.recordDocumentUpsert(existing, finalDoc, null, targetPath, nowMs);

    if (this.wal.arena.isScopeActive()) {
      return finalDoc;
    }

    // 2. 인메모리 커넥톰 즉시 갱신 (0ms 지연, 검색 토큰은 Lazy 마킹)
    this.connectome.putDocument(finalDoc);

    // 3. 비동기 원자적 디스크 쓰기 예약 (실제 디스크 플러시 시점에만 YAML 직렬화 수행)
    const writeKey = `${collection}/${input.id}`;
    this.scheduleWrite(writeKey, nowMs, () => {
      this.markInternalWrite();
      const rawMarkdown = stringifyDocument(
        {
          ...(finalDoc.data as Record<string, any>),
          _createdAt: finalDoc.createdAt,
          _updatedAt: finalDoc.updatedAt,
        },
        finalDoc.body
      );
      atomicWriteFile(targetPath, rawMarkdown);
    });

    return finalDoc;
  }

  /**
   * 내부 디스크 쓰기 플래그 설정 (워처 루프백 방지)
   */
  private markInternalWrite(): void {
    this.isWritingInternally = true;
    if (this.internalWriteResetTimer) {
      clearTimeout(this.internalWriteResetTimer);
    }
    this.internalWriteResetTimer = setTimeout(() => {
      this.isWritingInternally = false;
      this.internalWriteResetTimer = null;
    }, 120);
  }

  /**
   * 문서 삭제
   */
  public async deleteDocument(collection: string, id: string): Promise<boolean> {
    const existing = this.getEffectiveDocument(collection, id);
    if (!existing) return false;

    const safeCol = collection.replace(/[\/\\:*?"<>|]/g, "_");
    const safeId = id.replace(/[\/\\:*?"<>|]/g, "_");
    const targetPath = join(this.vaultDir, safeCol, `${safeId}.md`);

    // 1. Causal-WAL 삭제 이벤트 기록
    this.wal.recordDocumentDelete(existing, targetPath);

    if (this.wal.arena.isScopeActive()) {
      return true;
    }

    const deleted = this.connectome.removeDocument(collection, id);
    if (!deleted) return false;

    const writeKey = `${collection}/${id}`;
    this.pendingWriteQueue.delete(writeKey);

    try {
      if (existsSync(targetPath)) {
        this.markInternalWrite();
        unlinkSync(targetPath);
      }
    } catch {}

    return true;
  }

  /**
   * 아레나 할당기 기반 원자적 트랜잭션 실행 (예외 발생 시 0ns 롤백, 성공 시 일괄 반영)
   */
  public async executeTransaction<TResult>(
    fn: () => Promise<TResult> | TResult
  ): Promise<TResult> {
    return this.wal.executeArenaTransactionAsync(fn, (slot) => {
      if (slot.eventType === CausalWalEventType.DOC_UPSERT && slot.nextDoc) {
        const committedDoc = slot.nextDoc;
        this.connectome.putDocument(committedDoc);
        if (slot.targetDiskPath) {
          const targetPath = slot.targetDiskPath;
          const writeKey = `${slot.collection}/${slot.docId}`;
          this.scheduleWrite(writeKey, Date.now(), () => {
            this.markInternalWrite();
            const rawMarkdown =
              slot.rawMarkdown ??
              stringifyDocument(
                {
                  ...(committedDoc.data as Record<string, any>),
                  _createdAt: committedDoc.createdAt,
                  _updatedAt: committedDoc.updatedAt,
                },
                committedDoc.body
              );
            atomicWriteFile(targetPath, rawMarkdown);
          });
        }
      } else if (slot.eventType === CausalWalEventType.DOC_DELETE) {
        this.connectome.removeDocument(slot.collection, slot.docId);
        const writeKey = `${slot.collection}/${slot.docId}`;
        this.pendingWriteQueue.delete(writeKey);
        if (slot.targetDiskPath) {
          try {
            if (existsSync(slot.targetDiskPath)) {
              this.markInternalWrite();
              unlinkSync(slot.targetDiskPath);
            }
          } catch {}
        }
      }
    });
  }

  /**
   * 비동기 디바운스 디스크 쓰기 예약 (커널 타이머 재등록 오버헤드 제거 Coalesced Timer)
   */
  private scheduleWrite(key: string, nowMs: number, fn: () => void): void {
    this.pendingWriteQueue.set(key, fn);

    const debounceMs = this.config.persistDebounceMs || 100;
    this.nextTimerFlushAtMs = nowMs + debounceMs;

    if (!this.writeTimer) {
      this.armWriteTimer(debounceMs);
    }
  }

  private armWriteTimer(delayMs: number): void {
    this.writeTimer = setTimeout(() => {
      const remaining = this.nextTimerFlushAtMs - Date.now();
      if (remaining > 5 && this.pendingWriteQueue.size > 0) {
        this.armWriteTimer(remaining);
        return;
      }
      this.flushPendingWrites();
    }, delayMs);
  }

  /**
   * 대기 중인 모든 디스크 쓰기 일괄 실행
   */
  public flushPendingWrites(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (this.pendingWriteQueue.size === 0) return;

    for (const [key, fn] of this.pendingWriteQueue) {
      try {
        fn();
      } catch (err: any) {
        process.stderr.write(`[SynapseEngine] 디스크 쓰기 실패 (${key}): ${err?.message || err}\n`);
      }
    }
    this.pendingWriteQueue.clear();
  }

  /**
   * 외부 마크다운 파일 수정 감시 (옵시디언 핫 리로드, 단일 디바운스 보장)
   */
  private startWatcher(): void {
    try {
      this.fileWatcher = watch(this.vaultDir, { recursive: true }, (_eventType, filename) => {
        if (!filename || !filename.endsWith(".md") || filename.includes(".tmp")) return;
        if (this.isWritingInternally) return;

        if (this.watcherDebounceTimer) {
          clearTimeout(this.watcherDebounceTimer);
        }
        this.watcherDebounceTimer = setTimeout(() => {
          this.watcherDebounceTimer = null;
          if (!this.isWritingInternally) {
            this.reloadVault();
          }
        }, 80);
      });
    } catch {}
  }

  /**
   * 전체 데이터베이스 상태 통계
   */
  public getStats(): SynapseDBStats {
    return this.connectome.getStats();
  }

  /**
   * 자원 정리
   */
  public close(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (this.watcherDebounceTimer) {
      clearTimeout(this.watcherDebounceTimer);
      this.watcherDebounceTimer = null;
    }
    if (this.internalWriteResetTimer) {
      clearTimeout(this.internalWriteResetTimer);
      this.internalWriteResetTimer = null;
    }
    this.flushPendingWrites();
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
    this.wal.close();
  }
}
