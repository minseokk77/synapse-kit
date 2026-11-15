/**
 * 시냅스 옵틱 인터랙티브 웹 접근성(A11y) 감사기
 * - arXiv:2610.39488 (InterA11y: Interactive Web Accessibility Error Detection)
 */
import type { ActionableNode } from "./types";

export const A11Y_AUDITOR_CONFIG = {
  /** 접근 가능 이름이 필수인 인터랙티브 역할 */
  INTERACTIVE_ROLES: new Set<string>([
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "menuitem",
    "tab",
    "switch",
  ]),
  /** 최소 권장 터치/클릭 타깃 크기 (px) */
  MIN_TARGET_SIZE_PX: 24,
  /** 포커스 트랩 판정 연속 동일 포커스 임계치 */
  FOCUS_TRAP_REPEAT_THRESHOLD: 3,
} as const;

export interface A11yAuditIssue {
  readonly code:
    | "MISSING_ACCESSIBLE_NAME"
    | "SMALL_TAP_TARGET"
    | "FOCUS_TRAP_DETECTED"
    | "DUPLICATE_INTERACTIVE_ID";
  readonly wcagCriterion: string;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly nodeId: string;
  readonly message: string;
}

export interface A11yAuditReport {
  readonly ok: boolean;
  readonly auditedNodesCount: number;
  readonly focusStepsCount: number;
  readonly issuesCount: number;
  readonly issues: readonly A11yAuditIssue[];
  readonly durationMs: number;
}

/**
 * 압축된 ARIA 노드 및 포커스 이동 트레이스를 기반으로 동적/정적 WCAG 결함 검출
 */
export class InteractiveA11yAuditor {
  /**
   * 노드 트리 및 선택적 Tab 포커스 이동 ID 시퀀스 동시 감사
   */
  public audit(
    nodes: readonly ActionableNode[],
    focusSequence: readonly string[] = []
  ): A11yAuditReport {
    const start = performance.now();
    const issues: A11yAuditIssue[] = [];
    const seenIds = new Set<string>();

    try {
      for (const node of nodes) {
        if (seenIds.has(node.id)) {
          issues.push({
            code: "DUPLICATE_INTERACTIVE_ID",
            wcagCriterion: "4.1.1 Parsing",
            severity: "HIGH",
            nodeId: node.id,
            message: `중복된 인터랙티브 노드 ID('${node.id}')가 감지되었습니다.`,
          });
        }
        seenIds.add(node.id);

        const roleLower = (node.role || "").toLowerCase();
        if (
          A11Y_AUDITOR_CONFIG.INTERACTIVE_ROLES.has(roleLower) &&
          (!node.label || node.label.trim().length === 0)
        ) {
          issues.push({
            code: "MISSING_ACCESSIBLE_NAME",
            wcagCriterion: "4.1.2 Name, Role, Value",
            severity: "CRITICAL",
            nodeId: node.id,
            message: `[${node.role}] 요소(id: ${node.id})에 접근 가능한 이름(label)이 누락되었습니다.`,
          });
        }

        if (node.bounds) {
          const { width, height } = node.bounds;
          if (
            width > 0 &&
            height > 0 &&
            (width < A11Y_AUDITOR_CONFIG.MIN_TARGET_SIZE_PX ||
              height < A11Y_AUDITOR_CONFIG.MIN_TARGET_SIZE_PX)
          ) {
            issues.push({
              code: "SMALL_TAP_TARGET",
              wcagCriterion: "2.5.8 Target Size (Minimum)",
              severity: "MEDIUM",
              nodeId: node.id,
              message: `[${node.role}] 요소(id: ${node.id}) 크기(${width}x${height}px)가 최소 권장 기준(${A11Y_AUDITOR_CONFIG.MIN_TARGET_SIZE_PX}px) 미만입니다.`,
            });
          }
        }
      }

      // 동적 포커스 트랩(동일 요소에 N회 이상 연속 고착) 검사
      if (focusSequence.length >= A11Y_AUDITOR_CONFIG.FOCUS_TRAP_REPEAT_THRESHOLD) {
        let streak = 1;
        for (let i = 1; i < focusSequence.length; i++) {
          if (focusSequence[i] === focusSequence[i - 1]) {
            streak++;
            if (streak === A11Y_AUDITOR_CONFIG.FOCUS_TRAP_REPEAT_THRESHOLD) {
              issues.push({
                code: "FOCUS_TRAP_DETECTED",
                wcagCriterion: "2.1.2 No Keyboard Trap",
                severity: "CRITICAL",
                nodeId: focusSequence[i],
                message: `키보드 포커스가 요소('${focusSequence[i]}')에서 ${streak}회 연속 벗어나지 못하는 포커스 트랩이 탐지되었습니다.`,
              });
            }
          } else {
            streak = 1;
          }
        }
      }
    } catch (err: any) {
      issues.push({
        code: "MISSING_ACCESSIBLE_NAME",
        wcagCriterion: "4.1.2 Name, Role, Value",
        severity: "CRITICAL",
        nodeId: "auditor",
        message: `접근성 감사 중 예외 발생: ${err?.message || err}`,
      });
    }

    return {
      ok: issues.length === 0,
      auditedNodesCount: nodes.length,
      focusStepsCount: focusSequence.length,
      issuesCount: issues.length,
      issues,
      durationMs: Number((performance.now() - start).toFixed(3)),
    };
  }
}
