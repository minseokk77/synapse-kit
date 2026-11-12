/**
 * 시냅스 11대 코어 공식 MCP 도구 레지스트리 (Synapse MCP Tool Registry)
 */
import { MCP_SERVER_CONFIG } from "./config";
import type { McpTool, McpToolResult } from "./types";

export const SYNAPSE_MCP_TOOLS: McpTool[] = [
  {
    name: "synapse_causal_query",
    description: "시냅스 Causal Memory의 인과 그래프 및 공명 규칙을 검색합니다.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "검색할 인과 키워드 또는 엔터티 이름",
        },
        limit: {
          type: "number",
          description: `최대 반환 규칙 개수 (기본: ${MCP_SERVER_CONFIG.DEFAULT_QUERY_LIMIT})`,
        },
        domain: {
          type: "string",
          description: "선택적 도메인 필터",
        },
        compact: {
          type: "boolean",
          description: "단일 라인 초경량 JSON 반환 여부",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "synapse_guard_audit",
    description: "소스 코드 또는 문서 내 시크릿 유출, 취약점(SQLi, eval), 볼트 XSS를 AST 레벨에서 감사 및 차단합니다.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "감사할 소스 코드 또는 텍스트",
        },
        fileName: {
          type: "string",
          description: `파일명 (기본: ${MCP_SERVER_CONFIG.DEFAULT_FILE_NAME})`,
        },
        compact: {
          type: "boolean",
          description: "단일 라인 초경량 JSON 반환 여부",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "synapse_verifier_check",
    description: "시냅스 상태 전이 및 런타임 불변식(Invariant)을 정밀 검증합니다.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "검증할 소스 코드",
        },
        fileName: {
          type: "string",
          description: `대상 파일명 (기본: ${MCP_SERVER_CONFIG.DEFAULT_FILE_NAME})`,
        },
        contextName: {
          type: "string",
          description: "컨텍스트 명칭",
        },
        compact: {
          type: "boolean",
          description: "단일 라인 초경량 JSON 반환 여부",
        },
      },
      required: [],
    },
  },
  {
    name: "synapse_optic_survey",
    description: "시냅스 옵틱 초경량 엔진을 이용해 논문 및 웹 문서의 인과 공명(Connectome)을 초고속 분석합니다.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "분석할 논문 초록 또는 웹페이지 텍스트",
        },
        compact: {
          type: "boolean",
          description: "단일 라인 초경량 JSON 반환 여부",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "synapse_db_search",
    description: "시냅스 마크다운 볼트 및 SQLite WAL 저장소의 엔터티를 BM25/Connectome으로 검색합니다.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "검색 쿼리 문자열",
        },
        vaultDir: {
          type: "string",
          description: `검색할 마크다운 볼트 경로 (기본: ${MCP_SERVER_CONFIG.DEFAULT_VAULT_DIR})`,
        },
        compact: {
          type: "boolean",
          description: "단일 라인 초경량 JSON 반환 여부",
        },
      },
      required: ["query"],
    },
  },
];

// 지연 초기화 싱글턴 캐시 변수
let cachedMemoryStore: any = null;
let cachedGuard: any = null;
let cachedVerifier: any = null;
let cachedOpticAnalyzer: any = null;
let cachedDbMod: any = null;

async function getCachedMemoryStore(): Promise<any> {
  if (!cachedMemoryStore) {
    let memoryMod: any;
    try {
      // @ts-ignore
      memoryMod = await import("../../memory");
    } catch {
      // @ts-ignore
      memoryMod = await import("../memory");
    }
    cachedMemoryStore = new memoryMod.CausalMemoryStore();
  }
  return cachedMemoryStore;
}

async function getCachedGuard(): Promise<any> {
  if (!cachedGuard) {
    let guardMod: any;
    try {
      // @ts-ignore
      guardMod = await import("../../guard");
    } catch {
      // @ts-ignore
      guardMod = await import("../guard");
    }
    cachedGuard = new guardMod.SynapseGuard();
  }
  return cachedGuard;
}

async function getCachedVerifier(): Promise<any> {
  if (!cachedVerifier) {
    let verifierMod: any;
    try {
      // @ts-ignore
      verifierMod = await import("../../verifier");
    } catch {
      // @ts-ignore
      verifierMod = await import("../verifier");
    }
    cachedVerifier = new verifierMod.SynapseVerifier();
  }
  return cachedVerifier;
}

async function getCachedOpticAnalyzer(): Promise<any> {
  if (!cachedOpticAnalyzer) {
    let opticMod: any;
    try {
      // @ts-ignore
      opticMod = await import("../../optic");
    } catch {
      // @ts-ignore
      opticMod = await import("../optic");
    }
    cachedOpticAnalyzer = new opticMod.CausalPaperAnalyzer();
    cachedOpticAnalyzer.initializeKnowledgeGraph();
  }
  return cachedOpticAnalyzer;
}

async function getCachedDbMod(): Promise<any> {
  if (!cachedDbMod) {
    try {
      // @ts-ignore
      cachedDbMod = await import("../../db");
    } catch {
      // @ts-ignore
      cachedDbMod = await import("../db");
    }
  }
  return cachedDbMod;
}

function serializePayload(payload: unknown, compact?: boolean): string {
  return compact === true ? JSON.stringify(payload) : JSON.stringify(payload, null, 2);
}

/**
 * MCP 도구 실행 디스패처
 */
export async function executeMcpTool(name: string, args: Record<string, any> = {}): Promise<McpToolResult> {
  try {
    const isCompact = Boolean(args.compact);

    switch (name) {
      case "synapse_causal_query": {
        const queryStr = String(args.query || "");
        const limit = Number(args.limit || MCP_SERVER_CONFIG.DEFAULT_QUERY_LIMIT);
        const store = await getCachedMemoryStore();

        const keywords = queryStr.split(/\s+/).filter(Boolean);
        const res = store.queryResonance({
          keywords,
          domain: args.domain ? String(args.domain) : undefined,
        });
        const rules = res.resonanceRules.slice(0, limit);

        const payload = {
          ok: true,
          query: queryStr,
          total: rules.length,
          queryDurationMs: res.queryDurationMs,
          rules,
        };

        return {
          content: [
            {
              type: "text",
              text: serializePayload(payload, isCompact),
            },
          ],
        };
      }

      case "synapse_guard_audit": {
        const code = String(args.code || "");
        const fileName = String(args.fileName || MCP_SERVER_CONFIG.DEFAULT_FILE_NAME);
        const guard = await getCachedGuard();
        const report = guard.auditSource(code, fileName);

        return {
          content: [
            {
              type: "text",
              text: serializePayload(report, isCompact),
            },
          ],
          isError: !report.ok,
        };
      }

      case "synapse_verifier_check": {
        const verifier = await getCachedVerifier();
        const codeToVerify = String(args.code || "");
        const targetFile = String(args.fileName || args.contextName || MCP_SERVER_CONFIG.DEFAULT_FILE_NAME);
        const audit = verifier.checkSource(codeToVerify, targetFile);

        const payload = {
          ok: audit.ok,
          targetFile: audit.targetFile || audit.target || targetFile,
          violations: audit.violations,
          checkedAtMs: audit.checkedAtMs || Date.now(),
        };

        return {
          content: [
            {
              type: "text",
              text: serializePayload(payload, isCompact),
            },
          ],
          isError: !audit.ok,
        };
      }

      case "synapse_optic_survey": {
        const text = String(args.text || "");
        const analyzer = await getCachedOpticAnalyzer();
        analyzer.initializeKnowledgeGraph();
        const analysis = analyzer.analyze(text);

        return {
          content: [
            {
              type: "text",
              text: serializePayload(analysis, isCompact),
            },
          ],
        };
      }

      case "synapse_db_search": {
        const query = String(args.query || "");
        const vaultDir = String(args.vaultDir || MCP_SERVER_CONFIG.DEFAULT_VAULT_DIR);
        const dbMod = await getCachedDbMod();

        const db = new dbMod.SynapseDB({ vaultDir, autoWatch: false });
        await db.init();
        const searchResults = db.engine.connectome.search(query);
        db.close();

        const payload = {
          ok: true,
          query,
          vaultDir,
          total: searchResults.length,
          results: searchResults,
        };

        return {
          content: [
            {
              type: "text",
              text: serializePayload(payload, isCompact),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: `알 수 없는 도구: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `도구 실행 실패: ${err?.message || String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
