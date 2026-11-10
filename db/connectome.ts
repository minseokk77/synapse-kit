/**
 * 범용 시냅스 커넥톰 (Universal Synapse Connectome)
 * 인메모리 신경망 그래프, O(1) 해시 색인 및 초경량 한국어 전문 검색 엔진
 */
import type {
  SynapseDocument,
  SynapticEdge,
  SynapseQueryOptions,
  SynapseSearchResult,
  SynapseDBStats,
} from "./types";

export class SynapseConnectome {
  // 1. 전체 문서 노드 저장소 (키: "collection/id" ➔ O(1) 접근)
  private readonly documents = new Map<string, SynapseDocument>();

  // 2. 컬렉션별 문서 ID Set
  private readonly collectionDocIds = new Map<string, Set<string>>();

  // 3. 양방향 시냅스 간선망 (Synaptic Graph)
  // "sourceCollection/sourceId" ➔ Set<"targetCollection/targetId">
  private readonly outgoingEdges = new Map<string, Set<string>>();
  // "targetCollection/targetId" ➔ Set<"sourceCollection/sourceId">
  private readonly incomingEdges = new Map<string, Set<string>>();
  // 간선 상세 메타데이터 (키: "source->target")
  private readonly edgeMeta = new Map<string, SynapticEdge>();

  // 4. 초경량 인메모리 전문 검색 토큰 역색인 (Token ➔ Set<NodeId>) 및 문서별 토큰 추적기
  private readonly tokenInvertedIndex = new Map<string, Set<string>>();
  private readonly documentTokens = new Map<string, Set<string>>();
  // 쓰기 핫패스 병목 제거를 위한 지연 역색인 대기열 (Dirty-Flag Lazy Indexing)
  private readonly dirtySearchNodes = new Set<string>();

  constructor() {}

  /**
   * 고유 노드 ID 복합키 생성
   */
  public static makeNodeId(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  /**
   * 전체 메모리 상태 초기화
   */
  public clear(): void {
    this.documents.clear();
    this.collectionDocIds.clear();
    this.outgoingEdges.clear();
    this.incomingEdges.clear();
    this.edgeMeta.clear();
    this.tokenInvertedIndex.clear();
    this.documentTokens.clear();
    this.dirtySearchNodes.clear();
  }

  /**
   * 문서 적재 및 시냅스 간선/검색 색인 자동 결합 (Auto-Wiring)
   */
  public putDocument(doc: SynapseDocument): void {
    const nodeId = SynapseConnectome.makeNodeId(doc.collection, doc.id);

    // 기존 나가는 간선이 존재할 때만 선택적으로 정리 (피참조 incomingEdges는 보존)
    const links = doc.wikilinks;
    const linksLen = links.length;
    const existingOutSet = this.outgoingEdges.get(nodeId);

    // 단일 위키링크가 이전과 100% 동일한 경우 간선 Set 삭제/재생성 생략 (Zero-Churn Fast-Path)
    let skipEdgeRebuild = false;
    if (existingOutSet && existingOutSet.size === 1 && linksLen === 1) {
      const link = links[0];
      const targetNodeId = SynapseConnectome.makeNodeId(
        link.targetCollection || doc.collection,
        link.targetId
      );
      if (existingOutSet.has(targetNodeId)) {
        const metaKey = `${nodeId}->${targetNodeId}`;
        const existingMeta = this.edgeMeta.get(metaKey);
        if (existingMeta && existingMeta.alias === link.alias) {
          skipEdgeRebuild = true;
        }
      }
    }

    if (!skipEdgeRebuild && existingOutSet) {
      this.removeDocumentOutgoingEdges(nodeId);
    }

    // 1. 문서 저장
    this.documents.set(nodeId, doc);

    // 2. 컬렉션 인덱스 추가
    let colSet = this.collectionDocIds.get(doc.collection);
    if (!colSet) {
      colSet = new Set<string>();
      this.collectionDocIds.set(doc.collection, colSet);
    }
    colSet.add(doc.id);

    // 3. 위키링크 기반 시냅스 간선 형성 (위키링크가 존재하고 변경이 있을 때만 루프 진입)
    if (!skipEdgeRebuild && linksLen > 0) {
      let outSet = this.outgoingEdges.get(nodeId);
      if (!outSet) {
        outSet = new Set<string>();
        this.outgoingEdges.set(nodeId, outSet);
      }

      for (let i = 0; i < linksLen; i++) {
        const link = links[i];
        const targetNodeId = SynapseConnectome.makeNodeId(
          link.targetCollection || doc.collection,
          link.targetId
        );

        outSet.add(targetNodeId);

        let inSet = this.incomingEdges.get(targetNodeId);
        if (!inSet) {
          inSet = new Set<string>();
          this.incomingEdges.set(targetNodeId, inSet);
        }
        inSet.add(nodeId);

        this.edgeMeta.set(`${nodeId}->${targetNodeId}`, {
          fromNodeId: nodeId,
          toNodeId: targetNodeId,
          alias: link.alias,
        });
      }
    }

    // 4. 전문 검색 역색인은 지연 평가(Lazy Evaluation) 플래그만 O(1)로 마킹하여 쓰기 지연 제거
    this.dirtySearchNodes.add(nodeId);
  }

  /**
   * 문서 삭제
   */
  public removeDocument(collection: string, id: string): boolean {
    const nodeId = SynapseConnectome.makeNodeId(collection, id);
    if (!this.documents.has(nodeId)) return false;

    this.dirtySearchNodes.delete(nodeId);
    if (this.outgoingEdges.has(nodeId)) {
      this.removeDocumentOutgoingEdges(nodeId);
    }
    this.removeDocumentSearchTokens(nodeId);
    this.documents.delete(nodeId);

    const colSet = this.collectionDocIds.get(collection);
    if (colSet) {
      colSet.delete(id);
      if (colSet.size === 0) {
        this.collectionDocIds.delete(collection);
      }
    }

    return true;
  }

  /**
   * 해당 문서에서 출발하는 나가는 간선(Outgoing Edges)만 정리
   */
  private removeDocumentOutgoingEdges(nodeId: string): void {
    const outSet = this.outgoingEdges.get(nodeId);
    if (!outSet) return;
    for (const targetNodeId of outSet) {
      const inSet = this.incomingEdges.get(targetNodeId);
      if (inSet) {
        inSet.delete(nodeId);
        if (inSet.size === 0) {
          this.incomingEdges.delete(targetNodeId);
        }
      }
      this.edgeMeta.delete(`${nodeId}->${targetNodeId}`);
    }
    this.outgoingEdges.delete(nodeId);
  }

  /**
   * 해당 문서의 기존 전문 검색 토큰 역색인 정리 (유령 토큰 원천 차단)
   */
  private removeDocumentSearchTokens(nodeId: string): void {
    const oldTokens = this.documentTokens.get(nodeId);
    if (!oldTokens) return;
    for (const token of oldTokens) {
      const nodeSet = this.tokenInvertedIndex.get(token);
      if (nodeSet) {
        nodeSet.delete(nodeId);
        if (nodeSet.size === 0) {
          this.tokenInvertedIndex.delete(token);
        }
      }
    }
    this.documentTokens.delete(nodeId);
  }

  /**
   * 대기 중인 변경 문서들의 검색 역색인을 일괄 동기화 (검색 또는 무결성 검증 시 자동 호출)
   */
  private flushDirtySearchIndex(): void {
    if (this.dirtySearchNodes.size === 0) return;
    for (const nodeId of this.dirtySearchNodes) {
      this.removeDocumentSearchTokens(nodeId);
      const doc = this.documents.get(nodeId);
      if (doc) {
        this.indexDocumentText(nodeId, doc);
      }
    }
    this.dirtySearchNodes.clear();
  }

  /**
   * O(1) 단일 문서 조회
   */
  public getDocument<TData = any>(collection: string, id: string): SynapseDocument<TData> | null {
    const nodeId = SynapseConnectome.makeNodeId(collection, id);
    return (this.documents.get(nodeId) as SynapseDocument<TData>) || null;
  }

  /**
   * 해당 노드에서 뻗어나가는 시냅스 연결 노드 조회 (Outgoing Synapses)
   */
  public getOutgoingDocuments(
    collection: string,
    id: string,
    targetCollectionFilter?: string
  ): SynapseDocument[] {
    const nodeId = SynapseConnectome.makeNodeId(collection, id);
    const targetNodeIds = this.outgoingEdges.get(nodeId);
    if (!targetNodeIds) return [];

    const results: SynapseDocument[] = [];
    for (const tNodeId of targetNodeIds) {
      if (targetCollectionFilter && !tNodeId.startsWith(`${targetCollectionFilter}/`)) {
        continue;
      }
      const doc = this.documents.get(tNodeId);
      if (doc) results.push(doc);
    }
    return results;
  }

  /**
   * 해당 노드를 참조하고 있는 역방향 시냅스 연결 노드 조회 (Incoming Synapses)
   */
  public getIncomingDocuments(
    collection: string,
    id: string,
    sourceCollectionFilter?: string
  ): SynapseDocument[] {
    const nodeId = SynapseConnectome.makeNodeId(collection, id);
    const sourceNodeIds = this.incomingEdges.get(nodeId);
    if (!sourceNodeIds) return [];

    const results: SynapseDocument[] = [];
    for (const sNodeId of sourceNodeIds) {
      if (sourceCollectionFilter && !sNodeId.startsWith(`${sourceCollectionFilter}/`)) {
        continue;
      }
      const doc = this.documents.get(sNodeId);
      if (doc) results.push(doc);
    }
    return results;
  }

  /**
   * 그래프 양방향 대칭 불변식(Symmetry Invariant) 무결성 검증
   * 모든 간선 (u -> v)에 대해 v in outgoing(u) <=> u in incoming(v) 성립 여부 확인
   */
  public verifyGraphInvariants(): {
    readonly ok: boolean;
    readonly brokenOutgoing: string[];
    readonly brokenIncoming: string[];
    readonly ghostTokens: string[];
  } {
    this.flushDirtySearchIndex();
    const brokenOutgoing: string[] = [];
    const brokenIncoming: string[] = [];
    const ghostTokens: string[] = [];

    for (const [u, outTargets] of this.outgoingEdges) {
      for (const v of outTargets) {
        const inSources = this.incomingEdges.get(v);
        if (!inSources || !inSources.has(u)) {
          brokenOutgoing.push(`${u}->${v}`);
        }
      }
    }

    for (const [v, inSources] of this.incomingEdges) {
      for (const u of inSources) {
        const outTargets = this.outgoingEdges.get(u);
        if (!outTargets || !outTargets.has(v)) {
          brokenIncoming.push(`${u}->${v}`);
        }
      }
    }

    for (const [token, nodeSet] of this.tokenInvertedIndex) {
      for (const nodeId of nodeSet) {
        if (!this.documents.has(nodeId)) {
          ghostTokens.push(`${token}@${nodeId}`);
        }
      }
    }

    return {
      ok:
        brokenOutgoing.length === 0 &&
        brokenIncoming.length === 0 &&
        ghostTokens.length === 0,
      brokenOutgoing,
      brokenIncoming,
      ghostTokens,
    };
  }

  /**
   * 모든 시냅스 간선 목록 반환 (시각화 및 캔버스 생성용)
   */
  public getAllEdges(): SynapticEdge[] {
    return Array.from(this.edgeMeta.values());
  }

  /**
   * 모든 등록된 문서 목록 반환
   */
  public getAllDocuments(): SynapseDocument[] {
    return Array.from(this.documents.values());
  }

  /**
   * 특정 컬렉션의 문서 목록 조회 (필터링, 정렬, 페이징 지원)
   */
  public queryCollection<TData = any>(
    collection: string,
    options?: SynapseQueryOptions<TData>
  ): SynapseDocument<TData>[] {
    const ids = this.collectionDocIds.get(collection);
    if (!ids) return [];

    const docs: SynapseDocument<TData>[] = [];
    for (const id of ids) {
      const doc = this.documents.get(SynapseConnectome.makeNodeId(collection, id)) as SynapseDocument<TData>;
      if (!doc) continue;
      if (options?.filter && !options.filter(doc)) continue;
      docs.push(doc);
    }

    if (options?.sortBy) {
      docs.sort(options.sortBy);
    }

    const offset = options?.offset || 0;
    const limit = options?.limit !== undefined ? options.limit : docs.length;

    return docs.slice(offset, offset + limit);
  }

  /**
   * 초경량 한국어/영어 전문 검색 (BM25 간이 스코어링)
   */
  public search<TData = any>(query: string, collectionFilter?: string): SynapseSearchResult<TData>[] {
    this.flushDirtySearchIndex();
    const tokens = this.tokenize(query);
    if (tokens.length === 0) return [];

    const scoreMap = new Map<string, { score: number; matchedTerms: Set<string> }>();

    for (const token of tokens) {
      const matchedNodeIds = this.tokenInvertedIndex.get(token);
      if (!matchedNodeIds) continue;

      for (const nodeId of matchedNodeIds) {
        if (collectionFilter && !nodeId.startsWith(`${collectionFilter}/`)) {
          continue;
        }

        let entry = scoreMap.get(nodeId);
        if (!entry) {
          entry = { score: 0, matchedTerms: new Set<string>() };
          scoreMap.set(nodeId, entry);
        }
        entry.score += 1;
        entry.matchedTerms.add(token);
      }
    }

    const results: SynapseSearchResult<TData>[] = [];
    for (const [nodeId, { score, matchedTerms }] of scoreMap) {
      const doc = this.documents.get(nodeId) as SynapseDocument<TData>;
      if (!doc) continue;
      results.push({
        document: doc,
        score,
        matchedTerms: Array.from(matchedTerms),
      });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * 한국어 N-gram 및 영문/숫자 단어 토크나이저
   */
  private tokenize(text: string): string[] {
    const normalized = text.toLowerCase().replace(/[\r\n\t]/g, " ");
    const words = normalized.split(/[^a-zA-Z0-9가-힣]+/).filter((w) => w.length > 0);
    const tokens = new Set<string>();

    for (const word of words) {
      tokens.add(word);
      // 한글 2-gram 바이그램 추가 (부분 검색 지원)
      if (/[가-힣]/.test(word) && word.length >= 2) {
        for (let i = 0; i < word.length - 1; i++) {
          tokens.add(word.slice(i, i + 2));
        }
      }
    }

    return Array.from(tokens);
  }

  /**
   * 문서 본문 및 메타데이터 색인 생성
   */
  private indexDocumentText(nodeId: string, doc: SynapseDocument): void {
    const rawDataStr = JSON.stringify(doc.data);
    const fullText = `${doc.id} ${doc.collection} ${rawDataStr} ${doc.body}`;
    const tokens = this.tokenize(fullText);
    const docTokenSet = new Set<string>(tokens);
    this.documentTokens.set(nodeId, docTokenSet);

    for (const token of docTokenSet) {
      let set = this.tokenInvertedIndex.get(token);
      if (!set) {
        set = new Set<string>();
        this.tokenInvertedIndex.set(token, set);
      }
      set.add(nodeId);
    }
  }

  /**
   * 전체 통계 요약
   */
  public getStats(): SynapseDBStats {
    const breakdown: Record<string, number> = {};
    for (const [col, ids] of this.collectionDocIds) {
      breakdown[col] = ids.size;
    }

    return {
      collectionsCount: this.collectionDocIds.size,
      totalDocuments: this.documents.size,
      totalSynapses: this.edgeMeta.size,
      collectionBreakdown: breakdown,
    };
  }
}
