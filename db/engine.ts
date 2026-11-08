/**
 * 범용 마크다운 시냅스 엔진 (Synapse Engine Core)
 * 디스크 상의 마크다운 볼트와 인메모리 시냅스 커넥톰 간의 완전 동기화 및 생명주기 관리
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, watch } from "node:fs";
import { basename, join, resolve } from "node:path";
import { SynapseConnectome } from "./connectome";
import { parseMarkdownFile, stringifyDocument, atomicWriteFile } from "./serializer";
import type {
  SynapseDBConfig,
  SynapseDocument,
  SynapseDocumentInput,
  SynapseDBStats,
} from "./types";

export class SynapseEngine {
  public readonly vaultDir: string;
  public readonly connectome: SynapseConnectome;
  public readonly config: SynapseDBConfig;

  private isInitialized = false;
  private pendingWriteQueue = new Map<string, () => void>();
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
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
  }

  /**
   * 볼트 디렉터리 초기화 및 기존 마크다운 파일 전체 로드
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;

    if (!existsSync(this.vaultDir)) {
      mkdirSync(this.vaultDir, { recursive: true });
    }

    // 1. 전체 디스크 볼트 스캔 및 인메모리 커넥톰 적재
    this.reloadVault();

    // 2. 외부 마크다운 파일 수정 감시자(File Watcher) 가동
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
      if (entry.isDirectory()) {
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
   * 문서 저장 (인메모리 즉시 반영 + 디바운스 원자적 디스크 쓰기)
   */
  public async saveDocument<TData = Record<string, any>>(
    collection: string,
    input: SynapseDocumentInput<TData>
  ): Promise<SynapseDocument<TData>> {
    const now = new Date().toISOString();
    const existing = this.connectome.getDocument<TData>(collection, input.id);

    const createdAt = input.createdAt || existing?.createdAt || now;
    const updatedAt = input.updatedAt || now;
    const cleanBody = (input.body || "").replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "");

    // 직렬화 및 위키링크 자동 재추출
    const rawMarkdown = stringifyDocument(
      {
        ...(input.data as Record<string, any>),
        _createdAt: createdAt,
        _updatedAt: updatedAt,
      },
      cleanBody
    );

    const parsed = parseMarkdownFile<Record<string, any>>(rawMarkdown, collection);
    const restoredFm = { ...parsed.frontmatter };
    delete restoredFm._createdAt;
    delete restoredFm._updatedAt;

    const finalDoc: SynapseDocument<TData> = {
      id: input.id,
      collection,
      data: restoredFm as TData,
      body: parsed.body,
      createdAt,
      updatedAt,
      wikilinks: parsed.wikilinks,
    };

    // 1. 인메모리 커넥톰 즉시 갱신 (0ms 지연)
    this.connectome.putDocument(finalDoc);

    // 2. 비동기 원자적 디스크 쓰기 예약
    const safeCol = collection.replace(/[\/\\:*?"<>|]/g, "_");
    const safeId = input.id.replace(/[\/\\:*?"<>|]/g, "_");
    const targetDir = join(this.vaultDir, safeCol);
    const targetPath = join(targetDir, `${safeId}.md`);

    const writeKey = `${collection}/${input.id}`;
    this.scheduleWrite(writeKey, () => {
      this.markInternalWrite();
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
    const deleted = this.connectome.removeDocument(collection, id);
    if (!deleted) return false;

    const safeCol = collection.replace(/[\/\\:*?"<>|]/g, "_");
    const safeId = id.replace(/[\/\\:*?"<>|]/g, "_");
    const targetPath = join(this.vaultDir, safeCol, `${safeId}.md`);

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
   * 비동기 디바운스 디스크 쓰기 예약
   */
  private scheduleWrite(key: string, fn: () => void): void {
    this.pendingWriteQueue.set(key, fn);

    if (this.writeTimer) clearTimeout(this.writeTimer);
    const debounceMs = this.config.persistDebounceMs || 100;
    this.writeTimer = setTimeout(() => {
      this.flushPendingWrites();
    }, debounceMs);
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
  }
}
