/**
 * 시냅스 옵틱(Synapse Optic) 접근성 트리 압축 및 에이전트 포매터
 * - 거대한 HTML 마크업(수만 줄)을 배제하고 상호작용 가능한 ARIA 노드만 96% 압축
 */
import type { ActionableNode, ReferenceNode } from "./types";
import { OPTIC_DEFAULTS } from "./config";

const MAX_PRECOMPUTED_ALIASES = 8192;
const SHORT_ALIASES: string[] = new Array(MAX_PRECOMPUTED_ALIASES);
for (let i = 0; i < MAX_PRECOMPUTED_ALIASES; i++) {
  SHORT_ALIASES[i] = `@${i + 1}`;
}
const SUMMARY_WINDOW_LIMIT = 64;
const SUMMARY_HALF_WINDOW = 32;

export class A11yParser {
  /**
   * 압축된 인터랙티브 노드 목록을 AI 에이전트(LLM)가 1턴에 이해할 수 있는 텍스트 포맷으로 직렬화
   */
  public static formatForAgent(nodes: readonly ActionableNode[]): string {
    return nodes
      .map((n) => {
        const indent = "  ".repeat(Math.min(n.depth, 4));
        const boundsStr = n.bounds
          ? ` [${Math.round(n.bounds.x)},${Math.round(n.bounds.y)},${Math.round(n.bounds.width)}x${Math.round(n.bounds.height)}]`
          : "";
        const valStr = n.value ? ` (value: "${n.value}")` : "";
        return `${indent}[${n.role}] "${n.label}"${boundsStr}${valStr} (id: ${n.id})`;
      })
      .join("\n");
  }

  /**
   * 1:1 바인딩된 스냅샷 참조 노드 목록을 에이전트용 넘버링 목록으로 직렬화 (배열 및 별칭 사전 할당)
   */
  public static formatReferenceSnapshot(references: readonly (readonly [string, string, string])[]): ReferenceNode[] {
    const len = references.length;
    const result = new Array<ReferenceNode>(len);
    for (let i = 0; i < len; i++) {
      const item = references[i];
      result[i] = {
        reference: item[0],
        role: item[1],
        label: item[2],
        shortAlias: i < MAX_PRECOMPUTED_ALIASES ? SHORT_ALIASES[i] : `@${i + 1}`,
      };
    }
    return result;
  }

  /**
   * 넘버링 목록을 LLM 1줄 요약 텍스트로 생성 (Head/Tail 64노드 윈도우 압축)
   */
  public static formatSnapshotSummary(nodes: readonly ReferenceNode[]): string {
    const len = nodes.length;
    if (len <= SUMMARY_WINDOW_LIMIT) {
      const lines = new Array<string>(len + 1);
      lines[0] = `📑 [Synapse Optic Interactive Snapshot - ${len} Elements]`;
      for (let i = 0; i < len; i++) {
        const n = nodes[i];
        const alias = n.shortAlias ?? n.reference;
        lines[i + 1] = `  • [${alias}] <${n.role}> "${n.label}"`;
      }
      return lines.join("\n");
    }

    const lines = new Array<string>(SUMMARY_WINDOW_LIMIT + 2);
    lines[0] = `📑 [Synapse Optic Interactive Snapshot - ${len} Elements]`;
    for (let i = 0; i < SUMMARY_HALF_WINDOW; i++) {
      const n = nodes[i];
      lines[i + 1] = `  • [${n.shortAlias ?? n.reference}] <${n.role}> "${n.label}"`;
    }
    lines[SUMMARY_HALF_WINDOW + 1] = `  ... (${len - SUMMARY_WINDOW_LIMIT}개 중간 노드 윈도우 압축 생략) ...`;
    const tailStart = len - SUMMARY_HALF_WINDOW;
    for (let i = 0; i < SUMMARY_HALF_WINDOW; i++) {
      const n = nodes[tailStart + i];
      lines[SUMMARY_HALF_WINDOW + 2 + i] = `  • [${n.shortAlias ?? n.reference}] <${n.role}> "${n.label}"`;
    }
    return lines.join("\n");
  }

  /**
   * 특정 역할이 상호작용 가능한 역할인지 판별
   */
  public static isInteractiveRole(role: string): boolean {
    return OPTIC_DEFAULTS.INTERACTIVE_ROLES.has(role.toLowerCase());
  }
}
