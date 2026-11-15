/**
 * 시냅스 SpecStream 추측성 프리페치 & 커밋 배리어 파이프라인
 * - arXiv:2609.33184 (SpecStream) & arXiv:2606.07846 (Cost-Aware Speculative Execution)
 */

export const SPECULATIVE_PREFETCH_CONFIG = {
  DEFAULT_CONCURRENCY: 8,
} as const;

export interface SpeculativeTask<T> {
  readonly key: string;
  readonly execute: () => Promise<T> | T;
  readonly rollback?: () => Promise<void> | void;
}

export interface SpeculativeRunReport<T> {
  readonly committed: readonly { key: string; value: T }[];
  readonly rolledBackKeys: readonly string[];
  readonly durationMs: number;
}

/**
 * 예측된 병렬 태스크를 사전 실행한 뒤 CommitBarrier 조건 검증 통과 시에만 커밋하고,
 * 예측 불일치 시 부작용을 롤백하는 추측성 실행 엔진
 */
export class SpeculativePrefetcher {
  /**
   * 추측성 배치 실행 + 커밋 배리어 검증
   */
  public async runWithCommitBarrier<T>(
    tasks: readonly SpeculativeTask<T>[],
    shouldCommit: (key: string, value: T) => boolean
  ): Promise<SpeculativeRunReport<T>> {
    const start = performance.now();
    const settled = await Promise.all(
      tasks.map(async (task) => ({
        task,
        value: await task.execute(),
      }))
    );

    const committed: { key: string; value: T }[] = [];
    const rolledBackKeys: string[] = [];

    for (const item of settled) {
      if (shouldCommit(item.task.key, item.value)) {
        committed.push({ key: item.task.key, value: item.value });
      } else {
        if (item.task.rollback) {
          await item.task.rollback();
        }
        rolledBackKeys.push(item.task.key);
      }
    }

    return {
      committed,
      rolledBackKeys,
      durationMs: Number((performance.now() - start).toFixed(3)),
    };
  }
}
