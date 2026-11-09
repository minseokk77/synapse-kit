import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { CAUSAL_MEMORY_CONFIG } from './causal-config';
import { ContextCheckpointStore, type ContextCheckpoint } from './causal-context';
import { CausalGraveyardStore } from './causal-graveyard';

/**
 * 컨텍스트 브랜치 레코드 규격
 */
export interface ContextBranch {
  readonly name: string;
  readonly baseCheckpointId: string;
  readonly headCheckpointId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: 'active' | 'merged' | 'abandoned';
  readonly description?: string;
  readonly mergedInto?: string;
  readonly abandonmentReason?: string;
}

/**
 * 브랜치 데이터베이스 규격
 */
export interface BranchDatabase {
  readonly version: string;
  readonly updatedAt: string;
  readonly currentBranch: string;
  readonly branches: readonly ContextBranch[];
}

/**
 * 컨텍스트 브랜칭 및 머지 관리자 클래스 (SRP 준수)
 */
export class CausalBranchStore {
  private readonly dbPath: string;
  private readonly contextStore: ContextCheckpointStore;
  private readonly graveyardStore: CausalGraveyardStore;
  private database: BranchDatabase;
  private lastMtimeMs: number = 0;

  constructor(
    customPathOrContextStore?: string | ContextCheckpointStore,
    contextStoreOrGraveyard?: any,
    graveyardStore?: CausalGraveyardStore
  ) {
    if (typeof customPathOrContextStore === 'string') {
      this.dbPath = customPathOrContextStore;
      this.contextStore =
        contextStoreOrGraveyard instanceof ContextCheckpointStore
          ? contextStoreOrGraveyard
          : new ContextCheckpointStore();
      this.graveyardStore =
        graveyardStore ||
        (contextStoreOrGraveyard instanceof CausalGraveyardStore
          ? contextStoreOrGraveyard
          : new CausalGraveyardStore());
    } else if (customPathOrContextStore instanceof ContextCheckpointStore) {
      this.dbPath =
        process.env.SYNAPSE_BRANCH_PATH ||
        resolve(homedir(), '.gemini', 'antigravity', 'causal_branches.json');
      this.contextStore = customPathOrContextStore;
      this.graveyardStore =
        contextStoreOrGraveyard instanceof CausalGraveyardStore
          ? contextStoreOrGraveyard
          : new CausalGraveyardStore();
    } else {
      this.dbPath =
        process.env.SYNAPSE_BRANCH_PATH ||
        resolve(homedir(), '.gemini', 'antigravity', 'causal_branches.json');
      this.contextStore = new ContextCheckpointStore();
      this.graveyardStore = new CausalGraveyardStore();
    }
    this.database = this.loadDatabase();
  }

  private loadDatabase(): BranchDatabase {
    try {
      if (existsSync(this.dbPath)) {
        const stat = statSync(this.dbPath);
        this.lastMtimeMs = stat.mtimeMs;
        const raw = readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw) as BranchDatabase;
        if (parsed && Array.isArray(parsed.branches)) {
          return parsed;
        }
      }
    } catch {
      // 무시
    }

    return {
      version: CAUSAL_MEMORY_CONFIG.SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      currentBranch: 'main',
      branches: [
        {
          name: 'main',
          baseCheckpointId: 'root',
          headCheckpointId: 'root',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'active',
          description: '기본 메인 두뇌 브랜치',
        },
      ],
    };
  }

  public reloadIfNeeded(): void {
    try {
      if (existsSync(this.dbPath)) {
        const stat = statSync(this.dbPath);
        if (stat.mtimeMs > this.lastMtimeMs) {
          this.database = this.loadDatabase();
        }
      }
    } catch {
      // 무시
    }
  }

  private saveDatabase(): void {
    try {
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const serialized = JSON.stringify(this.database, null, 2);
      const tempPath = `${this.dbPath}.tmp.${process.pid}.${Date.now()}`;
      writeFileSync(tempPath, serialized, 'utf-8');
      renameSync(tempPath, this.dbPath);

      try {
        this.lastMtimeMs = statSync(this.dbPath).mtimeMs;
      } catch {
        // 무시
      }
    } catch (error) {
      throw new Error(
        `컨텍스트 브랜치 데이터베이스 저장 실패: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 신규 브랜치 분기 (Fork)
   */
  public async createBranch(name: string, options?: { baseId?: string; description?: string }): Promise<ContextBranch> {
    this.reloadIfNeeded();
    const cleanName = name.trim();
    if (!cleanName) throw new Error('브랜치 이름은 비어 있을 수 없습니다.');

    const existing = this.database.branches.find((b) => b.name === cleanName);
    if (existing && existing.status === 'active') {
      throw new Error(`이미 존재하는 활성 브랜치입니다: ${cleanName}`);
    }

    let baseCp: ContextCheckpoint | null = null;
    if (options?.baseId) {
      baseCp = this.contextStore.getCheckpoint(options.baseId);
    } else {
      baseCp = this.contextStore.getLatestCheckpoint();
    }

    const baseId = baseCp?.id || 'root';
    const nowIso = new Date().toISOString();

    // 새 브랜치용 시작 체크포인트 포크 생성
    const forkedCp = await this.contextStore.saveCheckpoint({
      sessionId: `branch-${cleanName}`,
      title: `[Branch Start] ${cleanName}`,
      goal: options?.description || `브랜치 ${cleanName} 독립 가설 검증`,
      completedSteps: baseCp?.completedSteps || [],
      pendingTasks: baseCp?.pendingTasks || [],
      keyDecisions: baseCp ? [`브랜치 ${cleanName}이 체크포인트 ${baseId}에서 분기됨`] : [],
      activeFiles: baseCp?.activeFiles || [],
      artifacts: baseCp?.artifacts || [],
      activeInvariants: baseCp?.activeInvariants || [],
      autoGit: false,
      autoResonance: false,
    });

    const newBranch: ContextBranch = {
      name: cleanName,
      baseCheckpointId: baseId,
      headCheckpointId: forkedCp.id,
      createdAt: nowIso,
      updatedAt: nowIso,
      status: 'active',
      description: options?.description,
    };

    const remaining = this.database.branches.filter((b) => b.name !== cleanName);
    this.database = {
      ...this.database,
      updatedAt: nowIso,
      currentBranch: cleanName,
      branches: [...remaining, newBranch],
    };

    this.saveDatabase();
    return newBranch;
  }

  /**
   * 활성 브랜치 전환 (Switch)
   */
  public switchBranch(name: string): ContextBranch {
    this.reloadIfNeeded();
    const clean = name.trim();
    const target = this.database.branches.find((b) => b.name === clean);
    if (!target) {
      throw new Error(`존재하지 않는 브랜치입니다: ${clean}`);
    }

    this.database = {
      ...this.database,
      updatedAt: new Date().toISOString(),
      currentBranch: clean,
    };
    this.saveDatabase();
    return target;
  }

  /**
   * 브랜치 병합 (Merge)
   * 소스 브랜치의 핵심 의사결정 및 완료 과업을 타깃 브랜치로 통합
   */
  public async mergeBranch(sourceName: string, targetName: string = 'main'): Promise<{
    mergedBranch: ContextBranch;
    resultingCheckpoint: ContextCheckpoint;
  }> {
    this.reloadIfNeeded();
    const src = this.database.branches.find((b) => b.name === sourceName.trim());
    const tgt = this.database.branches.find((b) => b.name === targetName.trim());

    if (!src) throw new Error(`소스 브랜치를 찾을 수 없습니다: ${sourceName}`);
    if (!tgt) throw new Error(`타깃 브랜치를 찾을 수 없습니다: ${targetName}`);
    if (src.status !== 'active') throw new Error(`소스 브랜치가 활성 상태가 아닙니다: ${src.status}`);

    const srcCp = this.contextStore.getCheckpoint(src.headCheckpointId);
    const tgtCp = this.contextStore.getCheckpoint(tgt.headCheckpointId);

    const mergedTitle = `[Merge] ${src.name} ➔ ${tgt.name}`;
    const mergedDecisions = Array.from(
      new Set([
        `브랜치 ${src.name}이 ${tgt.name}으로 병합 완료됨`,
        ...(tgtCp?.keyDecisions || []),
        ...(srcCp?.keyDecisions || []),
      ])
    );

    const mergedCompleted = Array.from(
      new Set([...(tgtCp?.completedSteps || []), ...(srcCp?.completedSteps || [])])
    );

    const mergedPending = Array.from(
      new Set([...(srcCp?.pendingTasks || []), ...(tgtCp?.pendingTasks || [])])
    );

    const mergedFiles = Array.from(
      new Set([...(tgtCp?.activeFiles || []), ...(srcCp?.activeFiles || [])])
    );

    const mergedInvariants = Array.from(
      new Set([...(tgtCp?.activeInvariants || []), ...(srcCp?.activeInvariants || [])])
    );

    const resultingCp = await this.contextStore.saveCheckpoint({
      sessionId: `branch-${tgt.name}`,
      title: mergedTitle,
      goal: tgtCp?.goal || srcCp?.goal || mergedTitle,
      completedSteps: mergedCompleted,
      pendingTasks: mergedPending,
      keyDecisions: mergedDecisions,
      activeFiles: mergedFiles,
      activeInvariants: mergedInvariants,
      artifacts: Array.from(new Set([...(tgtCp?.artifacts || []), ...(srcCp?.artifacts || [])])),
      autoGit: false,
      autoResonance: false,
    });

    const nowIso = new Date().toISOString();
    const updatedSrc: ContextBranch = {
      ...src,
      status: 'merged',
      mergedInto: tgt.name,
      updatedAt: nowIso,
    };

    const updatedTgt: ContextBranch = {
      ...tgt,
      headCheckpointId: resultingCp.id,
      updatedAt: nowIso,
    };

    const remaining = this.database.branches.filter(
      (b) => b.name !== src.name && b.name !== tgt.name
    );

    this.database = {
      ...this.database,
      updatedAt: nowIso,
      currentBranch: tgt.name,
      branches: [...remaining, updatedTgt, updatedSrc],
    };

    this.saveDatabase();
    return { mergedBranch: updatedSrc, resultingCheckpoint: resultingCp };
  }

  /**
   * 실패한 브랜치 폐기 및 실패 원인 Graveyard 자동 흡수
   */
  public abandonBranch(
    name: string,
    failureInfo?:
      | string
      | {
          failedApproach?: string;
          errorSignature?: string;
          rootCause?: string;
          counterMeasure?: string;
        },
    safeAlternative?: string
  ): { branch: ContextBranch; trapRecorded?: boolean; success?: boolean } {
    this.reloadIfNeeded();
    const target = this.database.branches.find((b) => b.name === name.trim());
    if (!target) throw new Error(`폐기할 브랜치를 찾을 수 없습니다: ${name}`);

    const infoObj =
      typeof failureInfo === 'string'
        ? { rootCause: failureInfo, counterMeasure: safeAlternative }
        : failureInfo || {};

    const nowIso = new Date().toISOString();
    const updated: ContextBranch = {
      ...target,
      status: 'abandoned',
      abandonmentReason: infoObj.rootCause || '실험적 가설 실패로 기각됨',
      updatedAt: nowIso,
    };

    let trapRecorded = false;
    if (infoObj.rootCause || infoObj.failedApproach) {
      this.graveyardStore.assertTrap({
        id: `trap_branch_${target.name}_${Date.now().toString(36)}`,
        title: `브랜치 ${target.name} 기각 가설`,
        failedApproach: infoObj.failedApproach || target.description || target.name,
        errorSignature: infoObj.errorSignature,
        rootCause: infoObj.rootCause || '가설 검증 실패',
        counterMeasure:
          infoObj.counterMeasure || '해당 브랜치 접근법 폐기 및 대안 브랜치 수립 필요',
        triggerKeywords: [
          target.name,
          ...(target.description ? target.description.split(/\s+/) : []),
        ],
      });
      trapRecorded = true;
    }

    const remaining = this.database.branches.filter((b) => b.name !== target.name);
    this.database = {
      ...this.database,
      updatedAt: nowIso,
      currentBranch:
        this.database.currentBranch === target.name ? 'main' : this.database.currentBranch,
      branches: [...remaining, updated],
    };

    this.saveDatabase();
    return { branch: updated, trapRecorded, success: true };
  }

  /**
   * 브랜치 목록 조회
   */
  public listBranches(): ContextBranch[] {
    this.reloadIfNeeded();
    return [...this.database.branches];
  }

  /**
   * 현재 활성 브랜치 조회
   */
  public getCurrentBranch(): ContextBranch {
    this.reloadIfNeeded();
    const curr = this.database.branches.find((b) => b.name === this.database.currentBranch);
    return (
      curr || {
        name: 'main',
        baseCheckpointId: 'root',
        headCheckpointId: 'root',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active',
      }
    );
  }
}
