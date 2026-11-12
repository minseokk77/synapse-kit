/**
 * 런타임 신경망 커넥톰 및 메모리 무결성 검증기 (Runtime Integrity Verifier)
 * - 양방향 시냅스 간선 대칭성, 유령 간선 0건, 순환 참조 안전성 증명
 */

export interface GraphSymmetryCheckInput {
  readonly outgoingEdges: Map<string, Set<string>>;
  readonly incomingEdges: Map<string, Set<string>>;
  readonly existingNodeIds: Set<string>;
}

export interface GraphSymmetryResult {
  readonly ok: boolean;
  readonly brokenOutgoing: readonly string[];
  readonly brokenIncoming: readonly string[];
  readonly orphanNodes: readonly string[];
}

export class RuntimeVerifier {
  constructor() {}

  /**
   * 커넥톰 그래프 양방향 대칭 불변식 검증
   * 모든 간선 u -> v에 대해:
   * v in outgoing(u) <=> u in incoming(v)
   * 그리고 u와 v 모두 existingNodeIds에 존재해야 함
   */
  public verifyGraphSymmetry(graph: GraphSymmetryCheckInput): GraphSymmetryResult {
    const brokenOutgoing: string[] = [];
    const brokenIncoming: string[] = [];
    const orphanNodes: string[] = [];

    // 1. 나가는 간선 대칭성 검사
    for (const [u, targets] of graph.outgoingEdges) {
      if (!graph.existingNodeIds.has(u)) {
        orphanNodes.push(u);
      }
      for (const v of targets) {
        if (!graph.existingNodeIds.has(v)) {
          orphanNodes.push(v);
        }
        const inSources = graph.incomingEdges.get(v);
        if (!inSources || !inSources.has(u)) {
          brokenOutgoing.push(`${u}->${v}`);
        }
      }
    }

    // 2. 들어오는 간선 대칭성 검사
    for (const [v, sources] of graph.incomingEdges) {
      for (const u of sources) {
        const outTargets = graph.outgoingEdges.get(u);
        if (!outTargets || !outTargets.has(v)) {
          brokenIncoming.push(`${u}->${v}`);
        }
      }
    }

    return {
      ok:
        brokenOutgoing.length === 0 &&
        brokenIncoming.length === 0 &&
        orphanNodes.length === 0,
      brokenOutgoing,
      brokenIncoming,
      orphanNodes: Array.from(new Set(orphanNodes)),
    };
  }
}

/**
 * 런타임 이벤트 기반 실시간 연속 불변식 감시자 (Continuous Verifier)
 */
export class ContinuousVerifier {
  private readonly verifier: RuntimeVerifier;
  private violationCount = 0;

  constructor() {
    this.verifier = new RuntimeVerifier();
  }

  /**
   * 감시 대상 커넥톰 상태를 실시간 무결성 검증
   */
  public check(graph: GraphSymmetryCheckInput): GraphSymmetryResult {
    const result = this.verifier.verifyGraphSymmetry(graph);
    if (!result.ok) {
      this.violationCount++;
    }
    return result;
  }

  /**
   * 누적된 불변성 위반 건수 반환
   */
  public getViolationCount(): number {
    return this.violationCount;
  }

  /**
   * 카운터 초기화
   */
  public reset(): void {
    this.violationCount = 0;
  }
}
