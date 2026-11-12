/**
 * 시냅스 옵틱(Synapse Optic) 접근성 트리 압축 및 에이전트 포매터
 * - 거대한 HTML 마크업(수만 줄)을 배제하고 상호작용 가능한 ARIA 노드만 96% 압축
 */
import type { ActionableNode, ReferenceNode } from "./types";
import { OPTIC_DEFAULTS } from "./config";

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
   * 1:1 바인딩된 스냅샷 참조 노드 목록을 에이전트용 넘버링 목록으로 직렬화
   */
  public static formatReferenceSnapshot(references: readonly (readonly [string, string, string])[]): ReferenceNode[] {
    return references.map(([ref, role, label], index) => {
      const shortAlias = `@${index + 1}`;
      return {
        reference: ref,
        role,
        label,
        shortAlias,
      };
    });
  }

  /**
   * 넘버링 목록을 LLM 1줄 요약 텍스트로 생성
   */
  public static formatSnapshotSummary(nodes: readonly ReferenceNode[]): string {
    const lines: string[] = [];
    lines.push(`📑 [Synapse Optic Interactive Snapshot - ${nodes.length} Elements]`);
    for (const n of nodes) {
      const alias = n.shortAlias ?? n.reference;
      lines.push(`  • [${alias}] <${n.role}> "${n.label}"`);
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
