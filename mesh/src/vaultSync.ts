/**
 * 분산 마크다운 볼트 실시간 양방향 동기화기 (Distributed Vault Synchronizer)
 * - SHA-256 해시 기반 변경 감지 및 LWW (Last-Write-Wins) 타임스탬프 충돌 해결
 * - 원자적 파일 치환을 통한 무손실 분산 볼트 미러링
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { VaultFileMetadata, VaultSyncDelta, VaultSyncManifest } from "./types";

export class DistributedVaultSynchronizer {
  public readonly vaultDir: string;

  constructor(vaultDir: string) {
    this.vaultDir = resolve(vaultDir);
    if (!existsSync(this.vaultDir)) {
      mkdirSync(this.vaultDir, { recursive: true });
    }
  }

  /**
   * 볼트 디렉터리 내 전체 마크다운 파일 스캔 및 해시 매니페스트 생성
   */
  public generateManifest(nodeId: string): VaultSyncManifest {
    const files: Record<string, VaultFileMetadata> = {};
    this.scanDir(this.vaultDir, files);

    return {
      nodeId,
      timestampMs: Date.now(),
      files,
    };
  }

  private scanDir(dir: string, result: Record<string, VaultFileMetadata>): void {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.includes(".tmp")) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        this.scanDir(fullPath, result);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const content = readFileSync(fullPath);
          const stat = statSync(fullPath);
          const relPath = relative(this.vaultDir, fullPath).replace(/\\/g, "/");
          const hash = createHash("sha256").update(content).digest("hex");

          result[relPath] = {
            relativePath: relPath,
            hash,
            updatedAtMs: stat.mtimeMs,
            sizeBytes: stat.size,
          };
        } catch {}
      }
    }
  }

  /**
   * 로컬 매니페스트와 원격 매니페스트 비교하여 전송/수신 델타 계산
   * LWW (Last-Write-Wins) 알고리즘 적용
   */
  public computeDelta(
    localManifest: VaultSyncManifest,
    remoteManifest: VaultSyncManifest
  ): VaultSyncDelta {
    const toPull: string[] = [];
    const toPush: string[] = [];
    const conflictsResolved: { path: string; winningSource: "LOCAL" | "REMOTE"; reason: string }[] = [];

    const allKeys = new Set([
      ...Object.keys(localManifest.files),
      ...Object.keys(remoteManifest.files),
    ]);

    for (const path of allKeys) {
      const localFile = localManifest.files[path];
      const remoteFile = remoteManifest.files[path];

      if (!localFile && remoteFile) {
        // 원격에만 존재하는 파일 ➔ Pull
        toPull.push(path);
      } else if (localFile && !remoteFile) {
        // 로컬에만 존재하는 파일 ➔ Push
        toPush.push(path);
      } else if (localFile && remoteFile) {
        // 양쪽 모두 존재하지만 내용 해시가 다른 경우
        if (localFile.hash !== remoteFile.hash) {
          if (localFile.updatedAtMs > remoteFile.updatedAtMs) {
            toPush.push(path);
            conflictsResolved.push({
              path,
              winningSource: "LOCAL",
              reason: `로컬 수정시각(${localFile.updatedAtMs})이 원격(${remoteFile.updatedAtMs})보다 최신`,
            });
          } else if (remoteFile.updatedAtMs > localFile.updatedAtMs) {
            toPull.push(path);
            conflictsResolved.push({
              path,
              winningSource: "REMOTE",
              reason: `원격 수정시각(${remoteFile.updatedAtMs})이 로컬(${localFile.updatedAtMs})보다 최신`,
            });
          } else {
            // 수정 시각이 완벽히 동일할 경우 해시 사전순으로 결정론적(Deterministic) 해결
            if (localFile.hash > remoteFile.hash) {
              toPush.push(path);
              conflictsResolved.push({
                path,
                winningSource: "LOCAL",
                reason: "수정시각 동일, 로컬 해시 우선순위 결정론적 선택",
              });
            } else {
              toPull.push(path);
              conflictsResolved.push({
                path,
                winningSource: "REMOTE",
                reason: "수정시각 동일, 원격 해시 우선순위 결정론적 선택",
              });
            }
          }
        }
      }
    }

    return { toPull, toPush, conflictsResolved };
  }

  /**
   * 단일 파일 원자적 저장
   */
  public writeVaultFile(relativePath: string, content: string): void {
    const targetPath = join(this.vaultDir, relativePath);
    const parentDir = dirname(targetPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    const tmpPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      writeFileSync(tmpPath, content, "utf-8");
      renameSync(tmpPath, targetPath);
    } catch (err) {
      if (existsSync(tmpPath)) {
        try {
          unlinkSync(tmpPath);
        } catch {}
      }
      throw err;
    }
  }

  /**
   * 단일 파일 내용 읽기
   */
  public readVaultFile(relativePath: string): string | null {
    const targetPath = join(this.vaultDir, relativePath);
    if (!existsSync(targetPath)) return null;
    return readFileSync(targetPath, "utf-8");
  }

  /**
   * 단일 파일 삭제
   */
  public deleteVaultFile(relativePath: string): boolean {
    const targetPath = join(this.vaultDir, relativePath);
    if (!existsSync(targetPath)) return false;
    try {
      unlinkSync(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
