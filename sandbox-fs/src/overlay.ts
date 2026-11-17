/**
 * Synapse-Sandbox-FS: 에이전트용 가상 Copy-on-Write 오버레이 파일시스템
 * - 실제 디스크를 건드리지 않고 메모리 레이어에서 파일 생성·수정·삭제를 시뮬레이션
 * - 검증 통과 시에만 실제 디스크에 원자적 커밋, 실패 시 0ms 롤백
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const SANDBOX_FS_CONFIG = {
  MAX_OVERLAY_FILES: 10_000,
} as const;

export interface OverlayFileDiff {
  readonly path: string;
  readonly action: "create" | "modify" | "delete";
}

export class SandboxOverlayFS {
  private readonly rootDir: string;
  private readonly writes = new Map<string, string>();
  private readonly deletes = new Set<string>();

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  private resolveSafePath(relPath: string): string {
    const abs = resolve(this.rootDir, relPath);
    if (!abs.startsWith(this.rootDir)) {
      throw new Error(`[Synapse-Sandbox-FS] 루트 디렉터리 외부 경로 접근 차단: ${relPath}`);
    }
    return abs;
  }

  public writeFile(relPath: string, content: string): void {
    if (this.writes.size >= SANDBOX_FS_CONFIG.MAX_OVERLAY_FILES) {
      throw new Error(`[Synapse-Sandbox-FS] 최대 오버레이 파일 수(${SANDBOX_FS_CONFIG.MAX_OVERLAY_FILES}) 초과`);
    }
    const abs = this.resolveSafePath(relPath);
    this.deletes.delete(abs);
    this.writes.set(abs, content);
  }

  public deleteFile(relPath: string): void {
    const abs = this.resolveSafePath(relPath);
    this.writes.delete(abs);
    this.deletes.add(abs);
  }

  public exists(relPath: string): boolean {
    const abs = this.resolveSafePath(relPath);
    if (this.deletes.has(abs)) return false;
    if (this.writes.has(abs)) return true;
    return existsSync(abs);
  }

  public readFile(relPath: string): string {
    const abs = this.resolveSafePath(relPath);
    if (this.deletes.has(abs)) {
      throw new Error(`[Synapse-Sandbox-FS] 삭제 마킹된 파일입니다: ${relPath}`);
    }
    const overlay = this.writes.get(abs);
    if (overlay !== undefined) return overlay;
    return readFileSync(abs, "utf-8");
  }

  public diff(): OverlayFileDiff[] {
    const diffs: OverlayFileDiff[] = [];
    for (const abs of this.writes.keys()) {
      diffs.push({
        path: abs,
        action: existsSync(abs) ? "modify" : "create",
      });
    }
    for (const abs of this.deletes) {
      if (existsSync(abs)) {
        diffs.push({ path: abs, action: "delete" });
      }
    }
    return diffs;
  }

  /**
   * 검증 통과 후 실제 디스크에 일괄 커밋
   */
  public commitToDisk(): { committedWrites: number; committedDeletes: number } {
    let committedWrites = 0;
    let committedDeletes = 0;

    for (const [abs, content] of this.writes.entries()) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf-8");
      committedWrites++;
    }
    for (const abs of this.deletes) {
      if (existsSync(abs)) {
        rmSync(abs, { force: true });
        committedDeletes++;
      }
    }

    this.writes.clear();
    this.deletes.clear();
    return { committedWrites, committedDeletes };
  }

  /**
   * 0ms 즉시 롤백 (실디스크 변경 없음)
   */
  public rollback(): void {
    this.writes.clear();
    this.deletes.clear();
  }
}
