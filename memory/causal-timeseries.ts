import { ContextCheckpointStore, type ContextCheckpoint } from './causal-context';

/**
 * 시계열 이벤트 레코드 규격
 */
export interface TimelineEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly timestampMs: number;
  readonly type: 'checkpoint' | 'rule_added' | 'rule_updated' | 'branch_merged' | 'trap_recorded';
  readonly sessionId: string;
  readonly title: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly checkpointId?: string;
}

/**
 * 두 체크포인트 간의 시계열 차분(Diff) 결과 규격
 */
export interface CheckpointDiffResult {
  readonly fromId?: string;
  readonly toId?: string;
  readonly fromCheckpointId: string;
  readonly toCheckpointId: string;
  readonly fromTimestamp: string;
  readonly toTimestamp: string;
  readonly timeDeltaHours: number;
  readonly newlyCompletedSteps?: readonly string[];
  readonly resolvedPendingTasks?: readonly string[];
  readonly addedModifiedFiles?: readonly string[];
  readonly addedPendingTasks: readonly string[];
  readonly resolvedTasks: readonly string[];
  readonly newCompletedSteps: readonly string[];
  readonly newDecisions: readonly string[];
  readonly modifiedFilesDelta: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly retained: readonly string[];
  };
  readonly activeInvariantsDelta: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
  };
}

/**
 * 시계열 감쇠 가중치 계산기 및 타임라인 분석기 클래스 (SRP 준수)
 */
export class CausalTimeSeriesEngine {
  private readonly contextStore: ContextCheckpointStore;

  constructor(contextStore?: ContextCheckpointStore, _memoryStore?: unknown) {
    this.contextStore = contextStore || new ContextCheckpointStore();
  }

  /**
   * 시계열 감쇠 지수 가중치 산출 (시간 경과 감쇠 + 빈도 가산)
   * Score = BaseScore * exp(-lambda * deltaHours) + alpha * ln(1 + hitCount)
   */
  public static calculateTemporalDecayScore(options: {
    baseScore?: number;
    lastActiveMs: number;
    nowMs?: number;
    halfLifeHours?: number;
    hitCount?: number;
  }): number {
    const baseScore = options.baseScore ?? 1.0;
    const nowMs = options.nowMs ?? Date.now();
    const deltaHours = Math.max(0, (nowMs - options.lastActiveMs) / (1000 * 60 * 60));
    const halfLifeHours = Math.max(0.1, options.halfLifeHours ?? 24.0); // 24시간마다 가중치 반감
    const lambda = Math.LN2 / halfLifeHours;
    const hitCount = Math.max(0, options.hitCount ?? 0);

    const decayFactor = Math.exp(-lambda * deltaHours);
    const frequencyBoost = 0.25 * Math.log(1 + hitCount);

    return Number((baseScore * decayFactor + frequencyBoost).toFixed(4));
  }

  /**
   * 공명 인과 규칙들에 시계열 시간 감쇠 가중치 계산 반영
   */
  public computeDecayedResonance<
    T extends { updatedAt?: string; confidence?: number; weight?: number },
  >(rules: readonly T[]): Array<T & { decayScore: number }> {
    return rules.map((r) => {
      const lastActiveMs = r.updatedAt ? new Date(r.updatedAt).getTime() : Date.now();
      const decayScore = CausalTimeSeriesEngine.calculateTemporalDecayScore({
        baseScore: (r.confidence ?? 1.0) * (r.weight ?? 1.0),
        lastActiveMs,
      });
      return { ...r, decayScore };
    });
  }

  /**
   * 특정 세션 또는 전체 작업의 시계열 타임라인 궤적 생성
   */
  public generateTimeline(
    options?:
      | number
      | {
          sessionId?: string;
          sinceMs?: number;
          limit?: number;
        }
  ): TimelineEvent[] {
    const opt = typeof options === 'number' ? { limit: options } : options;
    const checkpoints = this.contextStore.listCheckpoints({
      sessionId: opt?.sessionId,
    });

    const nowMs = Date.now();
    const sinceMs = opt?.sinceMs ?? nowMs - 7 * 24 * 60 * 60 * 1000; // 기본 7일치

    const events: TimelineEvent[] = [];

    for (const cp of checkpoints) {
      const tsMs = new Date(cp.createdAt).getTime();
      if (tsMs < sinceMs) continue;

      events.push({
        id: `tl_${cp.id}`,
        timestamp: cp.createdAt,
        timestampMs: tsMs,
        type: 'checkpoint',
        sessionId: cp.sessionId,
        title: cp.title,
        summary: `목표: ${cp.goal} | 완료: ${cp.completedSteps.length}건 | 잔여: ${cp.pendingTasks.length}건`,
        tags: [cp.sessionId, cp.gitBranch || 'main'],
        checkpointId: cp.id,
      });
    }

    // 시간 순서(과거 ➔ 최신) 또는 옵션에 따라 최신순 정렬
    events.sort((a, b) => b.timestampMs - a.timestampMs);

    const limit = opt?.limit && opt.limit > 0 ? opt.limit : events.length;
    return events.slice(0, limit);
  }

  /**
   * 두 체크포인트 간의 차분(Diff) 계산
   */
  public diffCheckpoints(fromId: string, toId: string): CheckpointDiffResult {
    const fromCp = this.contextStore.getCheckpoint(fromId);
    const toCp = this.contextStore.getCheckpoint(toId);

    if (!fromCp) {
      throw new Error(`시작 체크포인트를 찾을 수 없습니다: ${fromId}`);
    }
    if (!toCp) {
      throw new Error(`비교 대상 체크포인트를 찾을 수 없습니다: ${toId}`);
    }

    const fromMs = new Date(fromCp.createdAt).getTime();
    const toMs = new Date(toCp.createdAt).getTime();
    const deltaHours = Number(Math.abs(toMs - fromMs) / (1000 * 60 * 60)).toFixed(2);

    const fromPendingSet = new Set(fromCp.pendingTasks);
    const toPendingSet = new Set(toCp.pendingTasks);

    const addedPendingTasks = toCp.pendingTasks.filter((t) => !fromPendingSet.has(t));
    const resolvedTasks = fromCp.pendingTasks.filter((t) => !toPendingSet.has(t));

    const fromCompletedSet = new Set(fromCp.completedSteps);
    const newCompletedSteps = toCp.completedSteps.filter((s) => !fromCompletedSet.has(s));

    const fromDecisionsSet = new Set(fromCp.keyDecisions);
    const newDecisions = toCp.keyDecisions.filter((d) => !fromDecisionsSet.has(d));

    // 파일 변경점 차분
    const fromFilesSet = new Set(fromCp.modifiedFiles);
    const toFilesSet = new Set(toCp.modifiedFiles);

    const addedFiles = toCp.modifiedFiles.filter((f) => !fromFilesSet.has(f));
    const removedFiles = fromCp.modifiedFiles.filter((f) => !toFilesSet.has(f));
    const retainedFiles = toCp.modifiedFiles.filter((f) => fromFilesSet.has(f));

    // 불변 규칙 차분
    const fromInvSet = new Set(fromCp.activeInvariants);
    const toInvSet = new Set(toCp.activeInvariants);

    const addedInvariants = toCp.activeInvariants.filter((i) => !fromInvSet.has(i));
    const removedInvariants = fromCp.activeInvariants.filter((i) => !toInvSet.has(i));

    return {
      fromId: fromCp.id,
      toId: toCp.id,
      fromCheckpointId: fromCp.id,
      toCheckpointId: toCp.id,
      fromTimestamp: fromCp.createdAt,
      toTimestamp: toCp.createdAt,
      timeDeltaHours: parseFloat(deltaHours),
      newlyCompletedSteps: newCompletedSteps,
      resolvedPendingTasks: resolvedTasks,
      addedModifiedFiles: addedFiles,
      addedPendingTasks,
      resolvedTasks,
      newCompletedSteps,
      newDecisions,
      modifiedFilesDelta: {
        added: addedFiles,
        removed: removedFiles,
        retained: retainedFiles,
      },
      activeInvariantsDelta: {
        added: addedInvariants,
        removed: removedInvariants,
      },
    } as any;
  }

  /**
   * 특정 시점으로 컨텍스트 되감기(Rewind)
   * 지정한 체크포인트를 최신 체크포인트로 재발행(Clone)하여 안전하게 되돌림
   */
  public async rewindToCheckpoint(targetIdOrTag: string): Promise<ContextCheckpoint> {
    const targetCp = this.contextStore.getCheckpoint(targetIdOrTag);
    if (!targetCp) {
      throw new Error(`되감기 대상 체크포인트를 찾을 수 없습니다: ${targetIdOrTag}`);
    }

    // 대상 체크포인트의 상태를 복제하여 신규 롤백 체크포인트로 원자적 발행
    const rolledBack = await this.contextStore.saveCheckpoint({
      sessionId: targetCp.sessionId,
      title: `[Rewind 롤백] ${targetCp.title}`,
      goal: targetCp.goal,
      cwd: targetCp.cwd,
      activeFiles: targetCp.activeFiles,
      modifiedFiles: targetCp.modifiedFiles,
      completedSteps: targetCp.completedSteps,
      pendingTasks: targetCp.pendingTasks,
      keyDecisions: [
        `과거 체크포인트(${targetCp.id}, ${targetCp.createdAt})로 시계열 되감기 수행됨`,
        ...targetCp.keyDecisions,
      ],
      activeInvariants: targetCp.activeInvariants,
      artifacts: targetCp.artifacts,
      autoGit: false,
      autoResonance: false,
    });

    return rolledBack;
  }

  /**
   * 시계열 차분 결과 마크다운 렌더러
   */
  public static formatDiffReport(diff: CheckpointDiffResult): string {
    const lines: string[] = [
      `### ⏳ [Synapse 시계열 차분 분석] \`${diff.fromCheckpointId}\` ➔ \`${diff.toCheckpointId}\``,
      `- **경과 시간**: 약 ${diff.timeDeltaHours}시간 (${diff.fromTimestamp} ➔ ${diff.toTimestamp})`,
    ];

    if (diff.resolvedTasks.length > 0) {
      lines.push('\n#### 🎯 해결/완료된 과제 (Resolved Tasks)');
      for (const t of diff.resolvedTasks) lines.push(`  - ✔ ~~${t}~~`);
    }

    if (diff.newCompletedSteps.length > 0) {
      lines.push('\n#### ✨ 새로 완료된 단계 (New Completed Steps)');
      for (const s of diff.newCompletedSteps) lines.push(`  - ✅ ${s}`);
    }

    if (diff.addedPendingTasks.length > 0) {
      lines.push('\n#### ⏳ 새로 부여된 다음 과제 (Added Pending Tasks)');
      for (const t of diff.addedPendingTasks) lines.push(`  - 📌 **${t}**`);
    }

    if (diff.newDecisions.length > 0) {
      lines.push('\n#### 💡 새로운 설계 결정 (New Key Decisions)');
      for (const d of diff.newDecisions) lines.push(`  - ${d}`);
    }

    if (diff.modifiedFilesDelta.added.length > 0 || diff.modifiedFilesDelta.removed.length > 0) {
      lines.push('\n#### 📂 파일 변경점 (Files Delta)');
      if (diff.modifiedFilesDelta.added.length > 0) {
        lines.push(`  - 🟢 **추가**: ${diff.modifiedFilesDelta.added.map((f) => `\`${f}\``).join(', ')}`);
      }
      if (diff.modifiedFilesDelta.removed.length > 0) {
        lines.push(`  - 🔴 **제거**: ${diff.modifiedFilesDelta.removed.map((f) => `\`${f}\``).join(', ')}`);
      }
    }

    if (diff.activeInvariantsDelta.added.length > 0) {
      lines.push('\n#### 🛡️ 새로 발동된 불변 규칙 (New Invariants)');
      for (const i of diff.activeInvariantsDelta.added) lines.push(`  - ${i}`);
    }

    return lines.join('\n');
  }
}
