/**
 * Synapse-Orchestrator: 다중 AI 에이전트 역할 조율 · 자원 충돌 락 · 핸드오프 · 무한루프 컷오프 엔진
 */

export const ORCHESTRATOR_CONFIG = {
  DEFAULT_LOCK_TTL_MS: 30_000,
  MAX_HANDOFF_HOPS: 8,
  MAX_TASKS_IN_QUEUE: 1024,
} as const;

export type AgentRole = "planner" | "worker" | "reviewer" | "verifier";
export type TaskStatus = "pending" | "running" | "handed_off" | "completed" | "failed" | "aborted_loop";

export interface AgentTask {
  readonly id: string;
  readonly title: string;
  readonly assignedRole: AgentRole;
  readonly resources: readonly string[];
  readonly payload: Record<string, unknown>;
  readonly status: TaskStatus;
  readonly hops: number;
  readonly history: readonly string[];
  readonly result?: unknown;
  readonly error?: string;
}

export interface ResourceLock {
  readonly resource: string;
  readonly ownerAgentId: string;
  readonly acquiredAtMs: number;
  readonly expiresAtMs: number;
}

export type RoleHandler = (task: AgentTask, ctx: { lockManager: ResourceLockManager }) => Promise<{
  nextRole?: AgentRole;
  result?: unknown;
  done?: boolean;
}>;

/**
 * 파일/브랜치/문서 자원 충돌 방지 락 관리자
 */
export class ResourceLockManager {
  private readonly locks = new Map<string, ResourceLock>();

  public acquire(resource: string, ownerAgentId: string, ttlMs: number = ORCHESTRATOR_CONFIG.DEFAULT_LOCK_TTL_MS): boolean {
    const now = Date.now();
    const existing = this.locks.get(resource);
    if (existing && existing.expiresAtMs > now && existing.ownerAgentId !== ownerAgentId) {
      return false;
    }

    this.locks.set(resource, {
      resource,
      ownerAgentId,
      acquiredAtMs: now,
      expiresAtMs: now + ttlMs,
    });
    return true;
  }

  public release(resource: string, ownerAgentId: string): boolean {
    const existing = this.locks.get(resource);
    if (!existing || existing.ownerAgentId !== ownerAgentId) return false;
    return this.locks.delete(resource);
  }

  public releaseAllForAgent(ownerAgentId: string): number {
    let released = 0;
    for (const [res, lock] of this.locks.entries()) {
      if (lock.ownerAgentId === ownerAgentId) {
        this.locks.delete(res);
        released++;
      }
    }
    return released;
  }

  public getOwner(resource: string): string | null {
    const lock = this.locks.get(resource);
    if (!lock) return null;
    if (lock.expiresAtMs <= Date.now()) {
      this.locks.delete(resource);
      return null;
    }
    return lock.ownerAgentId;
  }
}

/**
 * 다중 에이전트 태스크 오케스트레이터
 */
export class MultiAgentOrchestrator {
  private readonly tasks = new Map<string, AgentTask>();
  private readonly handlers = new Map<AgentRole, RoleHandler>();
  public readonly lockManager = new ResourceLockManager();

  public registerHandler(role: AgentRole, handler: RoleHandler): void {
    this.handlers.set(role, handler);
  }

  public enqueue(input: {
    id: string;
    title: string;
    initialRole?: AgentRole;
    resources?: readonly string[];
    payload?: Record<string, unknown>;
  }): AgentTask {
    if (this.tasks.size >= ORCHESTRATOR_CONFIG.MAX_TASKS_IN_QUEUE) {
      throw new Error(`[MultiAgentOrchestrator] 최대 큐 크기(${ORCHESTRATOR_CONFIG.MAX_TASKS_IN_QUEUE}) 초과`);
    }
    if (this.tasks.has(input.id)) {
      throw new Error(`[MultiAgentOrchestrator] 중복된 태스크 ID입니다: ${input.id}`);
    }

    const task: AgentTask = {
      id: input.id,
      title: input.title,
      assignedRole: input.initialRole ?? "planner",
      resources: input.resources ?? [],
      payload: input.payload ?? {},
      status: "pending",
      hops: 0,
      history: [],
    };
    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * 단일 태스크를 역할 핸들러 체인에 따라 완료 또는 루프 컷오프까지 실행
   */
  public async runTask(taskId: string, maxHops: number = ORCHESTRATOR_CONFIG.MAX_HANDOFF_HOPS): Promise<AgentTask> {
    let task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`[MultiAgentOrchestrator] 존재하지 않는 태스크입니다: ${taskId}`);
    }

    while (task.status === "pending" || task.status === "handed_off") {
      if (task.hops >= maxHops) {
        task = {
          ...task,
          status: "aborted_loop",
          error: `[MultiAgentOrchestrator] 최대 핸드오프 횟수(${maxHops}) 초과로 무한 루프를 차단했습니다.`,
        };
        this.tasks.set(taskId, task);
        return task;
      }

      const handler = this.handlers.get(task.assignedRole);
      if (!handler) {
        task = {
          ...task,
          status: "failed",
          error: `[MultiAgentOrchestrator] 역할 핸들러가 등록되지 않았습니다: ${task.assignedRole}`,
        };
        this.tasks.set(taskId, task);
        return task;
      }

      const agentOwner = `${task.assignedRole}:${task.id}`;
      for (const res of task.resources) {
        if (!this.lockManager.acquire(res, agentOwner)) {
          task = {
            ...task,
            status: "failed",
            error: `[MultiAgentOrchestrator] 자원 락 획득 실패(${res}, 현재 점유자: ${this.lockManager.getOwner(res)})`,
          };
          this.lockManager.releaseAllForAgent(agentOwner);
          this.tasks.set(taskId, task);
          return task;
        }
      }

      try {
        const runningTask: AgentTask = { ...task, status: "running" };
        const outcome = await handler(runningTask, { lockManager: this.lockManager });
        const nextHistory = [...task.history, `${task.assignedRole}#${task.hops + 1}`];

        if (outcome.done || !outcome.nextRole) {
          task = {
            ...runningTask,
            status: "completed",
            hops: task.hops + 1,
            history: nextHistory,
            result: outcome.result,
          };
          this.tasks.set(taskId, task);
          return task;
        }

        task = {
          ...runningTask,
          assignedRole: outcome.nextRole,
          status: "handed_off",
          hops: task.hops + 1,
          history: nextHistory,
          result: outcome.result,
        };
        this.tasks.set(taskId, task);
      } catch (err: any) {
        task = {
          ...task,
          status: "failed",
          error: `[MultiAgentOrchestrator] 실행 예외(${task.assignedRole}): ${err?.message || String(err)}`,
        };
        this.tasks.set(taskId, task);
        return task;
      } finally {
        this.lockManager.releaseAllForAgent(agentOwner);
      }
    }

    return task;
  }

  public getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId);
  }
}
