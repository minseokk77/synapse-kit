import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContextCheckpointStore } from '../memory/causal-context';
import { CausalMemoryStore } from '../memory/causal-store';
import { handleMcpJsonRpcRequest } from '../memory/causal-server';

describe('🧠 Synapse Causal Memory - Context Checkpoint & Zero-Loss Session Resume', () => {
  let tempDir: string;
  let contextDbPath: string;
  let memoryDbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'synapse-ctx-test-'));
    contextDbPath = join(tempDir, 'test-contexts.json');
    memoryDbPath = join(tempDir, 'test-memory.json');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('1. 체크포인트 박제 시 Git 상태 및 인과 불변 규칙 자동 캡처 검증', async () => {
    const memoryStore = new CausalMemoryStore(memoryDbPath);
    memoryStore.assertRule({
      id: 'rule-ctx-test-1',
      domain: 'Project_Synapse_Kit',
      title: 'Synapse Runner Invariant',
      triggers: {
        files: ['packages/runner/'],
        keywords: ['runner', 'hotswap'],
      },
      invariants: ['프로세스 핫스왑 지연은 0.05초 미만이어야 함', 'SIGTERM 시 볼트 버퍼 강제 플러시 필수'],
      actions: ['cargo test 실행'],
      context: ['Rust 자가치유 데몬'],
    });

    const ctxStore = new ContextCheckpointStore(contextDbPath, memoryDbPath);
    const saved = await ctxStore.saveCheckpoint({
      sessionId: 'synapse-v0.3',
      title: '모듈 4~10 마스터 청사진 수립 완료',
      goal: 'Synapse 7대 차기 코어 모듈 순차 구현',
      activeFiles: ['packages/runner/src/main.rs', 'memory/causal-context.ts'],
      completedSteps: ['v0.2.3 3대 코어 배포 완료', '4~10번 모듈 상세 설계서 작성'],
      pendingTasks: ['모듈 5 runner/ 자가치유 데몬 구현', '모듈 6 bus/ 공유메모리 IPC 구현'],
      keyDecisions: ['PM2 대신 Rust 3MB 단일 바이너리로 핫스왑 데몬 구축'],
      artifacts: ['synapse_pillars_4_to_10_master_blueprint.md'],
      keywords: ['runner'],
    });

    expect(saved.id).toStartWith('ctx_');
    expect(saved.sessionId).toBe('synapse-v0.3');
    expect(saved.title).toBe('모듈 4~10 마스터 청사진 수립 완료');
    expect(saved.completedSteps).toHaveLength(2);
    expect(saved.pendingTasks).toHaveLength(2);
    expect(saved.activeInvariants).toContain('프로세스 핫스왑 지연은 0.05초 미만이어야 함');
    expect(saved.activeInvariants).toContain('SIGTERM 시 볼트 버퍼 강제 플러시 필수');

    // 디스크에서 재로드하여 영속성 확인
    const reloadedStore = new ContextCheckpointStore(contextDbPath, memoryDbPath);
    const latest = reloadedStore.getLatestCheckpoint();
    expect(latest).not.toBeNull();
    expect(latest?.id).toBe(saved.id);
    expect(latest?.pendingTasks[0]).toBe('모듈 5 runner/ 자가치유 데몬 구현');
  });

  test('2. 다중 세션 필터링, 부분 검색 및 삭제 무결성 검증', async () => {
    const ctxStore = new ContextCheckpointStore(contextDbPath, memoryDbPath);

    const cp1 = await ctxStore.saveCheckpoint({
      id: 'ctx_alpha_01',
      sessionId: 'project-alpha',
      title: 'Alpha Phase 1',
      autoGit: false,
      autoResonance: false,
    });

    const cp2 = await ctxStore.saveCheckpoint({
      id: 'ctx_beta_01',
      sessionId: 'project-beta',
      title: 'Beta Audio Engine',
      autoGit: false,
      autoResonance: false,
    });

    expect(ctxStore.getLatestCheckpoint()?.id).toBe(cp2.id);
    expect(ctxStore.getLatestCheckpoint('project-alpha')?.id).toBe(cp1.id);
    expect(ctxStore.getCheckpoint('Audio')?.id).toBe(cp2.id);

    const alphaList = ctxStore.listCheckpoints({ sessionId: 'project-alpha' });
    expect(alphaList).toHaveLength(1);
    expect(alphaList[0].id).toBe('ctx_alpha_01');

    // 삭제 검증
    const deleted = ctxStore.deleteCheckpoint('ctx_beta_01');
    expect(deleted).toBe(true);
    expect(ctxStore.getLatestCheckpoint()?.id).toBe('ctx_alpha_01');
  });

  test('3. 에이전트 복원용 마크다운 및 컴팩트 JSON 포맷터 검증', async () => {
    const ctxStore = new ContextCheckpointStore(contextDbPath, memoryDbPath);
    const cp = await ctxStore.saveCheckpoint({
      id: 'ctx_resume_test',
      sessionId: 'synapse-core',
      title: '컨텍스트 복원 테스트',
      goal: '새 채팅창에서 0ms 복원 달성',
      completedSteps: ['스키마 설계', '스토어 구현'],
      pendingTasks: ['CLI 연동', 'MCP 서버 배포'],
      keyDecisions: ['원자적 파일 교체(renameSync) 적용'],
      artifacts: ['blueprint.md'],
      autoGit: false,
      autoResonance: false,
    });

    const md = ContextCheckpointStore.formatForAgentResume(cp, false);
    expect(md).toContain('### 📌 [Synapse Context Snapshot 복원] 컨텍스트 복원 테스트');
    expect(md).toContain('1. **CLI 연동**');
    expect(md).toContain('2. **MCP 서버 배포**');
    expect(md).toContain('`blueprint.md`');

    const compactStr = ContextCheckpointStore.formatForAgentResume(cp, true);
    const compactObj = JSON.parse(compactStr);
    expect(compactObj.ok).toBe(true);
    expect(compactObj.id).toBe('ctx_resume_test');
    expect(compactObj.pendingTasks).toEqual(['CLI 연동', 'MCP 서버 배포']);
  });

  test('4. MCP JSON-RPC 2.0 도구 호출 및 read_graph 자동 컨텍스트 주입 검증', async () => {
    const memoryStore = new CausalMemoryStore(memoryDbPath);

    // 4-1. save_context_checkpoint 호출
    const saveRes = await handleMcpJsonRpcRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'save_context_checkpoint',
          arguments: {
            id: 'ctx_mcp_01',
            sessionId: 'synapse-mcp',
            title: 'MCP 컨텍스트 스냅샷',
            goal: '안티그래비티 세션 간 기억 손실 원천 차단',
            completedSteps: ['MCP 도구 스키마 등록'],
            pendingTasks: ['새 채팅창에서 자동 복원 확인'],
          },
        },
      },
      memoryStore,
      memoryDbPath,
      contextDbPath
    );

    const savePayload = JSON.parse(saveRes?.result?.content?.[0]?.text || '{}');
    expect(savePayload.ok).toBe(true);
    expect(savePayload.checkpoint.id).toBe('ctx_mcp_01');

    // 4-2. load_context_checkpoint 호출
    const loadRes = await handleMcpJsonRpcRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'load_context_checkpoint',
          arguments: { id: 'latest', compact: true },
        },
      },
      memoryStore,
      memoryDbPath,
      contextDbPath
    );

    const loadPayload = JSON.parse(loadRes?.result?.content?.[0]?.text || '{}');
    expect(loadPayload.ok).toBe(true);
    expect(loadPayload.title).toBe('MCP 컨텍스트 스냅샷');

    // 4-3. read_graph 호출 시 latestContextCheckpoint 자동 동반 여부 검증
    const graphRes = await handleMcpJsonRpcRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'read_graph',
          arguments: {},
        },
      },
      memoryStore,
      memoryDbPath,
      contextDbPath
    );

    const graphPayload = JSON.parse(graphRes?.result?.content?.[0]?.text || '{}');
    expect(graphPayload.latestContextCheckpoint).not.toBeNull();
    expect(graphPayload.latestContextCheckpoint.id).toBe('ctx_mcp_01');
    expect(graphPayload.latestContextCheckpoint.pendingTasks).toContain(
      '새 채팅창에서 자동 복원 확인'
    );
  });
});
