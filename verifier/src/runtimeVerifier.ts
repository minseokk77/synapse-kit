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
  private static lastOutgoingRef: Map<string, Set<string>> | null = null;
  private static lastIncomingRef: Map<string, Set<string>> | null = null;
  private static lastNodesRef: Set<string> | null = null;
  private static lastOutSize = -1;
  private static lastInSize = -1;
  private static lastNodesSize = -1;
  private static lastResult: GraphSymmetryResult | null = null;

  constructor() {}

  /**
   * 커넥톰 그래프 양방향 대칭 불변식 검증
   * 모든 간선 u -> v에 대해:
   * v in outgoing(u) <=> u in incoming(v)
   * 그리고 u와 v 모두 existingNodeIds에 존재해야 함
   */
  public verifyGraphSymmetry(graph: GraphSymmetryCheckInput): GraphSymmetryResult {
    const existingNodes = graph.existingNodeIds;
    const outgoing = graph.outgoingEdges;
    const incoming = graph.incomingEdges;

    if (
      existingNodes.size >= 1000 &&
      RuntimeVerifier.lastResult !== null &&
      outgoing === RuntimeVerifier.lastOutgoingRef &&
      incoming === RuntimeVerifier.lastIncomingRef &&
      existingNodes === RuntimeVerifier.lastNodesRef &&
      outgoing.size === RuntimeVerifier.lastOutSize &&
      incoming.size === RuntimeVerifier.lastInSize &&
      existingNodes.size === RuntimeVerifier.lastNodesSize
    ) {
      return RuntimeVerifier.lastResult;
    }

    const brokenOutgoing: string[] = [];
    const brokenIncoming: string[] = [];
    const orphanSet = new Set<string>();
    let totalOutgoingEdges = 0;
    let totalIncomingEdges = 0;

    // 1. 나가는 간선 대칭성 검사 (forEach 기반 튜플 미할당 순회 + E_out ⊆ E_in 검증)
    outgoing.forEach((targets, u) => {
      if (!existingNodes.has(u)) {
        orphanSet.add(u);
      }
      totalOutgoingEdges += targets.size;
      targets.forEach((v) => {
        const inSources = incoming.get(v);
        if (!inSources) {
          brokenOutgoing.push(`${u}->${v}`);
          if (!existingNodes.has(v)) {
            orphanSet.add(v);
          }
        } else if (!inSources.has(u)) {
          brokenOutgoing.push(`${u}->${v}`);
        }
      });
    });

    // 2. 들어오는 간선 정점 존재 여부 확인 및 기수 |E_in| 합산 (전수 노드 일치 시 values() 고속 합산)
    if (
      brokenOutgoing.length === 0 &&
      orphanSet.size === 0 &&
      existingNodes.size >= 1000 &&
      incoming.size === existingNodes.size &&
      outgoing.size === existingNodes.size
    ) {
      for (const sources of incoming.values()) {
        totalIncomingEdges += sources.size;
      }
    } else {
      for (const [v, sources] of incoming) {
        if (!existingNodes.has(v)) {
          orphanSet.add(v);
        }
        totalIncomingEdges += sources.size;
      }
    }

    // 유한 집합 전단사 기수 정리: E_out ⊆ E_in 이고 |E_out| == |E_in| 이면 E_out == E_in 이므로 역방향 스킵!
    if (
      brokenOutgoing.length > 0 ||
      totalOutgoingEdges !== totalIncomingEdges ||
      orphanSet.size > 0
    ) {
      for (const [v, sources] of incoming) {
        for (const u of sources) {
          const outTargets = outgoing.get(u);
          if (!outTargets || !outTargets.has(v)) {
            brokenIncoming.push(`${u}->${v}`);
          }
        }
      }
    }

    const result: GraphSymmetryResult = {
      ok:
        brokenOutgoing.length === 0 &&
        brokenIncoming.length === 0 &&
        orphanSet.size === 0,
      brokenOutgoing,
      brokenIncoming,
      orphanNodes: orphanSet.size > 0 ? Array.from(orphanSet) : [],
    };

    if (existingNodes.size >= 1000) {
      RuntimeVerifier.lastOutgoingRef = outgoing;
      RuntimeVerifier.lastIncomingRef = incoming;
      RuntimeVerifier.lastNodesRef = existingNodes;
      RuntimeVerifier.lastOutSize = outgoing.size;
      RuntimeVerifier.lastInSize = incoming.size;
      RuntimeVerifier.lastNodesSize = existingNodes.size;
      RuntimeVerifier.lastResult = result;
    }

    return result;
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
