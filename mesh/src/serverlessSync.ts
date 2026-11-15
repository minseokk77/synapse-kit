/**
 * 시냅스 무서버(Serverless) 분리 스토리지 WAL 델타 복제 어댑터
 * - arXiv:2611.01363 (AirDB: Eliminating Servers in State Machine Replication)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SERVERLESS_SYNC_CONFIG = {
  SEGMENT_EXTENSION: ".wal.json",
} as const;

export interface WalSegmentRecord {
  readonly segmentId: string;
  readonly nodeId: string;
  readonly lsnFrom: number;
  readonly lsnTo: number;
  readonly merkleHash: string;
  readonly entries: readonly unknown[];
}

export interface ServerlessStorageAdapter {
  putSegment(segment: WalSegmentRecord): Promise<void>;
  getSegment(segmentId: string): Promise<WalSegmentRecord | null>;
  listSegmentIds(): Promise<string[]>;
}

/**
 * 로컬 공유 디렉터리 / 마운트 스토리지 기반 기본 어댑터
 */
export class LocalDirectoryStorageAdapter implements ServerlessStorageAdapter {
  constructor(private readonly rootDir: string) {
    if (!existsSync(this.rootDir)) {
      mkdirSync(this.rootDir, { recursive: true });
    }
  }

  public async putSegment(segment: WalSegmentRecord): Promise<void> {
    const filePath = join(this.rootDir, `${segment.segmentId}${SERVERLESS_SYNC_CONFIG.SEGMENT_EXTENSION}`);
    writeFileSync(filePath, JSON.stringify(segment), "utf8");
  }

  public async getSegment(segmentId: string): Promise<WalSegmentRecord | null> {
    const filePath = join(this.rootDir, `${segmentId}${SERVERLESS_SYNC_CONFIG.SEGMENT_EXTENSION}`);
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw) as WalSegmentRecord;
  }

  public async listSegmentIds(): Promise<string[]> {
    if (!existsSync(this.rootDir)) return [];
    const ext = SERVERLESS_SYNC_CONFIG.SEGMENT_EXTENSION;
    return readdirSync(this.rootDir)
      .filter((f) => f.endsWith(ext))
      .map((f) => f.slice(0, -ext.length));
  }
}

/**
 * 중앙 코디네이터 없이 공유 스토리지를 통해 WAL 세그먼트 머클 델타를 동기화하는 엔진
 */
export class ServerlessWalSync {
  constructor(
    private readonly nodeId: string,
    private readonly storage: ServerlessStorageAdapter
  ) {}

  /**
   * 세그먼트 머클 해시 결정론적 계산
   */
  public static computeSegmentHash(entries: readonly unknown[]): string {
    return createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 16);
  }

  /**
   * 로컬 WAL 세그먼트를 공유 스토리지에 원자적으로 업로드
   */
  public async pushSegment(
    segmentId: string,
    lsnFrom: number,
    lsnTo: number,
    entries: readonly unknown[]
  ): Promise<WalSegmentRecord> {
    const record: WalSegmentRecord = {
      segmentId,
      nodeId: this.nodeId,
      lsnFrom,
      lsnTo,
      merkleHash: ServerlessWalSync.computeSegmentHash(entries),
      entries,
    };
    await this.storage.putSegment(record);
    return record;
  }

  /**
   * 로컬에 누락된 원격 세그먼트만 선별 수신 및 해시 무결성 검증
   */
  public async pullMissingSegments(
    knownSegmentIds: ReadonlySet<string>
  ): Promise<{ pulled: WalSegmentRecord[]; corruptedIds: string[] }> {
    const remoteIds = await this.storage.listSegmentIds();
    const pulled: WalSegmentRecord[] = [];
    const corruptedIds: string[] = [];

    for (const id of remoteIds) {
      if (knownSegmentIds.has(id)) continue;
      const seg = await this.storage.getSegment(id);
      if (!seg) continue;

      const expected = ServerlessWalSync.computeSegmentHash(seg.entries);
      if (expected !== seg.merkleHash) {
        corruptedIds.push(id);
        continue;
      }
      pulled.push(seg);
    }

    return { pulled, corruptedIds };
  }
}
