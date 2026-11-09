import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'bun';
import { CAUSAL_MEMORY_CONFIG } from './causal-config';
import { CausalMemoryStore } from './causal-store';
import { detectModifiedFiles } from './causal-query';

/**
 * 컨텍스트 스냅샷(Checkpoint) 단일 레코드 규격
 */
export interface ContextCheckpoint {
  readonly id: string;
  readonly sessionId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly cwd: string;
  readonly gitBranch?: string;
  readonly gitCommit?: string;
  readonly modifiedFiles: readonly string[];
  readonly activeFiles: readonly string[];
  readonly goal: string;
  readonly completedSteps: readonly string[];
  readonly pendingTasks: readonly string[];
  readonly keyDecisions: readonly string[];
  readonly activeInvariants: readonly string[];
  readonly artifacts: readonly string[];
  readonly customMeta?: Record<string, unknown>;
}

/**
 * 컨텍스트 체크포인트 생성 입력 규격
 */
export interface SaveCheckpointInput {
  readonly id?: string;
  readonly sessionId?: string;
  readonly title: string;
  readonly cwd?: string;
  readonly goal?: string;
  readonly activeFiles?: readonly string[];
  readonly modifiedFiles?: readonly string[];
  readonly completedSteps?: readonly string[];
  readonly pendingTasks?: readonly string[];
  readonly keyDecisions?: readonly string[];
  readonly activeInvariants?: readonly string[];
  readonly artifacts?: readonly string[];
  readonly keywords?: readonly string[];
  readonly domain?: string;
  readonly autoGit?: boolean;
  readonly autoResonance?: boolean;
  readonly customMeta?: Record<string, unknown>;
}

/**
 * 컨텍스트 체크포인트 저장소 데이터베이스 규격
 */
export interface ContextCheckpointDatabase {
  readonly version: string;
  readonly updatedAt: string;
  readonly latestCheckpointId: string | null;
  readonly totalCheckpoints: number;
  readonly checkpoints: readonly ContextCheckpoint[];
}

/**
 * Git 현재 브랜치 및 최신 커밋 해시 자동 추출 헬퍼
 */
export async function detectGitHeadInfo(
  cwd: string = process.cwd()
): Promise<{ branch?: string; commit?: string }> {
  try {
    const branchProc = spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const branchOut = (await new Response(branchProc.stdout).text()).trim();
    const branchExit = await branchProc.exited;

    const commitProc = spawn(['git', 'rev-parse', '--short', 'HEAD'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const commitOut = (await new Response(commitProc.stdout).text()).trim();
    const commitExit = await commitProc.exited;

    return {
      branch: branchExit === 0 && branchOut.length > 0 ? branchOut : undefined,
      commit: commitExit === 0 && commitOut.length > 0 ? commitOut : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * 세션 간 기억 손실 0%를 보장하는 인과율 컨텍스트 스냅샷 저장소 클래스 (SRP 준수)
 */
export class ContextCheckpointStore {
  private readonly dbPath: string;
  private readonly memoryDbPath?: string;
  private database: ContextCheckpointDatabase;
  private lastMtimeMs: number = 0;

  constructor(customPath?: string, memoryDbPath?: string) {
    this.dbPath = customPath || CAUSAL_MEMORY_CONFIG.CONTEXT_DB_PATH;
    this.memoryDbPath = memoryDbPath;
    this.database = this.loadDatabase();
  }

  /**
   * 디스크에서 체크포인트 데이터베이스 로드
   */
  private loadDatabase(): ContextCheckpointDatabase {
    try {
      if (existsSync(this.dbPath)) {
        const stat = statSync(this.dbPath);
        this.lastMtimeMs = stat.mtimeMs;
        const raw = readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw) as ContextCheckpointDatabase;
        if (parsed && Array.isArray(parsed.checkpoints)) {
          return parsed;
        }
      }
    } catch {
      // 파일 손상 또는 읽기 실패 시 빈 초기 데이터베이스로 안전 복구
    }

    return {
      version: CAUSAL_MEMORY_CONFIG.SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      latestCheckpointId: null,
      totalCheckpoints: 0,
      checkpoints: [],
    };
  }

  /**
   * 외부 프로세스(CLI 또는 다른 에이전트)에 의해 파일이 갱신되었으면 자동 리로드
   */
  public reloadIfNeeded(): void {
    try {
      if (existsSync(this.dbPath)) {
        const stat = statSync(this.dbPath);
        if (stat.mtimeMs > this.lastMtimeMs) {
          this.database = this.loadDatabase();
        }
      }
    } catch {
      // 파일 상태 확인 실패 시 기존 인메모리 상태 유지
    }
  }

  /**
   * 원자적(Atomic) 파일 교체 방식으로 체크포인트 데이터베이스 영구 저장
   */
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
        const stat = statSync(this.dbPath);
        this.lastMtimeMs = stat.mtimeMs;
      } catch {
        // mtime 갱신 실패 무시
      }

      // 로컬 패키지 폴백 경로에도 미러링 (기본 경로 사용 시)
      if (this.dbPath === CAUSAL_MEMORY_CONFIG.CONTEXT_DB_PATH) {
        try {
          const localDir = dirname(CAUSAL_MEMORY_CONFIG.LOCAL_CONTEXT_DB_PATH);
          if (existsSync(localDir)) {
            writeFileSync(CAUSAL_MEMORY_CONFIG.LOCAL_CONTEXT_DB_PATH, serialized, 'utf-8');
          }
        } catch {
          // 로컬 폴백 미러링 실패는 무시
        }
      }
    } catch (error) {
      throw new Error(
        `컨텍스트 체크포인트 저장 실패: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 고유 체크포인트 ID 생성
   */
  private static generateCheckpointId(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const randPart = Math.random().toString(36).slice(2, 6);
    return `ctx_${datePart}_${timePart}_${randPart}`;
  }

  /**
   * 현재 작업 컨텍스트를 스냅샷으로 박제하여 저장
   */
  public async saveCheckpoint(input: SaveCheckpointInput): Promise<ContextCheckpoint> {
    this.reloadIfNeeded();

    if (!input.title || input.title.trim().length === 0) {
      throw new Error('체크포인트 제목(title)은 비어 있을 수 없습니다.');
    }

    const cwd = input.cwd || process.cwd();
    const sessionId = (input.sessionId || 'default-session').trim();
    const autoGit = input.autoGit !== false;
    const autoResonance = input.autoResonance !== false;

    let modifiedFiles: string[] = input.modifiedFiles ? [...input.modifiedFiles] : [];
    let gitBranch: string | undefined;
    let gitCommit: string | undefined;

    if (autoGit) {
      const [detectedFiles, gitHead] = await Promise.all([
        modifiedFiles.length === 0 ? detectModifiedFiles(cwd) : Promise.resolve(modifiedFiles),
        detectGitHeadInfo(cwd),
      ]);
      modifiedFiles = detectedFiles;
      gitBranch = gitHead.branch;
      gitCommit = gitHead.commit;
    }

    const activeFiles = input.activeFiles
      ? Array.from(new Set(input.activeFiles))
      : modifiedFiles.slice(0, 15);

    // 인과율 메모리에서 현재 작업과 공명하는 핵심 불변 규칙 자동 수집
    const invariantsSet = new Set<string>(input.activeInvariants || []);
    if (autoResonance) {
      try {
        const memoryStore = new CausalMemoryStore(this.memoryDbPath);
        const resonance = memoryStore.queryResonance({
          files: activeFiles.length > 0 ? activeFiles : modifiedFiles,
          keywords: input.keywords,
          domain: input.domain,
          propagateRelations: false,
        });
        for (const rule of resonance.resonanceRules) {
          for (const inv of rule.invariants) {
            invariantsSet.add(inv);
          }
        }
      } catch {
        // 인과 메모리 연동 실패 시 수동 입력 불변식만 유지
      }
    }

    const checkpointId = input.id?.trim() || ContextCheckpointStore.generateCheckpointId();
    const nowIso = new Date().toISOString();

    const checkpoint: ContextCheckpoint = {
      id: checkpointId,
      sessionId,
      title: input.title.trim(),
      createdAt: nowIso,
      cwd: cwd.replaceAll('\\', '/'),
      gitBranch,
      gitCommit,
      modifiedFiles,
      activeFiles,
      goal: (input.goal || input.title).trim(),
      completedSteps: input.completedSteps ? [...input.completedSteps] : [],
      pendingTasks: input.pendingTasks ? [...input.pendingTasks] : [],
      keyDecisions: input.keyDecisions ? [...input.keyDecisions] : [],
      activeInvariants: Array.from(invariantsSet),
      artifacts: input.artifacts ? [...input.artifacts] : [],
      customMeta: input.customMeta,
    };

    // 동일 ID가 있으면 교체, 없으면 맨 앞(최신순)에 추가 후 최대 보존 개수 제한
    const filtered = this.database.checkpoints.filter((c) => c.id !== checkpoint.id);
    const maxRetained = Math.max(1, CAUSAL_MEMORY_CONFIG.MAX_CHECKPOINTS_RETAINED);
    const updatedList = [checkpoint, ...filtered].slice(0, maxRetained);

    this.database = {
      version: CAUSAL_MEMORY_CONFIG.SCHEMA_VERSION,
      updatedAt: nowIso,
      latestCheckpointId: checkpoint.id,
      totalCheckpoints: updatedList.length,
      checkpoints: updatedList,
    };

    this.saveDatabase();

    // 인과율 메모리 메인 그래프(causal_memory.json)에도 상시 활성 스냅샷 노드로 자동 미러링하여
    // 새 채팅창에서 read_graph 또는 query_causal_memory 호출 시 재시작 없이 0ms 즉시 노출되도록 보장
    if (autoResonance) {
      try {
        const memoryStore = new CausalMemoryStore(this.memoryDbPath);
        memoryStore.assertRule({
          id: 'ctx-active-session-snapshot',
          domain: 'User_Preferences_And_Rules',
          title: 'Active_Session_Context_Snapshot',
          entityType: 'ContextCheckpoint',
          triggers: {
            alwaysActive: true,
            keywords: ['context', 'checkpoint', 'resume', '컨텍스트', '이어서', checkpoint.sessionId],
          },
          invariants: [
            `[최근 작업 목표] ${checkpoint.goal}`,
            ...(checkpoint.pendingTasks.length > 0
              ? [`[다음 최우선 진행 과제] ${checkpoint.pendingTasks[0]}`]
              : []),
          ],
          actions: checkpoint.pendingTasks.slice(0, 6),
          context: [
            `체크포인트 ID: ${checkpoint.id} (세션: ${checkpoint.sessionId}, 시각: ${checkpoint.createdAt})`,
            `제목: ${checkpoint.title}`,
            ...(checkpoint.completedSteps.length > 0
              ? [`완료 내역: ${checkpoint.completedSteps.join(' | ')}`]
              : []),
            ...(checkpoint.keyDecisions.length > 0
              ? [`핵심 결정: ${checkpoint.keyDecisions.join(' | ')}`]
              : []),
            ...(checkpoint.artifacts.length > 0
              ? [`설계 아티팩트: ${checkpoint.artifacts.join(', ')}`]
              : []),
          ],
        });
      } catch {
        // 메인 메모리 미러링 실패 시 무시
      }
    }

    return checkpoint;
  }

  /**
   * 최신 체크포인트 조회 (특정 세션 지정 가능)
   */
  public getLatestCheckpoint(sessionId?: string): ContextCheckpoint | null {
    this.reloadIfNeeded();
    if (this.database.checkpoints.length === 0) {
      return null;
    }

    if (sessionId && sessionId.trim().length > 0) {
      const targetSession = sessionId.trim().toLowerCase();
      return (
        this.database.checkpoints.find((c) => c.sessionId.toLowerCase() === targetSession) || null
      );
    }

    return this.database.checkpoints[0] || null;
  }

  /**
   * 특정 ID 또는 'latest' 키워드로 체크포인트 조회
   */
  public getCheckpoint(idOrTag?: string, sessionId?: string): ContextCheckpoint | null {
    this.reloadIfNeeded();
    if (!idOrTag || idOrTag === 'latest') {
      return this.getLatestCheckpoint(sessionId);
    }

    const cleanId = idOrTag.trim();
    const exact = this.database.checkpoints.find((c) => c.id === cleanId);
    if (exact) return exact;

    // 부분 ID 또는 제목 매칭 폴백
    const cleanLower = cleanId.toLowerCase();
    return (
      this.database.checkpoints.find(
        (c) =>
          c.id.toLowerCase().includes(cleanLower) ||
          c.title.toLowerCase().includes(cleanLower) ||
          c.sessionId.toLowerCase() === cleanLower
      ) || null
    );
  }

  /**
   * 저장된 체크포인트 목록 조회
   */
  public listCheckpoints(options?: {
    sessionId?: string;
    limit?: number;
  }): ContextCheckpoint[] {
    this.reloadIfNeeded();
    let list = [...this.database.checkpoints];

    if (options?.sessionId && options.sessionId.trim().length > 0) {
      const target = options.sessionId.trim().toLowerCase();
      list = list.filter((c) => c.sessionId.toLowerCase() === target);
    }

    const limit = options?.limit && options.limit > 0 ? options.limit : list.length;
    return list.slice(0, limit);
  }

  /**
   * 특정 체크포인트 삭제
   */
  public deleteCheckpoint(id: string): boolean {
    this.reloadIfNeeded();
    const beforeLen = this.database.checkpoints.length;
    const remaining = this.database.checkpoints.filter((c) => c.id !== id);

    if (remaining.length === beforeLen) {
      return false;
    }

    this.database = {
      ...this.database,
      updatedAt: new Date().toISOString(),
      latestCheckpointId: remaining[0]?.id || null,
      totalCheckpoints: remaining.length,
      checkpoints: remaining,
    };

    this.saveDatabase();
    return true;
  }

  /**
   * 새 채팅창/에이전트 세션에서 0ms 만에 맥락을 100% 복원하기 위한 초고밀도 프롬프트 포맷터
   */
  public static formatForAgentResume(
    checkpoint: ContextCheckpoint,
    compact: boolean = false
  ): string {
    if (compact) {
      return JSON.stringify({
        ok: true,
        id: checkpoint.id,
        sessionId: checkpoint.sessionId,
        title: checkpoint.title,
        createdAt: checkpoint.createdAt,
        cwd: checkpoint.cwd,
        git: checkpoint.gitBranch
          ? `${checkpoint.gitBranch}@${checkpoint.gitCommit || 'HEAD'}`
          : undefined,
        goal: checkpoint.goal,
        completedSteps: checkpoint.completedSteps,
        pendingTasks: checkpoint.pendingTasks,
        keyDecisions: checkpoint.keyDecisions,
        activeFiles: checkpoint.activeFiles,
        artifacts: checkpoint.artifacts,
        activeInvariants: checkpoint.activeInvariants,
      });
    }

    const lines: string[] = [
      `### 📌 [Synapse Context Snapshot 복원] ${checkpoint.title}`,
      `- **체크포인트 ID**: \`${checkpoint.id}\` (세션: \`${checkpoint.sessionId}\`, 시각: ${checkpoint.createdAt})`,
      `- **작업 경로**: \`${checkpoint.cwd}\`${
        checkpoint.gitBranch
          ? ` (Git: \`${checkpoint.gitBranch}\` @ \`${checkpoint.gitCommit || 'HEAD'}\`)`
          : ''
      }`,
      `- **핵심 목표(Goal)**: ${checkpoint.goal}`,
    ];

    if (checkpoint.completedSteps.length > 0) {
      lines.push('\n#### ✅ 완료된 작업 (Completed Steps)');
      for (const step of checkpoint.completedSteps) {
        lines.push(`  - ${step}`);
      }
    }

    if (checkpoint.pendingTasks.length > 0) {
      lines.push('\n#### ⏳ 바로 이어서 진행할 작업 (Next Pending Tasks)');
      for (let i = 0; i < checkpoint.pendingTasks.length; i++) {
        lines.push(`  ${i + 1}. **${checkpoint.pendingTasks[i]}**`);
      }
    }

    if (checkpoint.keyDecisions.length > 0) {
      lines.push('\n#### 💡 핵심 설계 결정 및 맥락 (Key Decisions)');
      for (const dec of checkpoint.keyDecisions) {
        lines.push(`  - ${dec}`);
      }
    }

    if (checkpoint.artifacts.length > 0) {
      lines.push('\n#### 📄 참조 아티팩트 및 설계 문서 (Artifacts)');
      for (const art of checkpoint.artifacts) {
        lines.push(`  - \`${art}\``);
      }
    }

    if (checkpoint.activeFiles.length > 0) {
      lines.push('\n#### 📂 핵심 작업 파일 (Active Files)');
      lines.push(`  - ${checkpoint.activeFiles.map((f) => `\`${f}\``).join(', ')}`);
    }

    if (checkpoint.activeInvariants.length > 0) {
      lines.push('\n#### 🛡️ 활성 불변 규칙 (Active Invariants)');
      for (const inv of checkpoint.activeInvariants) {
        lines.push(`  - ${inv}`);
      }
    }

    return lines.join('\n');
  }
}
