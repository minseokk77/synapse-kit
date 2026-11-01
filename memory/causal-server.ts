import { createInterface } from 'node:readline';
import { CAUSAL_MEMORY_CONFIG } from './causal-config';
import { CausalMemoryStore, type CausalRule } from './causal-store';
import { runCausalQuery, formatResonanceForAgent, detectModifiedFiles } from './causal-query';

export interface ServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly dbPath?: string;
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
] as const;

/**
 * MCP JSON-RPC 2.0 요청 통합 처리기 (HTTP 데몬 및 Stdio 서버 공용)
 */
export async function handleMcpJsonRpcRequest(
  rpc: JsonRpcRequest,
  store: CausalMemoryStore,
  dbPath?: string
): Promise<Record<string, any> | null> {
  const { id, method, params } = rpc;

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
          payloadText = JSON.stringify({ ...audit, status }, null, 2);
          break;
        }

        case 'read_graph': {
          const gitFiles = await detectModifiedFiles();
          const smartGraph = store.readSmartGraph(gitFiles);
          payloadText = JSON.stringify(smartGraph, null, 2);
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

        // 6. MCP 호환 JSON-RPC 엔드포인트 (POST /mcp)
        if (url.pathname === '/mcp' && req.method === 'POST') {
          const rpc: JsonRpcRequest = await req.json();
          const responseObj = await handleMcpJsonRpcRequest(rpc, store, options.dbPath);
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
 * 로컬 데몬(4242 포트)이 실행 중이면 데몬으로 프록시하고, 꺼져 있으면 인메모리 스토어로 즉시 응답합니다.
 */
export async function startCausalMcpStdioServer(dbPath?: string): Promise<void> {
  const store = new CausalMemoryStore(dbPath);
  const daemonUrl = `http://${CAUSAL_MEMORY_CONFIG.DEFAULT_HOST}:${CAUSAL_MEMORY_CONFIG.DEFAULT_PORT}/mcp`;

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

      // tools/call 실행 시 로컬 데몬이 떠 있다면 우선 위임 시도 (데몬 미가동 시 즉시 로컬 스토어로 폴백)
      if (rpc.method === 'tools/call') {
        try {
          const daemonRes = await fetch(daemonUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: trimmed,
            signal: AbortSignal.timeout(150),
          });
          if (daemonRes.ok) {
            responseObj = await daemonRes.json();
          }
        } catch {
          // 데몬 미실행 상태일 경우 자체 인메모리 스토어에서 0ms 직접 처리
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
