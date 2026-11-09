import { createInterface } from 'node:readline';
import { CAUSAL_MEMORY_CONFIG } from './causal-config';
import { CausalMemoryStore, type CausalRule } from './causal-store';
import { runCausalQuery, formatResonanceForAgent, detectModifiedFiles } from './causal-query';
import { ContextCheckpointStore, type SaveCheckpointInput } from './causal-context';
import { CausalTimeSeriesEngine } from './causal-timeseries';
import { CausalGraveyardStore, type FailureHypothesis } from './causal-graveyard';
import { CausalBranchStore } from './causal-branch';
import { CausalPredictorEngine } from './causal-predictor';
import { CausalSynthesizerEngine } from './causal-synthesizer';
import { CausalObsidianLensEngine } from './causal-lens';

export interface ServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly dbPath?: string;
  readonly contextDbPath?: string;
}

export interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, any>;
}

/**
 * MCP 표준 도구 스키마 목록 (신규 인과율 도구 3종 + 구형 memory 호환 도구 9종 = 총 12종)
 */
export const CAUSAL_MCP_TOOLS = [
  {
    name: 'query_causal_memory',
    description:
      '작업 컨텍스트(수정된 파일, 키워드, 명령어, 도메인)에 매칭되는 인과율 지식과 불변 규칙만 0ms 초경량으로 공명 쿼리합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: '감지할 대상 파일 경로 목록 (생략 시 Git 변경 파일 자동 감지)',
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '검색할 도메인/작업 키워드 목록',
        },
        command: {
          type: 'string',
          description: '연동 명령어 (예: check, build, release, sign)',
        },
        domain: {
          type: 'string',
          description: '특정 도메인 필터',
        },
        compact: {
          type: 'boolean',
          description: '초소형 JSON 포맷 반환 여부',
        },
      },
    },
  },
  {
    name: 'assert_causal_rule',
    description: '신규 인과율 규칙(원인 트리거 ➔ 불변 계약 ➔ 실행 지침)을 메모리에 등록하거나 갱신합니다.',
    inputSchema: {
      type: 'object',
      required: ['id', 'domain', 'title', 'triggers'],
      properties: {
        id: { type: 'string' },
        domain: { type: 'string' },
        title: { type: 'string' },
        triggers: { type: 'object' },
        invariants: { type: 'array', items: { type: 'string' } },
        actions: { type: 'array', items: { type: 'string' } },
        context: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'audit_causal_memory',
    description: '인과율 메모리 데이터베이스의 무결성, 도메인 분포, 토큰 절감 상태를 감사(Audit)합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'read_graph',
    description:
      'Read the active causal resonance knowledge graph (automatically filters out unrelated noise for 90%+ token savings)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'search_nodes',
    description:
      'Search for causal rules and nodes in the knowledge graph based on a query and traverse causal relations',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'The search query to match against rule titles, domains, triggers, and invariants',
        },
      },
    },
  },
  {
    name: 'open_nodes',
    description: 'Open specific causal rule nodes in the knowledge graph by their names or IDs',
    inputSchema: {
      type: 'object',
      required: ['names'],
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'An array of entity names or rule IDs to retrieve',
        },
      },
    },
  },
  {
    name: 'create_entities',
    description: 'Create multiple new entities (automatically converted into structured Causal Rules)',
    inputSchema: {
      type: 'object',
      required: ['entities'],
      properties: {
        entities: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'entityType', 'observations'],
            properties: {
              name: { type: 'string' },
              entityType: { type: 'string' },
              observations: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  },
  {
    name: 'create_relations',
    description: 'Create multiple new causal relations between nodes in the knowledge graph',
    inputSchema: {
      type: 'object',
      required: ['relations'],
      properties: {
        relations: {
          type: 'array',
          items: {
            type: 'object',
            required: ['from', 'to', 'relationType'],
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              relationType: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'add_observations',
    description: 'Add new invariants, actions, or context observations to existing causal rules',
    inputSchema: {
      type: 'object',
      required: ['observations'],
      properties: {
        observations: {
          type: 'array',
          items: {
            type: 'object',
            required: ['entityName', 'contents'],
            properties: {
              entityName: { type: 'string' },
              contents: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  },
  {
    name: 'delete_entities',
    description: 'Delete multiple entities/rules and their associated causal relations',
    inputSchema: {
      type: 'object',
      required: ['entityNames'],
      properties: {
        entityNames: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'delete_observations',
    description: 'Delete specific observations from entities/rules in the causal memory',
    inputSchema: {
      type: 'object',
      required: ['deletions'],
      properties: {
        deletions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['entityName', 'observations'],
            properties: {
              entityName: { type: 'string' },
              observations: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  },
  {
    name: 'delete_relations',
    description: 'Delete multiple causal relations from the knowledge graph',
    inputSchema: {
      type: 'object',
      required: ['relations'],
      properties: {
        relations: {
          type: 'array',
          items: {
            type: 'object',
            required: ['from', 'to', 'relationType'],
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              relationType: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'save_context_checkpoint',
    description:
      '현재 작업 세션의 핵심 컨텍스트(목표, 완료 단계, 다음 할 일, 핵심 설계 결정, 활성 파일, 아티팩트)를 초경량 스냅샷으로 저장하여 새 채팅창에서도 기억 손실 없이 0ms 복원할 수 있게 합니다.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        id: { type: 'string', description: '고유 체크포인트 ID (생략 시 자동 생성)' },
        sessionId: { type: 'string', description: '프로젝트 또는 세션 식별자 (예: synapse-kit)' },
        title: { type: 'string', description: '현재 컨텍스트 스냅샷 요약 제목' },
        goal: { type: 'string', description: '현재 달성 중인 핵심 목표' },
        completedSteps: {
          type: 'array',
          items: { type: 'string' },
          description: '이번 세션까지 완료된 핵심 작업 목록',
        },
        pendingTasks: {
          type: 'array',
          items: { type: 'string' },
          description: '다음 채팅/세션에서 바로 이어서 진행할 할 일 목록',
        },
        keyDecisions: {
          type: 'array',
          items: { type: 'string' },
          description: '핵심 설계 결정 및 아키텍처 주의사항',
        },
        activeFiles: {
          type: 'array',
          items: { type: 'string' },
          description: '집중 작업 중인 파일 경로 목록',
        },
        artifacts: {
          type: 'array',
          items: { type: 'string' },
          description: '관련 아티팩트 또는 마스터 설계 문서 경로 목록',
        },
        cwd: { type: 'string', description: '작업 디렉터리 경로' },
      },
    },
  },
  {
    name: 'load_context_checkpoint',
    description:
      '저장된 컨텍스트 체크포인트 스냅샷(최신 또는 특정 ID/세션)을 0ms 만에 복원하여 새 채팅창에서 이전 작업을 즉시 이어갑니다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: "복원할 체크포인트 ID, 제목 키워드, 또는 'latest' (기본값: 'latest')",
        },
        sessionId: {
          type: 'string',
          description: '특정 세션/프로젝트의 최신 스냅샷만 필터링할 경우 지정',
        },
        compact: {
          type: 'boolean',
          description: '초소형 JSON 포맷으로 반환할지 여부',
        },
      },
    },
  },
  {
    name: 'list_context_checkpoints',
    description: '저장된 모든 작업 컨텍스트 스냅샷(Checkpoint) 목록을 최신순으로 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '특정 세션/프로젝트 필터' },
        limit: { type: 'number', description: '조회할 최대 개수 (기본값: 20)' },
      },
    },
  },
  {
    name: 'time_travel_causal_memory',
    description:
      '인과율 시계열(Time-Series) 엔진을 통해 시간 감쇠 가중치 계산, 체크포인트 간 변경 diff 분석, 특정 과거 시점으로의 리와인드, 세션 타임라인을 생성합니다.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['diff', 'rewind', 'timeline', 'decay'],
          description: '수행할 시계열 동작 (diff: 비교, rewind: 되돌리기, timeline: 타임라인, decay: 감쇠 계산)',
        },
        fromId: { type: 'string', description: '비교 기준 시작 체크포인트 ID (diff 전용)' },
        toId: { type: 'string', description: '비교 대상 목표 체크포인트 ID (diff 전용)' },
        targetId: { type: 'string', description: '리와인드 대상 체크포인트 ID (rewind 전용)' },
        limit: { type: 'number', description: '타임라인 조회 개수' },
      },
    },
  },
  {
    name: 'scan_causal_graveyard',
    description:
      '부정적 기억 / 안티패턴 함정(Graveyard)을 실시간으로 스캔하여 실패를 유발했던 접근법인지 선제 검증하거나, 새로운 실패 가설을 등록합니다.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['scan', 'assert', 'list'],
          description: '동작 (scan: 함정 검사, assert: 실패 가설 등록, list: 전체 목록)',
        },
        files: { type: 'array', items: { type: 'string' }, description: '수정 예정 파일 목록 (scan용)' },
        keywords: { type: 'array', items: { type: 'string' }, description: '의도/접근법 키워드 (scan용)' },
        trapPattern: { type: 'string', description: '실패 유발 패턴 이름 (assert용)' },
        domain: { type: 'string', description: '도메인 (assert용)' },
        reason: { type: 'string', description: '실패 원인 (assert용)' },
        safeAlternative: { type: 'string', description: '안전한 대안 (assert용)' },
        severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], description: '위험도' },
        avoidFiles: { type: 'array', items: { type: 'string' }, description: '금지 파일 패턴' },
      },
    },
  },
  {
    name: 'branch_causal_context',
    description:
      '작업 맥락을 독립된 브랜치(Mental Fork)로 분기하거나, 검증 후 메인에 병합(Merge)하고, 실패한 실험은 폐기(Abandon)하여 Graveyard에 안티패턴으로 자동 이관합니다.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'switch', 'merge', 'abandon'],
          description: '브랜치 동작 (list: 목록, create: 생성, switch: 전환, merge: 병합, abandon: 폐기 및 함정 등록)',
        },
        name: { type: 'string', description: '브랜치 이름' },
        fromBranch: { type: 'string', description: '분기 기준 부모 브랜치 (create용)' },
        targetBranch: { type: 'string', description: '병합 대상 브랜치 (merge용)' },
        failureReason: { type: 'string', description: '폐기 사유 (abandon용)' },
        safeAlternative: { type: 'string', description: '안전한 대안 (abandon용)' },
      },
    },
  },
  {
    name: 'predict_blast_radius',
    description:
      '수정 대상 파일들을 기반으로 인과 그래프의 2~3단계 연쇄 파급 영향(Blast Radius)과 위험도(0~100)를 산출하고, 위반 방지를 위해 관련 불변식들을 사전 페치(prefetch)합니다.',
    inputSchema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: '수정 대상 파일 목록',
        },
        maxHops: {
          type: 'number',
          description: '최대 파급 전파 단계 (기본값: 3)',
        },
      },
    },
  },
  {
    name: 'synthesize_git_checkpoint',
    description:
      'Git 상태 및 diff를 분석하여 작업자의 의도(Goal, Completed Steps, Pending Tasks)를 자동 역합성(Reverse Synthesis)하고 원클릭 체크포인트를 저장합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: '작업 디렉터리 경로' },
        title: { type: 'string', description: '사용자 지정 제목 (생략 시 자동 생성)' },
        autoCheckpoint: { type: 'boolean', description: '분석 후 체크포인트 즉시 저장 여부 (기본: true)' },
      },
    },
  },
  {
    name: 'sync_obsidian_lens',
    description:
      '옵시디언(Obsidian) 볼트와 인과율 메모리(규칙, 함정, 스냅샷, 타임라인, 캔버스 다이어그램)를 완벽하게 양방향 동기화(Sync)합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['export', 'import', 'sync'],
          description: '동작 (export: 마크다운/캔버스 내보내기, import: 마크다운 읽어오기, sync: 양방향 동기화)',
        },
        vaultPath: {
          type: 'string',
          description: '옵시디언 볼트 루트 경로 (생략 시 기본 환경변수/OS 경로 사용)',
        },
      },
    },
  },
] as const;

/**
 * MCP JSON-RPC 2.0 요청 통합 처리기 (HTTP 데몬 및 Stdio 서버 공용)
 */
export async function handleMcpJsonRpcRequest(
  rpc: JsonRpcRequest,
  store: CausalMemoryStore,
  dbPath?: string,
  contextDbPath?: string
): Promise<Record<string, any> | null> {
  const { id, method, params } = rpc;
  const contextStore = new ContextCheckpointStore(contextDbPath, dbPath);

  // Notification (응답 불필요)
  if (method.startsWith('notifications/')) {
    return null;
  }

  // 1. MCP 초기화 핸드셰이크
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        protocolVersion: params?.protocolVersion || CAUSAL_MEMORY_CONFIG.MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: CAUSAL_MEMORY_CONFIG.MCP_SERVER_NAME,
          version: CAUSAL_MEMORY_CONFIG.SCHEMA_VERSION,
        },
      },
    };
  }

  // 2. Ping
  if (method === 'ping') {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result: {},
    };
  }

  // 3. 도구 목록 조회
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        tools: CAUSAL_MCP_TOOLS,
      },
    };
  }

  // 4. 도구 실행
  if (method === 'tools/call') {
    store.reloadIfNeeded();
    contextStore.reloadIfNeeded();
    const toolName = params?.name;
    const args = params?.arguments || {};

    try {
      let payloadText = '';

      switch (toolName) {
        case 'query_causal_memory': {
          let files: string[] = Array.isArray(args.files) ? args.files : [];
          if (files.length === 0 && args.autoGit !== false) {
            files = await detectModifiedFiles();
          }
          const res = store.queryResonance({
            files,
            keywords: args.keywords,
            command: args.command,
            domain: args.domain,
            propagateRelations: args.propagateRelations,
            maxHops: args.maxHops,
          });
          payloadText = formatResonanceForAgent(res, Boolean(args.compact));
          const latestCtx = contextStore.getLatestCheckpoint(
            typeof args.sessionId === 'string' ? args.sessionId : undefined
          );
          if (latestCtx && !args.compact && args.includeContext !== false) {
            payloadText += '\n\n' + ContextCheckpointStore.formatForAgentResume(latestCtx, false);
          }
          break;
        }

        case 'assert_causal_rule': {
          store.assertRule(args as CausalRule);
          payloadText = JSON.stringify({
            ok: true,
            message: `인과율 규칙 등록/갱신 완료: ${args.id}`,
            id: args.id,
          });
          break;
        }

        case 'audit_causal_memory': {
          const audit = store.audit();
          const status = store.getStatus();
          const checkpointsCount = contextStore.listCheckpoints().length;
          payloadText = JSON.stringify({ ...audit, status, checkpointsCount }, null, 2);
          break;
        }

        case 'read_graph': {
          const gitFiles = await detectModifiedFiles();
          const smartGraph = store.readSmartGraph(gitFiles);
          const latestCheckpoint = contextStore.getLatestCheckpoint();
          payloadText = JSON.stringify(
            {
              ...smartGraph,
              latestContextCheckpoint: latestCheckpoint || null,
            },
            null,
            2
          );
          break;
        }

        case 'save_context_checkpoint': {
          const saved = await contextStore.saveCheckpoint(args as SaveCheckpointInput);
          payloadText = JSON.stringify(
            {
              ok: true,
              message: `컨텍스트 체크포인트 저장 완료: ${saved.id}`,
              checkpoint: saved,
            },
            null,
            2
          );
          break;
        }

        case 'load_context_checkpoint': {
          const targetId = typeof args.id === 'string' ? args.id : 'latest';
          const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined;
          const found = contextStore.getCheckpoint(targetId, sessionId);
          if (!found) {
            payloadText = JSON.stringify({
              ok: false,
              message: '저장된 컨텍스트 체크포인트를 찾을 수 없습니다.',
            });
          } else {
            payloadText = ContextCheckpointStore.formatForAgentResume(
              found,
              Boolean(args.compact)
            );
          }
          break;
        }

        case 'list_context_checkpoints': {
          const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined;
          const limit = typeof args.limit === 'number' ? args.limit : 20;
          const list = contextStore.listCheckpoints({ sessionId, limit });
          payloadText = JSON.stringify(
            {
              ok: true,
              totalCount: list.length,
              checkpoints: list.map((c) => ({
                id: c.id,
                sessionId: c.sessionId,
                title: c.title,
                createdAt: c.createdAt,
                goal: c.goal,
                pendingTasksCount: c.pendingTasks.length,
                completedStepsCount: c.completedSteps.length,
              })),
            },
            null,
            2
          );
          break;
        }

        case 'search_nodes': {
          const searchResult = store.searchNodes(String(args.query || ''));
          payloadText = JSON.stringify(searchResult, null, 2);
          break;
        }

        case 'open_nodes': {
          const names = Array.isArray(args.names) ? args.names : [];
          const openResult = store.openNodes(names);
          payloadText = JSON.stringify(openResult, null, 2);
          break;
        }

        case 'create_entities': {
          const entities = Array.isArray(args.entities) ? args.entities : [];
          const created = store.createEntities(entities);
          payloadText = JSON.stringify(created, null, 2);
          break;
        }

        case 'create_relations': {
          const relations = Array.isArray(args.relations) ? args.relations : [];
          const created = store.createRelations(relations);
          payloadText = JSON.stringify(created, null, 2);
          break;
        }

        case 'add_observations': {
          const observations = Array.isArray(args.observations) ? args.observations : [];
          const added = store.addObservations(observations);
          payloadText = JSON.stringify(added, null, 2);
          break;
        }

        case 'delete_entities': {
          const entityNames = Array.isArray(args.entityNames) ? args.entityNames : [];
          store.deleteEntities(entityNames);
          payloadText = 'Entities deleted successfully';
          break;
        }

        case 'delete_observations': {
          const deletions = Array.isArray(args.deletions) ? args.deletions : [];
          store.deleteObservations(deletions);
          payloadText = 'Observations deleted successfully';
          break;
        }

        case 'delete_relations': {
          const relations = Array.isArray(args.relations) ? args.relations : [];
          store.deleteRelations(relations);
          payloadText = 'Relations deleted successfully';
          break;
        }

        case 'time_travel_causal_memory': {
          const timeSeries = new CausalTimeSeriesEngine(contextStore, store);
          if (args.action === 'diff') {
            const diff = timeSeries.diffCheckpoints(
              String(args.fromId || ''),
              String(args.toId || '')
            );
            payloadText = JSON.stringify(diff, null, 2);
          } else if (args.action === 'rewind') {
            const res = await timeSeries.rewindToCheckpoint(String(args.targetId || ''));
            payloadText = JSON.stringify(res, null, 2);
          } else if (args.action === 'timeline') {
            const tl = timeSeries.generateTimeline(
              typeof args.limit === 'number' ? args.limit : 20
            );
            payloadText = JSON.stringify(tl, null, 2);
          } else {
            const resonance = store.queryResonance({
              files: Array.isArray(args.files) ? args.files : [],
            });
            const decayed = timeSeries.computeDecayedResonance(resonance.resonanceRules);
            payloadText = JSON.stringify(decayed, null, 2);
          }
          break;
        }

        case 'scan_causal_graveyard': {
          const graveyard = new CausalGraveyardStore(store);
          if (args.action === 'assert') {
            const trap = graveyard.assertTrap(args as unknown as FailureHypothesis);
            payloadText = JSON.stringify({ ok: true, trap }, null, 2);
          } else if (args.action === 'list') {
            const list = graveyard.getAllTraps();
            payloadText = JSON.stringify({ ok: true, traps: list }, null, 2);
          } else {
            const res = graveyard.scanTraps({
              files: Array.isArray(args.files) ? args.files : undefined,
              keywords: Array.isArray(args.keywords) ? args.keywords : undefined,
            });
            payloadText = CausalGraveyardStore.formatTrapWarnings(res);
          }
          break;
        }

        case 'branch_causal_context': {
          const branchStore = new CausalBranchStore(contextStore);
          if (args.action === 'create') {
            const b = await branchStore.createBranch(String(args.name || ''), {
              description: args.fromBranch,
            });
            payloadText = JSON.stringify({ ok: true, branch: b }, null, 2);
          } else if (args.action === 'switch') {
            const b = branchStore.switchBranch(String(args.name || ''));
            payloadText = JSON.stringify({ ok: true, branch: b }, null, 2);
          } else if (args.action === 'merge') {
            const res = await branchStore.mergeBranch(
              String(args.name || ''),
              args.targetBranch
            );
            payloadText = JSON.stringify(res, null, 2);
          } else if (args.action === 'abandon') {
            const res = branchStore.abandonBranch(
              String(args.name || ''),
              String(args.failureReason || '폐기됨'),
              args.safeAlternative
            );
            payloadText = JSON.stringify(res, null, 2);
          } else {
            const branches = branchStore.listBranches();
            const current = branchStore.getCurrentBranch();
            payloadText = JSON.stringify({ ok: true, currentBranch: current, branches }, null, 2);
          }
          break;
        }

        case 'predict_blast_radius': {
          const predictor = new CausalPredictorEngine(store, contextStore);
          const files = Array.isArray(args.files) ? args.files : [];
          const maxHops = typeof args.maxHops === 'number' ? args.maxHops : 3;
          const report = predictor.analyzeBlastRadius(files, maxHops);
          payloadText = JSON.stringify(report, null, 2);
          break;
        }

        case 'synthesize_git_checkpoint': {
          const synthesizer = new CausalSynthesizerEngine(contextStore, store);
          const cwd = typeof args.cwd === 'string' ? args.cwd : process.cwd();
          if (args.autoCheckpoint === false) {
            const summary = await synthesizer.inspectGitChanges(cwd);
            const intent = synthesizer.synthesizeIntent(summary, args.title);
            payloadText = JSON.stringify({ summary, intent }, null, 2);
          } else {
            const cp = await synthesizer.autoCheckpoint(cwd, { title: args.title });
            payloadText = JSON.stringify({ ok: true, checkpoint: cp }, null, 2);
          }
          break;
        }

        case 'sync_obsidian_lens': {
          const lens = new CausalObsidianLensEngine(store, contextStore);
          const vaultPath = typeof args.vaultPath === 'string' ? args.vaultPath : undefined;
          if (args.action === 'export') {
            const exp = await lens.exportToVault(vaultPath);
            payloadText = JSON.stringify(exp, null, 2);
          } else if (args.action === 'import') {
            const imp = await lens.importFromVault(vaultPath);
            payloadText = JSON.stringify(imp, null, 2);
          } else {
            const syncRes = await lens.syncWithVault(vaultPath);
            payloadText = JSON.stringify(syncRes, null, 2);
          }
          break;
        }

        default:
          return {
            jsonrpc: '2.0',
            id: id ?? null,
            error: {
              code: -32601,
              message: `지원하지 않는 인과율 메모리 도구입니다: ${toolName}`,
            },
          };
      }

      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          content: [{ type: 'text', text: payloadText }],
        },
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          content: [
            {
              type: 'text',
              text: `인과율 메모리 도구 실행 오류: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

/**
 * 인과율 메모리 독립 로컬 서버 (Causal Memory HTTP & MCP Daemon)
 */
export function startCausalServer(options: ServerOptions = {}) {
  const port = options.port || CAUSAL_MEMORY_CONFIG.DEFAULT_PORT;
  const host = options.host || CAUSAL_MEMORY_CONFIG.DEFAULT_HOST;
  const store = new CausalMemoryStore(options.dbPath);
  const contextStore = new ContextCheckpointStore(options.contextDbPath, options.dbPath);

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);

      const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      if (req.method === 'OPTIONS') {
        return new Response(null, { headers });
      }

      try {
        // 1. 헬스체크 및 상태 엔드포인트
        if (url.pathname === '/health' || url.pathname === '/status') {
          store.reloadIfNeeded();
          return new Response(JSON.stringify({ ok: true, status: store.getStatus() }), { headers });
        }

        // 2. 공명 쿼리 엔드포인트 (GET /query)
        if (url.pathname === '/query' && req.method === 'GET') {
          store.reloadIfNeeded();
          const files = url.searchParams.getAll('files');
          const keywords = url.searchParams.getAll('keywords');
          const command = url.searchParams.get('command') || undefined;
          const domain = url.searchParams.get('domain') || undefined;

          const result = store.queryResonance({ files, keywords, command, domain });
          return new Response(JSON.stringify(result), { headers });
        }

        // 3. 공명 쿼리 엔드포인트 (POST /query)
        if (url.pathname === '/query' && req.method === 'POST') {
          store.reloadIfNeeded();
          const body = await req.json();
          let files: string[] = Array.isArray(body.files) ? body.files : [];
          if (body.autoGit === true && files.length === 0) {
            files = await detectModifiedFiles(body.cwd);
          }
          const result = store.queryResonance({
            files,
            keywords: body.keywords,
            command: body.command,
            domain: body.domain,
            propagateRelations: body.propagateRelations,
            maxHops: body.maxHops,
          });
          const format = url.searchParams.get('format') || body.format;

          if (format === 'markdown' || format === 'md') {
            return new Response(formatResonanceForAgent(result, false), {
              headers: { ...headers, 'Content-Type': 'text/markdown; charset=utf-8' },
            });
          }

          if (format === 'compact') {
            return new Response(formatResonanceForAgent(result, true), { headers });
          }

          return new Response(JSON.stringify(result), { headers });
        }

        // 4. 인과 규칙 등록/갱신 (POST /assert)
        if (url.pathname === '/assert' && req.method === 'POST') {
          store.reloadIfNeeded();
          const body: CausalRule = await req.json();
          store.assertRule(body);
          return new Response(JSON.stringify({ ok: true, id: body.id }), { headers });
        }

        // 5. 무결성 감사 (GET /audit)
        if (url.pathname === '/audit') {
          store.reloadIfNeeded();
          const auditResult = store.audit();
          return new Response(JSON.stringify(auditResult), { headers });
        }

        // 5-2. 피어 간 인과율 동기화 덤프 (GET /sync)
        if (url.pathname === '/sync' && req.method === 'GET') {
          const rawDb = store.getRawDatabase();
          return new Response(JSON.stringify(rawDb), { headers });
        }

        // 5-3. 피어 간 인과율 동기화 병합 (POST /sync)
        if (url.pathname === '/sync' && req.method === 'POST') {
          const body = await req.json();
          const incomingRules = Array.isArray(body.rules) ? body.rules : [];
          const incomingRelations = Array.isArray(body.relations) ? body.relations : [];
          const mergeResult = store.mergeDatabase(incomingRules, incomingRelations);
          return new Response(JSON.stringify({ ok: true, ...mergeResult }), { headers });
        }

        // 5-4. 컨텍스트 체크포인트 조회 (GET /context)
        if (url.pathname === '/context' && req.method === 'GET') {
          contextStore.reloadIfNeeded();
          const id = url.searchParams.get('id') || undefined;
          const sessionId = url.searchParams.get('sessionId') || undefined;
          const listMode = url.searchParams.get('list') === 'true';

          if (listMode) {
            const list = contextStore.listCheckpoints({ sessionId });
            return new Response(JSON.stringify({ ok: true, checkpoints: list }), { headers });
          }

          const found = contextStore.getCheckpoint(id || 'latest', sessionId);
          return new Response(JSON.stringify({ ok: Boolean(found), checkpoint: found }), { headers });
        }

        // 5-5. 컨텍스트 체크포인트 저장 (POST /context)
        if (url.pathname === '/context' && req.method === 'POST') {
          const body: SaveCheckpointInput = await req.json();
          const saved = await contextStore.saveCheckpoint(body);
          return new Response(JSON.stringify({ ok: true, checkpoint: saved }), { headers });
        }

        // 5-6. 타임라인 및 시계열 조회 (GET /timeline)
        if (url.pathname === '/timeline' && req.method === 'GET') {
          const timeSeries = new CausalTimeSeriesEngine(contextStore, store);
          const limit = parseInt(url.searchParams.get('limit') || '20', 10);
          const tl = timeSeries.generateTimeline(limit);
          return new Response(JSON.stringify({ ok: true, timeline: tl }), { headers });
        }

        // 5-7. 함정 스캔 및 등록 (GET/POST /graveyard)
        if (url.pathname === '/graveyard') {
          const graveyard = new CausalGraveyardStore(store);
          if (req.method === 'GET') {
            const list = graveyard.getAllTraps();
            return new Response(JSON.stringify({ ok: true, traps: list }), { headers });
          }
          if (req.method === 'POST') {
            const body = await req.json();
            if (body.action === 'scan') {
              const scanRes = graveyard.scanTraps({
                files: body.files,
                keywords: body.keywords,
              });
              return new Response(JSON.stringify({ ok: true, scan: scanRes }), { headers });
            }
            const trap = graveyard.assertTrap(body);
            return new Response(JSON.stringify({ ok: true, trap }), { headers });
          }
        }

        // 5-8. 컨텍스트 브랜치 (GET/POST /branch)
        if (url.pathname === '/branch') {
          const branchStore = new CausalBranchStore(contextStore);
          if (req.method === 'GET') {
            return new Response(
              JSON.stringify({
                ok: true,
                current: branchStore.getCurrentBranch(),
                branches: branchStore.listBranches(),
              }),
              { headers }
            );
          }
          if (req.method === 'POST') {
            const body = await req.json();
            if (body.action === 'create') {
              const b = await branchStore.createBranch(body.name, {
                description: body.fromBranch,
              });
              return new Response(JSON.stringify({ ok: true, branch: b }), { headers });
            }
            if (body.action === 'switch') {
              const b = branchStore.switchBranch(body.name);
              return new Response(JSON.stringify({ ok: true, branch: b }), { headers });
            }
            if (body.action === 'merge') {
              const res = await branchStore.mergeBranch(body.name, body.targetBranch);
              return new Response(JSON.stringify(res), { headers });
            }
            if (body.action === 'abandon') {
              const res = branchStore.abandonBranch(
                body.name,
                body.failureReason,
                body.safeAlternative
              );
              return new Response(JSON.stringify(res), { headers });
            }
          }
        }

        // 5-9. 파급 영향 예측 (POST /predict)
        if (url.pathname === '/predict' && req.method === 'POST') {
          const predictor = new CausalPredictorEngine(store, contextStore);
          const body = await req.json();
          const files = Array.isArray(body.files) ? body.files : [];
          const maxHops = typeof body.maxHops === 'number' ? body.maxHops : 3;
          const report = predictor.analyzeBlastRadius(files, maxHops);
          return new Response(JSON.stringify({ ok: true, report }), { headers });
        }

        // 5-10. 자동 역합성 (POST /synthesize)
        if (url.pathname === '/synthesize' && req.method === 'POST') {
          const synthesizer = new CausalSynthesizerEngine(contextStore, store);
          const body = await req.json();
          const cwd = typeof body.cwd === 'string' ? body.cwd : process.cwd();
          if (body.autoCheckpoint === false) {
            const summary = await synthesizer.inspectGitChanges(cwd);
            const intent = synthesizer.synthesizeIntent(summary, body.title);
            return new Response(JSON.stringify({ ok: true, summary, intent }), { headers });
          }
          const cp = await synthesizer.autoCheckpoint(cwd, { title: body.title });
          return new Response(JSON.stringify({ ok: true, checkpoint: cp }), { headers });
        }

        // 5-11. 옵시디언 렌즈 (POST /lens)
        if (url.pathname === '/lens' && req.method === 'POST') {
          const lens = new CausalObsidianLensEngine(store, contextStore);
          const body = await req.json();
          const vaultPath = typeof body.vaultPath === 'string' ? body.vaultPath : undefined;
          if (body.action === 'export') {
            const res = await lens.exportToVault(vaultPath);
            return new Response(JSON.stringify(res), { headers });
          }
          if (body.action === 'import') {
            const res = await lens.importFromVault(vaultPath);
            return new Response(JSON.stringify(res), { headers });
          }
          const syncRes = await lens.syncWithVault(vaultPath);
          return new Response(JSON.stringify(syncRes), { headers });
        }

        // 6. MCP 호환 JSON-RPC 엔드포인트 (POST /mcp)
        if (url.pathname === '/mcp' && req.method === 'POST') {
          const rpc: JsonRpcRequest = await req.json();
          const responseObj = await handleMcpJsonRpcRequest(
            rpc,
            store,
            options.dbPath,
            options.contextDbPath
          );
          if (!responseObj) {
            return new Response(null, { status: 204, headers });
          }
          return new Response(JSON.stringify(responseObj), { headers });
        }

        return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          { status: 500, headers }
        );
      }
    },
  });

  return server;
}

/**
 * MCP 표준 입출력(stdio) 서버 모드
 * Antigravity / Claude Code 등의 MCP 호스트가 프로세스를 직접 스폰하여 통신할 때 동작합니다.
 * 원격 데몬 URL(Tailscale 피어 등) 또는 로컬 데몬(4242 포트)이 지정/실행 중이면 데몬으로 프록시하고,
 * 꺼져 있으면 인메모리 스토어로 즉시 안전하게 응답합니다.
 */
export async function startCausalMcpStdioServer(dbPath?: string, remoteUrl?: string): Promise<void> {
  const store = new CausalMemoryStore(dbPath);
  const targetRemote = remoteUrl || CAUSAL_MEMORY_CONFIG.REMOTE_URL;
  const isRemoteMode = Boolean(targetRemote && targetRemote.trim().length > 0);

  const activeDaemonUrl = isRemoteMode
    ? targetRemote.endsWith('/mcp')
      ? targetRemote
      : `${targetRemote.replace(/\/+$/, '')}/mcp`
    : `http://${CAUSAL_MEMORY_CONFIG.DEFAULT_HOST}:${CAUSAL_MEMORY_CONFIG.DEFAULT_PORT}/mcp`;

  const timeoutMs = isRemoteMode
    ? CAUSAL_MEMORY_CONFIG.REMOTE_TIMEOUT_MS
    : 150;

  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const rpc: JsonRpcRequest = JSON.parse(trimmed);
      let responseObj: Record<string, any> | null = null;

      // tools/call 실행 시 원격 또는 로컬 데몬으로 프록시 위임 시도
      if (rpc.method === 'tools/call') {
        try {
          const daemonRes = await fetch(activeDaemonUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: trimmed,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (daemonRes.ok) {
            responseObj = await daemonRes.json();
          }
        } catch {
          // 데몬 미실행 또는 통신 타임아웃 시 자체 인메모리 스토어로 폴백
        }
      }

      if (!responseObj) {
        responseObj = await handleMcpJsonRpcRequest(rpc, store, dbPath);
      }

      if (responseObj) {
        process.stdout.write(JSON.stringify(responseObj) + '\n');
      }
    } catch (error) {
      const errResp = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `JSON Parse error: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
      process.stdout.write(JSON.stringify(errResp) + '\n');
    }
  }
}
