/**
 * 시냅스 11대 코어 공식 MCP 도구 레지스트리 (Synapse MCP Tool Registry)
 */
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
          description: "최대 반환 규칙 개수 (기본: 10)",
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
          description: "파일명 (기본: source.ts)",
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
        contextName: {
          type: "string",
          description: "검증 대상 컨텍스트 명칭",
        },
        invariants: {
          type: "array",
          items: { type: "string" },
          description: "검증할 불변식 표현식 목록",
        },
      },
      required: ["contextName"],
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
      },
      required: ["query"],
    },
  },
];

/**
 * MCP 도구 실행 디스패처
 */
export async function executeMcpTool(name: string, args: Record<string, any> = {}): Promise<McpToolResult> {
  try {
    switch (name) {
      case "synapse_causal_query": {
        const queryStr = String(args.query || "");
        const limit = Number(args.limit || 10);
        
        let memoryMod: any;
        try {
          // @ts-ignore
          memoryMod = await import("../../memory");
        } catch {
          // @ts-ignore
          memoryMod = await import("../memory");
        }
        
        const store = new memoryMod.CausalStore();
        const results = store.queryRules(queryStr).slice(0, limit);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, query: queryStr, total: results.length, rules: results }, null, 2),
            },
          ],
        };
      }

      case "synapse_guard_audit": {
        const code = String(args.code || "");
        const fileName = String(args.fileName || "source.ts");

        let guardMod: any;
        try {
          // @ts-ignore
          guardMod = await import("../../guard");
        } catch {
          // @ts-ignore
          guardMod = await import("../guard");
        }

        const guard = new guardMod.SynapseGuard();
        const report = guard.auditSource(code, fileName);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(report, null, 2),
            },
          ],
          isError: !report.ok,
        };
      }

      case "synapse_verifier_check": {
        const contextName = String(args.contextName || "global");
        const invariants = Array.isArray(args.invariants) ? args.invariants : [];

        let verifierMod: any;
        try {
          // @ts-ignore
          verifierMod = await import("../../verifier");
        } catch {
          // @ts-ignore
          verifierMod = await import("../verifier");
        }

        const verifier = new verifierMod.RuntimeVerifier();
        const report = verifier.verifyAll({ contextName, invariants });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(report, null, 2),
            },
          ],
          isError: !report.passed,
        };
      }

      case "synapse_optic_survey": {
        const text = String(args.text || "");

        let opticMod: any;
        try {
          // @ts-ignore
          opticMod = await import("../../optic");
        } catch {
          // @ts-ignore
          opticMod = await import("../optic");
        }

        const analyzer = new opticMod.CausalPaperAnalyzer();
        analyzer.initializeKnowledgeGraph();
        const analysis = analyzer.analyze(text);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(analysis, null, 2),
            },
          ],
        };
      }

      case "synapse_db_search": {
        const query = String(args.query || "");

        let dbMod: any;
        try {
          // @ts-ignore
          dbMod = await import("../../db");
        } catch {
          // @ts-ignore
          dbMod = await import("../db");
        }

        const engine = new dbMod.MarkdownDbEngine();
        const searchResults = engine.search(query);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, query, results: searchResults }, null, 2),
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
