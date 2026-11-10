/**
 * 범용 마크다운 시냅스 데이터베이스 타입 규격 (Synapse-DB Type Specifications)
 * SOLID 원칙 준수: 단일 책임 원칙(SRP)에 따른 타입 정의 분리
 */
import type { CausalWalConfig } from "./wal/config";

/** 시냅스 위키링크 규격 ([[collection/id|alias]]) */
export interface SynapseWikilink {
  readonly raw: string;
  readonly targetCollection: string;
  readonly targetId: string;
  readonly alias?: string;
}

/** 범용 시냅스 간선 (Synaptic Edge) */
export interface SynapticEdge {
  readonly fromNodeId: string; // "collection/id"
  readonly toNodeId: string;   // "collection/id"
  readonly relation?: string;
  readonly alias?: string;
}

/** 마크다운 볼트에 저장되는 범용 문서 (Synapse Document) */
export interface SynapseDocument<TData = Record<string, any>> {
  readonly id: string;
  readonly collection: string;
  readonly data: TData;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly wikilinks: readonly SynapseWikilink[];
}

/** 문서 생성 및 저장 입력 규격 */
export interface SynapseDocumentInput<TData = Record<string, any>> {
  readonly id: string;
  readonly data: TData;
  readonly body?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

/** 쿼리 및 필터링 옵션 */
export interface SynapseQueryOptions<TData = Record<string, any>> {
  readonly filter?: (doc: SynapseDocument<TData>) => boolean;
  readonly sortBy?: (a: SynapseDocument<TData>, b: SynapseDocument<TData>) => number;
  readonly limit?: number;
  readonly offset?: number;
}

/** 전문 검색(Full-text Search) 결과 */
export interface SynapseSearchResult<TData = Record<string, any>> {
  readonly document: SynapseDocument<TData>;
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

/** 데이터베이스 환경 설정 */
export interface SynapseDBConfig {
  readonly vaultDir: string;
  readonly autoWatch?: boolean;
  readonly persistDebounceMs?: number;
  readonly wal?: CausalWalConfig;
}

/** 시냅스 데이터베이스 전체 통계 요약 */
export interface SynapseDBStats {
  readonly collectionsCount: number;
  readonly totalDocuments: number;
  readonly totalSynapses: number;
  readonly collectionBreakdown: Record<string, number>;
}
