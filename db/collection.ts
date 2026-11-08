/**
 * 타입 세이프 컬렉션 인터페이스 (Synapse Collection)
 * 개발자가 직관적으로 CRUD 및 시냅스 관계 탐색을 수행하는 퍼사드 계층
 */
import type {
  SynapseDocument,
  SynapseDocumentInput,
  SynapseQueryOptions,
  SynapseSearchResult,
} from "./types";
import type { SynapseEngine } from "./engine";

export class SynapseCollection<TData = Record<string, any>> {
  constructor(
    public readonly name: string,
    private readonly engine: SynapseEngine
  ) {}

  /**
   * 문서 저장 (메모리 커넥톰 즉각 반영 + 디스크 원자적 비동기 영속화)
   */
  public async save(input: SynapseDocumentInput<TData>): Promise<SynapseDocument<TData>> {
    return this.engine.saveDocument(this.name, input);
  }

  /**
   * O(1) 단일 문서 조회
   */
  public get(id: string): SynapseDocument<TData> | null {
    return this.engine.connectome.getDocument<TData>(this.name, id);
  }

  /**
   * 문서 존재 여부 확인
   */
  public has(id: string): boolean {
    return this.engine.connectome.getDocument(this.name, id) !== null;
  }

  /**
   * 문서 삭제
   */
  public async delete(id: string): Promise<boolean> {
    return this.engine.deleteDocument(this.name, id);
  }

  /**
   * 필터링, 정렬, 페이징 쿼리
   */
  public query(options?: SynapseQueryOptions<TData>): SynapseDocument<TData>[] {
    return this.engine.connectome.queryCollection<TData>(this.name, options);
  }

  /**
   * 컬렉션 내 모든 문서 조회
   */
  public all(): SynapseDocument<TData>[] {
    return this.engine.connectome.queryCollection<TData>(this.name);
  }

  /**
   * 컬렉션 내 문서 개수
   */
  public count(): number {
    return this.engine.connectome.queryCollection<TData>(this.name).length;
  }

  /**
   * 컬렉션 내 전문 검색 (BM25 랭킹)
   */
  public search(queryText: string): SynapseSearchResult<TData>[] {
    return this.engine.connectome.search<TData>(queryText, this.name);
  }

  /**
   * 해당 문서의 시냅스 관계 순회 헬퍼
   */
  public synapses(id: string) {
    const engine = this.engine;
    const colName = this.name;

    return {
      /** 이 문서에서 뻗어나가는 시냅스 연결 문서들 */
      outgoing: (targetCollectionFilter?: string): SynapseDocument[] => {
        return engine.connectome.getOutgoingDocuments(colName, id, targetCollectionFilter);
      },
      /** 이 문서를 참조하고 있는 시냅스 연결 문서들 */
      incoming: (sourceCollectionFilter?: string): SynapseDocument[] => {
        return engine.connectome.getIncomingDocuments(colName, id, sourceCollectionFilter);
      },
    };
  }
}
