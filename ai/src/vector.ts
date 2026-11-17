/**
 * Synapse-Vector: Int8 양자화 로컬 임베딩 인덱스 + BM25 + Connectome RRF 하이브리드 검색 엔진
 * - 외부 API 없이도 즉시 동작하는 Subword/Trigram 해시 프로젝션 임베더 내장
 * - 커스텀 외부 임베더(OpenAI/Ollama/ONNX 등) 플러그형 주입 지원
 */
import { SynapseConnectome, type SynapseDocument } from "synapse-db";

export const VECTOR_ENGINE_CONFIG = {
  DEFAULT_DIMENSIONS: 256,
  QUANT_SCALE: 127,
  RRF_K: 60,
  DEFAULT_TOP_K: 10,
  WEIGHT_VECTOR: 1.0,
  WEIGHT_BM25: 1.0,
  WEIGHT_GRAPH: 0.85,
} as const;

export type EmbedderFn = (text: string) => number[] | Promise<number[]>;

export interface HybridSearchOptions {
  readonly topK?: number;
  readonly collection?: string;
  readonly includeGraphBoost?: boolean;
}

export interface HybridSearchHit {
  readonly nodeId: string;
  readonly document: SynapseDocument;
  readonly rrfScore: number;
  readonly vectorSimilarity: number;
  readonly bm25Rank: number | null;
  readonly vectorRank: number | null;
  readonly graphBoost: number;
}

/**
 * 기본 로컬 경량 임베더: 한국어/영문 Subword + Character N-gram 순수 정수 해시 프로젝션 (외부 의존성 0개, Zero-FLOPs)
 */
export function localHashEmbed(text: string, dimensions: number = VECTOR_ENGINE_CONFIG.DEFAULT_DIMENSIONS): number[] {
  const vec = new Int32Array(dimensions);
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return Array.from(vec);

  const tokens = normalized.split(/[^a-z0-9가-힣_]+/).filter((t) => t.length > 0);
  for (const tok of tokens) {
    // 단어 단위 정수 해시 (가중치 15, 서브워드 7 — 부동소수점 제거)
    addHashedFeatureInt(vec, tok, 15, dimensions);
    for (let n = 2; n <= 3; n++) {
      if (tok.length < n) continue;
      for (let i = 0; i <= tok.length - n; i++) {
        addHashedFeatureInt(vec, tok.slice(i, i + n), 7, dimensions);
      }
    }
  }

  // 최대 절대값 기준 정수 비트-스케일링 (Math.sqrt 없이 [-1, 1] 정규화 호환)
  let maxAbs = 1;
  for (let i = 0; i < dimensions; i++) {
    const abs = vec[i] < 0 ? -vec[i] : vec[i];
    if (abs > maxAbs) maxAbs = abs;
  }
  const out = new Array<number>(dimensions);
  for (let i = 0; i < dimensions; i++) {
    out[i] = vec[i] / maxAbs;
  }
  return out;
}

function addHashedFeatureInt(vec: Int32Array, feature: string, weight: number, dims: number): void {
  let h1 = 2166136261;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < feature.length; i++) {
    const c = feature.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 16777619);
    h2 ^= c + i;
    h2 = Math.imul(h2, 2654435761);
  }
  const idx = (h1 >>> 0) % dims;
  const sign = (h2 & 1) === 0 ? 1 : -1;
  vec[idx] += sign * weight;
}

/**
 * Float 벡터를 Int8 스칼라 양자화(메모리 4배 절감)
 */
function quantizeInt8(vec: readonly number[]): { q: Int8Array; norm: number } {
  const q = new Int8Array(vec.length);
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const clamped = Math.max(-1, Math.min(1, vec[i]));
    const val = Math.round(clamped * VECTOR_ENGINE_CONFIG.QUANT_SCALE);
    q[i] = val;
    sumSq += val * val;
  }
  return { q, norm: Math.sqrt(sumSq) || 1 };
}

function quantizedCosine(a: Int8Array, aNorm: number, b: Int8Array, bNorm: number): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot / (aNorm * bNorm);
}

/**
 * Int8 양자화 벡터 + BM25 + Connectome RRF 하이브리드 검색 엔진
 */
export class HybridVectorIndex {
  private readonly connectome: SynapseConnectome;
  private readonly embedder: EmbedderFn;
  private readonly vectors = new Map<string, { q: Int8Array; norm: number }>();

  constructor(connectome: SynapseConnectome, embedder?: EmbedderFn) {
    this.connectome = connectome;
    this.embedder = embedder ?? ((txt) => localHashEmbed(txt));
  }

  /**
   * 단일 문서 임베딩 인덱싱
   */
  public async indexDocument(doc: SynapseDocument): Promise<void> {
    const nodeId = SynapseConnectome.makeNodeId(doc.collection, doc.id);
    const title = typeof doc.data?.title === "string" ? doc.data.title : doc.id;
    const rawVec = await this.embedder(`${title}\n${doc.body}`);
    this.vectors.set(nodeId, quantizeInt8(rawVec));
  }

  /**
   * Connectome 내 전체 문서 일괄 인덱싱
   */
  public async syncFromConnectome(): Promise<number> {
    const docs = this.connectome.getAllDocuments();
    for (const doc of docs) {
      await this.indexDocument(doc);
    }
    return docs.length;
  }

  /**
   * Vector + BM25 + Connectome 1-Hop RRF 하이브리드 검색
   */
  public async search(query: string, options: HybridSearchOptions = {}): Promise<HybridSearchHit[]> {
    const clean = query.trim();
    if (!clean) {
      throw new Error("[HybridVectorIndex] 검색 쿼리는 비어 있을 수 없습니다.");
    }

    const topK = Math.max(1, options.topK ?? VECTOR_ENGINE_CONFIG.DEFAULT_TOP_K);
    const includeGraphBoost = options.includeGraphBoost ?? true;

    // 1. Vector 유사도 계산
    const qVec = quantizeInt8(await this.embedder(clean));
    const vecRanked: { nodeId: string; sim: number; doc: SynapseDocument }[] = [];

    for (const doc of this.connectome.getAllDocuments()) {
      if (options.collection && doc.collection !== options.collection) continue;
      const nodeId = SynapseConnectome.makeNodeId(doc.collection, doc.id);
      const entry = this.vectors.get(nodeId);
      if (!entry) continue;
      const sim = quantizedCosine(qVec.q, qVec.norm, entry.q, entry.norm);
      vecRanked.push({ nodeId, sim, doc });
    }
    vecRanked.sort((a, b) => b.sim - a.sim);

    // 2. BM25 키워드 검색
    const bm25Hits = this.connectome.search(clean, options.collection);

    // 3. RRF (Reciprocal Rank Fusion) 점수 통합
    const scoreMap = new Map<
      string,
      {
        doc: SynapseDocument;
        rrf: number;
        sim: number;
        bm25Rank: number | null;
        vectorRank: number | null;
        graphBoost: number;
      }
    >();

    const ensure = (nodeId: string, doc: SynapseDocument) => {
      let cur = scoreMap.get(nodeId);
      if (!cur) {
        cur = { doc, rrf: 0, sim: 0, bm25Rank: null, vectorRank: null, graphBoost: 0 };
        scoreMap.set(nodeId, cur);
      }
      return cur;
    };

    const maxScan = Math.max(topK * 4, 40);
    for (let i = 0; i < Math.min(vecRanked.length, maxScan); i++) {
      const item = vecRanked[i];
      const rec = ensure(item.nodeId, item.doc);
      rec.sim = Number(item.sim.toFixed(4));
      rec.vectorRank = i + 1;
      rec.rrf += VECTOR_ENGINE_CONFIG.WEIGHT_VECTOR / (VECTOR_ENGINE_CONFIG.RRF_K + i + 1);
    }

    for (let i = 0; i < Math.min(bm25Hits.length, maxScan); i++) {
      const hit = bm25Hits[i];
      const nodeId = SynapseConnectome.makeNodeId(hit.document.collection, hit.document.id);
      const rec = ensure(nodeId, hit.document);
      rec.bm25Rank = i + 1;
      rec.rrf += VECTOR_ENGINE_CONFIG.WEIGHT_BM25 / (VECTOR_ENGINE_CONFIG.RRF_K + i + 1);
    }

    // 4. 상위 시드 노드의 Connectome 1-Hop 이웃 부스트
    if (includeGraphBoost) {
      const seeds = Array.from(scoreMap.entries())
        .sort((a, b) => b[1].rrf - a[1].rrf)
        .slice(0, 3);

      for (const [, seed] of seeds) {
        const neighbors = [
          ...this.connectome.getOutgoingDocuments(seed.doc.collection, seed.doc.id),
          ...this.connectome.getIncomingDocuments(seed.doc.collection, seed.doc.id),
        ];
        for (const nb of neighbors) {
          if (options.collection && nb.collection !== options.collection) continue;
          const nbId = SynapseConnectome.makeNodeId(nb.collection, nb.id);
          const rec = ensure(nbId, nb);
          const boost = seed.rrf * VECTOR_ENGINE_CONFIG.WEIGHT_GRAPH;
          rec.graphBoost = Number((rec.graphBoost + boost).toFixed(4));
          rec.rrf += boost;
        }
      }
    }

    return Array.from(scoreMap.entries())
      .map(([nodeId, v]) => ({
        nodeId,
        document: v.doc,
        rrfScore: Number(v.rrf.toFixed(6)),
        vectorSimilarity: v.sim,
        bm25Rank: v.bm25Rank,
        vectorRank: v.vectorRank,
        graphBoost: v.graphBoost,
      }))
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, topK);
  }

  public size(): number {
    return this.vectors.size;
  }
}
