/**
 * 시냅스 11대 코어 공식 MCP 도구 레지스트리 (Synapse MCP Tool Registry)
 */
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
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
        mode: {
          type: "string",
          description: "검색 모드: basic(기본 BM25) 또는 dci(Synapse-DCI 다중 홉 동적 워크스페이스 Pull)",
        },
        hops: {
          type: "number",
          description: "DCI 모드 시 Connectome 확장 홉 깊이 (기본: 2)",
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
    name: "synapse_dci_ingest",
    description: "12종 문서(PDF, DOCX, PPTX, XLSX, HWPX, HWP5, HTML, CSV, JSON, YAML, XML, MD)를 Synapse-DCI로 파싱하고 선택적으로 Aside 메모리에 투영합니다.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "인제스트할 로컬 문서 파일 경로" },
        collection: { type: "string", description: "문서 컬렉션 이름 (기본: dci-docs)" },
        projectToAside: { type: "boolean", description: "Aside 마크다운 메모리(concepts/)로 자동 투영할지 여부" },
        asideMemoryDir: { type: "string", description: "Aside 메모리 루트 경로 (기본: ~/.aside/u/1/memory)" },
        compact: { type: "boolean", description: "단일 라인 초경량 JSON 반환 여부" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "synapse_dci_edit",
    description: "텍스트/구조화 문서(MD, CSV, JSON, YAML, HTML, XML) 및 ZIP-XML 문서(HWPX, DOCX, PPTX, XLSX)를 안전하게 수정·저장합니다.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "수정할 문서 파일 경로" },
        operation: {
          type: "string",
          description: "수정 연산: replace_text | append | prepend | overwrite | json_patch | append_paragraph | remove_page_breaks | batch",
        },
        target: { type: "string", description: "replace_text 시 찾을 문자열" },
        replacement: { type: "string", description: "replace_text 시 바꿀 문자열" },
        content: { type: "string", description: "append / prepend / overwrite / append_paragraph 시 내용" },
        replaceAll: { type: "boolean", description: "모든 일치 항목 치환 여부 (기본: true)" },
        keyPath: { type: "string", description: "json_patch 시 점(.) 구분 키 경로" },
        value: { description: "json_patch 시 설정할 JSON 값" },
        edits: { type: "array", description: "batch 연산 시 순차 실행할 수정 단계 배열" },
        dryRun: { type: "boolean", description: "실제 저장 없이 변경 건수만 시뮬레이션" },
        backup: { type: "boolean", description: "수정 전 .bak 백업 파일 생성 여부" },
        compact: { type: "boolean", description: "단일 라인 초경량 JSON 반환 여부" },
      },
      required: ["filePath", "operation"],
    },
  },
  {
    name: "synapse_ai_search",
    description: "Synapse-DCI Multi-Hop + Connectome 하이브리드 검색을 볼트/Aside 메모리에서 수행합니다.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "검색 쿼리 문자열" },
        vaultDir: { type: "string", description: `검색할 마크다운 볼트 또는 Aside 메모리 경로 (기본: ${MCP_SERVER_CONFIG.DEFAULT_VAULT_DIR})` },
        topK: { type: "number", description: "최대 반환 문서 수 (기본: 8)" },
        compact: { type: "boolean", description: "단일 라인 초경량 JSON 반환 여부" },
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
const vaultDbCache = new Map<string, any>();

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
        const rawVaultDir = String(args.vaultDir || MCP_SERVER_CONFIG.DEFAULT_VAULT_DIR);
        if (rawVaultDir.includes("\0")) {
          throw new Error("[MCP Security] vaultDir에 허용되지 않은 널 바이트가 포함되어 있습니다.");
        }
        const vaultDir = resolve(rawVaultDir);
        const cwdRoot = resolve(process.cwd());
        const tmpRoot = resolve(tmpdir());
        const inBounds = (root: string, target: string) =>
          target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
        if (!inBounds(cwdRoot, vaultDir) && !inBounds(tmpRoot, vaultDir)) {
          throw new Error(`[MCP Security] 허용된 작업/임시 디렉터리 외부 볼트 경로가 차단되었습니다: ${rawVaultDir}`);
        }
        const mode = String(args.mode || "basic");
        let db = vaultDbCache.get(vaultDir);
        if (!db) {
          const dbMod = await getCachedDbMod();
          db = new dbMod.SynapseDB({ vaultDir, autoWatch: false });
          await db.init();
          vaultDbCache.set(vaultDir, db);
        }

        if (mode === "dci") {
          const hops = typeof args.hops === "number" ? args.hops : undefined;
          const ws = db.createDciWorkspace();
          const dciResult = ws.pull(query, { hops });
          return {
            content: [
              {
                type: "text",
                text: serializePayload({ ok: true, mode: "dci", query, vaultDir, ...dciResult }, isCompact),
              },
            ],
          };
        }

        const searchResults = db.engine.connectome.search(query);

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

      case "synapse_dci_ingest": {
        const rawFilePath = String(args.filePath || "").trim();
        if (!rawFilePath || rawFilePath.includes("\0")) {
          throw new Error("[MCP Security] 유효하지 않은 filePath입니다.");
        }
        const filePath = resolve(rawFilePath);
        const collection = String(args.collection || "dci-docs");
        const projectToAside = args.projectToAside === true;

        const dbMod = await getCachedDbMod();
        const connectome = new dbMod.SynapseConnectome();
        const { document, parsed } = dbMod.ingestAnyDocumentFile(connectome, filePath, { collection });

        let projectedPath: string | undefined;
        if (projectToAside) {
          const { homedir } = await import("os");
          const { existsSync, mkdirSync, writeFileSync } = await import("fs");
          const { createHash } = await import("crypto");

          const rawAside = String(args.asideMemoryDir || resolve(homedir(), ".aside", "u", "1", "memory"));
          if (rawAside.includes("\0")) {
            throw new Error("[MCP Security] asideMemoryDir에 허용되지 않은 널 바이트가 포함되어 있습니다.");
          }
          const asideDir = resolve(rawAside);
          const cwdRoot = resolve(process.cwd());
          const tmpRoot = resolve(tmpdir());
          const defaultAside = resolve(homedir(), ".aside");
          const inBounds = (root: string, target: string) =>
            target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
          if (!inBounds(cwdRoot, asideDir) && !inBounds(tmpRoot, asideDir) && !inBounds(defaultAside, asideDir)) {
            throw new Error(`[MCP Security] 허용된 작업/임시/Aside 디렉터리 외부 경로가 차단되었습니다: ${rawAside}`);
          }

          const conceptsDir = resolve(asideDir, "concepts");
          if (!existsSync(conceptsDir)) {
            mkdirSync(conceptsDir, { recursive: true });
          }

          const slug =
            String(document.id || "dci-document")
              .toLowerCase()
              .replace(/[^a-z0-9가-힣_-]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 80) || "dci-document";
          const title = (typeof document.data?.title === "string" && document.data.title) || slug;
          const bodyContent = `# ${title}\n\n- **Format**: \`${parsed.format}\`\n- **Source**: \`${filePath}\`\n\n## 📄 Document Content\n\n${document.body.trim()}`;
          const contentHash = createHash("sha256").update(bodyContent).digest("hex").slice(0, 16);
          const md = [
            "---",
            "managed_by: synapse-aside",
            `synapse_id: dci-${slug}`,
            `last_synced: ${new Date().toISOString()}`,
            `content_hash: ${contentHash}`,
            `domain: ${parsed.format}`,
            "entity_type: dci-document",
            "---",
            "",
            bodyContent,
            "",
          ].join("\n");

          projectedPath = resolve(conceptsDir, `${slug}.md`);
          writeFileSync(projectedPath, md, "utf-8");
        }

        const payload = {
          ok: true,
          format: parsed.format,
          documentId: document.id,
          collection: document.collection,
          charCount: document.body.length,
          projectedPath,
          preview: document.body.slice(0, 400),
        };

        return {
          content: [{ type: "text", text: serializePayload(payload, isCompact) }],
        };
      }

      case "synapse_dci_edit": {
        const rawFilePath = String(args.filePath || "").trim();
        if (!rawFilePath || rawFilePath.includes("\0")) {
          throw new Error("[MCP Security] 유효하지 않은 filePath입니다.");
        }
        const filePath = resolve(rawFilePath);
        const cwdRoot = resolve(process.cwd());
        const tmpRoot = resolve(tmpdir());
        const inBounds = (root: string, target: string) =>
          target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
        if (!inBounds(cwdRoot, filePath) && !inBounds(tmpRoot, filePath)) {
          throw new Error(`[MCP Security] 허용된 작업/임시 디렉터리 외부 파일 수정이 차단되었습니다: ${rawFilePath}`);
        }

        const operation = String(args.operation || "replace_text") as any;
        const dbMod = await getCachedDbMod();
        const result = dbMod.editDocumentFile(filePath, {
          operation,
          target: typeof args.target === "string" ? args.target : undefined,
          replacement: typeof args.replacement === "string" ? args.replacement : undefined,
          content: typeof args.content === "string" ? args.content : undefined,
          replaceAll: typeof args.replaceAll === "boolean" ? args.replaceAll : true,
          keyPath: typeof args.keyPath === "string" ? args.keyPath : undefined,
          value: args.value,
          edits: Array.isArray(args.edits) ? (args.edits as any[]) : undefined,
          dryRun: args.dryRun === true,
          backup: args.backup === true,
        });

        return {
          content: [{ type: "text", text: serializePayload(result, isCompact) }],
        };
      }

      case "synapse_ai_search": {
        const query = String(args.query || "").trim();
        const rawVaultDir = String(args.vaultDir || MCP_SERVER_CONFIG.DEFAULT_VAULT_DIR);
        if (rawVaultDir.includes("\0")) {
          throw new Error("[MCP Security] vaultDir에 허용되지 않은 널 바이트가 포함되어 있습니다.");
        }
        const vaultDir = resolve(rawVaultDir);
        const cwdRoot = resolve(process.cwd());
        const tmpRoot = resolve(tmpdir());
        const { homedir } = await import("os");
        const defaultAside = resolve(homedir(), ".aside");
        const inBounds = (root: string, target: string) =>
          target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
        if (!inBounds(cwdRoot, vaultDir) && !inBounds(tmpRoot, vaultDir) && !inBounds(defaultAside, vaultDir)) {
          throw new Error(`[MCP Security] 허용된 작업/임시/Aside 디렉터리 외부 볼트 경로가 차단되었습니다: ${rawVaultDir}`);
        }

        const topK = typeof args.topK === "number" ? args.topK : 8;
        let db = vaultDbCache.get(vaultDir);
        if (!db) {
          const dbMod = await getCachedDbMod();
          db = new dbMod.SynapseDB({ vaultDir, autoWatch: false });
          await db.init();
          vaultDbCache.set(vaultDir, db);
        }

        const ws = db.createDciWorkspace();
        const dciResult = ws.pull(query, { topK, hops: 2 });

        const payload = {
          ok: true,
          query,
          vaultDir,
          total: dciResult.entries.length,
          results: dciResult.entries.map((e: any) => ({
            id: e.id,
            collection: e.collection,
            score: e.score,
            source: e.source,
            snippet: e.snippet,
          })),
        };

        return {
          content: [{ type: "text", text: serializePayload(payload, isCompact) }],
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
