/**
 * 시냅스 Copy-on-Write WAL 브랜치 매니저 (Branchable WAL for Agentic Memory)
 * - arXiv:2609.01818 (Zeta-Lite) 기반 다중 에이전트 격리 실험 분기/병합/롤백 지원
 */
import { SynapseConnectome } from "../connectome";
import type { SynapseDocument } from "../types";

export const WAL_BRANCH_CONFIG = {
  MAX_BRANCHES: 128,
  DEFAULT_BASE_BRANCH: "main",
} as const;

export interface WalBranchSnapshot {
  readonly name: string;
  readonly baseLsn: number;
  readonly createdAtMs: number;
  readonly connectome: SynapseConnectome;
  readonly upserts: Map<string, SynapseDocument>;
  readonly deletes: Set<string>;
}

export interface WalBranchSummary {
  readonly name: string;
  readonly baseLsn: number;
  readonly createdAtMs: number;
  readonly upsertsCount: number;
  readonly deletesCount: number;
}

export interface WalBranchMergeResult {
  readonly branchName: string;
  readonly mergedUpserts: number;
  readonly mergedDeletes: number;
}

/**
 * Copy-on-Write 인메모리 커넥톰 브랜치 관리자
 */
export class WalBranchManager {
  private readonly branches = new Map<string, WalBranchSnapshot>();

  /**
   * 현재 커넥톰과 LSN을 기준으로 격리 브랜치 포크(Fork)
   */
  public fork(
    branchName: string,
    baseLsn: number,
    sourceConnectome: SynapseConnectome
  ): WalBranchSnapshot {
    const cleanName = branchName.trim();
    if (!cleanName) {
      throw new Error("[WalBranchManager] 브랜치 이름은 비어 있을 수 없습니다.");
    }
    if (this.branches.has(cleanName)) {
      throw new Error(`[WalBranchManager] 이미 존재하는 브랜치입니다: ${cleanName}`);
    }
    if (this.branches.size >= WAL_BRANCH_CONFIG.MAX_BRANCHES) {
      throw new Error(
        `[WalBranchManager] 최대 브랜치 개수(${WAL_BRANCH_CONFIG.MAX_BRANCHES})를 초과했습니다.`
      );
    }

    const cloned = new SynapseConnectome();
    for (const doc of sourceConnectome.getAllDocuments()) {
      cloned.putDocument(doc);
    }

    const snapshot: WalBranchSnapshot = {
      name: cleanName,
      baseLsn,
      createdAtMs: Date.now(),
      connectome: cloned,
      upserts: new Map(),
      deletes: new Set(),
    };
    this.branches.set(cleanName, snapshot);
    return snapshot;
  }

  /**
   * 특정 브랜치에 문서 쓰기 (부모 커넥톰 미오염)
   */
  public writeDocument(branchName: string, doc: SynapseDocument): void {
    const branch = this.requireBranch(branchName);
    const key = SynapseConnectome.makeNodeId(doc.collection, doc.id);
    branch.deletes.delete(key);
    branch.upserts.set(key, doc);
    branch.connectome.putDocument(doc);
  }

  /**
   * 특정 브랜치에서 문서 삭제
   */
  public deleteDocument(branchName: string, collection: string, id: string): boolean {
    const branch = this.requireBranch(branchName);
    const key = SynapseConnectome.makeNodeId(collection, id);
    branch.upserts.delete(key);
    branch.deletes.add(key);
    return branch.connectome.removeDocument(collection, id);
  }

  /**
   * 브랜치 변경분을 대상(메인) 커넥톰으로 원자적 병합 후 브랜치 정리
   */
  public mergeInto(
    branchName: string,
    targetConnectome: SynapseConnectome,
    dropAfterMerge = true
  ): WalBranchMergeResult {
    const branch = this.requireBranch(branchName);
    let mergedUpserts = 0;
    let mergedDeletes = 0;

    for (const doc of branch.upserts.values()) {
      targetConnectome.putDocument(doc);
      mergedUpserts++;
    }
    for (const key of branch.deletes) {
      const slashIdx = key.indexOf("/");
      if (slashIdx > 0) {
        const col = key.slice(0, slashIdx);
        const id = key.slice(slashIdx + 1);
        if (targetConnectome.removeDocument(col, id)) {
          mergedDeletes++;
        }
      }
    }

    if (dropAfterMerge) {
      this.branches.delete(branchName);
    }

    return {
      branchName,
      mergedUpserts,
      mergedDeletes,
    };
  }

  /**
   * 브랜치 폐기 (롤백)
   */
  public drop(branchName: string): boolean {
    return this.branches.delete(branchName);
  }

  /**
   * 브랜치 커넥톰 조회
   */
  public getBranch(branchName: string): WalBranchSnapshot | null {
    return this.branches.get(branchName) ?? null;
  }

  /**
   * 활성 브랜치 목록 요약
   */
  public listBranches(): WalBranchSummary[] {
    const list: WalBranchSummary[] = [];
    for (const b of this.branches.values()) {
      list.push({
        name: b.name,
        baseLsn: b.baseLsn,
        createdAtMs: b.createdAtMs,
        upsertsCount: b.upserts.size,
        deletesCount: b.deletes.size,
      });
    }
    return list;
  }

  private requireBranch(branchName: string): WalBranchSnapshot {
    const branch = this.branches.get(branchName);
    if (!branch) {
      throw new Error(`[WalBranchManager] 존재하지 않는 브랜치입니다: ${branchName}`);
    }
    return branch;
  }
}
