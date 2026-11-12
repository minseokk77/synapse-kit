/**
 * 시냅스 옵틱(Synapse Optic) 공용 인터페이스 및 DTO 타입 정의
 */

/** 노드 바운딩 박스 화면 좌표 */
export interface NodeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 시냅스 접근성 노드 (Actionable Node) */
export interface ActionableNode {
  readonly id: string;
  readonly role: string;
  readonly label: string;
  readonly value: string | null;
  readonly depth: number;
  readonly bounds?: NodeRect | null;
}

/** 1:1 바인딩된 스냅샷 참조 노드 */
export interface ReferenceNode {
  readonly reference: string;
  readonly role: string;
  readonly label: string;
  readonly shortAlias?: string;
  readonly bounds?: NodeRect | null;
}

/** 에이전트 브라우징 스냅샷 결과 */
export interface OpticSnapshot {
  readonly generation: string;
  readonly totalNodes: number;
  readonly formattedPrompt: string;
  readonly nodes: readonly ReferenceNode[];
  readonly durationMs: number;
}

/** 브라우저 액션 실행 결과 */
export interface OpticActionResult {
  readonly ok: boolean;
  readonly action: string;
  readonly target?: string;
  readonly tag?: string;
  readonly text?: string;
  readonly value?: unknown;
  readonly durationMs: number;
  readonly error?: string;
}

/** 브라우징 상태 요약 */
export interface OpticStatus {
  readonly connected: boolean;
  readonly endpoint: string;
  readonly targetId?: string;
  readonly currentUrl?: string;
  readonly actionTimeoutMs: number;
}
