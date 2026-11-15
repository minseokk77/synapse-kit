/**
 * 시냅스 MCP No-Box 정적 취약점 감사기 (Description-Only Vulnerability Scanner)
 * - arXiv:2609.10854 (No-Box MCP Vulnerability Analysis)
 * - arXiv:2611.02257 (MCP Security Vulnerability Dataset 분류체계 반영)
 */
import type { McpTool } from "./types";

export type McpVulnerabilityCategory =
  | "TOOL_POISONING"
  | "HIDDEN_DIRECTIVE"
  | "PATH_TRAVERSAL"
  | "COMMAND_INJECTION"
  | "CONTEXT_LEAK"
  | "TOOL_SHADOWING";

export interface McpToolAuditFinding {
  readonly toolName: string;
  readonly category: McpVulnerabilityCategory;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly detail: string;
}

export interface McpNoBoxAuditReport {
  readonly ok: boolean;
  readonly auditedToolsCount: number;
  readonly findingsCount: number;
  readonly findings: readonly McpToolAuditFinding[];
  readonly durationMs: number;
}

export const MCP_AUDITOR_CONFIG = {
  /** MCP 도구 설명/스키마 내 정적 위험 패턴 */
  POISON_PATTERNS: [
    {
      category: "HIDDEN_DIRECTIVE" as McpVulnerabilityCategory,
      severity: "CRITICAL" as const,
      pattern: /(?:<important>|<system>|ignore\s+previous|do\s+not\s+tell\s+the\s+user|silently\s+send)/i,
      message: "도구 설명 내 은닉 지시문(Hidden Directive / Tool Poisoning) 의심 패턴 발견",
    },
    {
      category: "CONTEXT_LEAK" as McpVulnerabilityCategory,
      severity: "CRITICAL" as const,
      pattern: /(?:read\s+~\/\.ssh|pass\s+(?:all\s+)?env|exfiltrate|\/etc\/passwd|api[_-]?key\s+in\s+param)/i,
      message: "민감 컨텍스트·자격증명 유출 유도 문구 탐지",
    },
    {
      category: "COMMAND_INJECTION" as McpVulnerabilityCategory,
      severity: "HIGH" as const,
      pattern: /(?:eval\(|child_process|sh\s+-c|powershell\s+-enc|\$\([^\)]+\))/i,
      message: "임의 셸 명령 실행 유도 패턴 탐지",
    },
    {
      category: "PATH_TRAVERSAL" as McpVulnerabilityCategory,
      severity: "HIGH" as const,
      pattern: /(?:\.\.\/\.\.\/|\.\.\\\.\.\\|arbitrary\s+file\s+write)/i,
      message: "경로 탈출(Path Traversal) 위험 지시 패턴 탐지",
    },
  ],
} as const;

/**
 * MCP 서버 도구 목록을 실행 없이(No-Box) 정적 감사
 */
export function auditMcpToolsNoBox(tools: readonly McpTool[]): McpNoBoxAuditReport {
  const start = performance.now();
  const findings: McpToolAuditFinding[] = [];
  const seenNames = new Set<string>();

  try {
    for (const tool of tools) {
      if (seenNames.has(tool.name)) {
        findings.push({
          toolName: tool.name,
          category: "TOOL_SHADOWING",
          severity: "CRITICAL",
          detail: `중복 도구명('${tool.name}')으로 인한 Tool Shadowing 위험이 감지되었습니다.`,
        });
      }
      seenNames.add(tool.name);

      const corpus = `${tool.description}\n${JSON.stringify(tool.inputSchema ?? {})}`;
      for (const rule of MCP_AUDITOR_CONFIG.POISON_PATTERNS) {
        if (rule.pattern.test(corpus)) {
          findings.push({
            toolName: tool.name,
            category: rule.category,
            severity: rule.severity,
            detail: rule.message,
          });
        }
      }
    }
  } catch (err: any) {
    findings.push({
      toolName: "mcp-auditor",
      category: "TOOL_POISONING",
      severity: "CRITICAL",
      detail: `MCP 정적 감사 중 예외 발생: ${err?.message || err}`,
    });
  }

  return {
    ok: findings.length === 0,
    auditedToolsCount: tools.length,
    findingsCount: findings.length,
    findings,
    durationMs: Number((performance.now() - start).toFixed(3)),
  };
}
