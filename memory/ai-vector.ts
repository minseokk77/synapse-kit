/**
 * Synapse-Memory Vector Index: Int8 양자화 로컬 임베딩 인덱스 (Zero-FLOPs 정수 해시 프로젝션)
 */

export const MEMORY_VECTOR_CONFIG = {
  DEFAULT_DIMENSIONS: 256,
  QUANT_SCALE: 127,
  DEFAULT_TOP_K: 10,
} as const;

export type VectorEmbedderFn = (text: string) => number[] | Promise<number[]>;

export interface VectorDocEntry {
  readonly id: string;
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
}

export interface VectorSearchHit {
  readonly id: string;
  readonly similarity: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * 한국어/영문 Subword + Character N-gram 순수 정수 해시 프로젝션 (외부 의존성 0개)
 */
export function localHashEmbed(
  text: string,
  dimensions: number = MEMORY_VECTOR_CONFIG.DEFAULT_DIMENSIONS
): number[] {
  const vec = new Int32Array(dimensions);
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return Array.from(vec);

  const tokens = normalized.split(/[^a-z0-9가-힣_]+/).filter((t) => t.length > 0);
  for (const tok of tokens) {
    addHashedFeatureInt(vec, tok, 15, dimensions);
    for (let n = 2; n <= 3; n++) {
      if (tok.length < n) continue;
      for (let i = 0; i <= tok.length - n; i++) {
        addHashedFeatureInt(vec, tok.slice(i, i + n), 7, dimensions);
      }
    }
  }

  let maxAbs = 1;
  for (let i = 0; i < dimensions; i++) {
    const abs = vec[i] < 0 ? -vec[i] : vec[i];
    if (abs > maxAbs) maxAbs = abs;
  }
  const out = new Array<number>(dimensions);
  for (let i = 0; i < dimensions; i++) out[i] = vec[i] / maxAbs;
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

function quantizeInt8(vec: readonly number[]): { q: Int8Array; norm: number } {
  const q = new Int8Array(vec.length);
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const clamped = Math.max(-1, Math.min(1, vec[i]));
    const val = Math.round(clamped * MEMORY_VECTOR_CONFIG.QUANT_SCALE);
    q[i] = val;
    sumSq += val * val;
  }
  return { q, norm: Math.sqrt(sumSq) || 1 };
}

function quantizedCosine(a: Int8Array, aNorm: number, b: Int8Array, bNorm: number): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot / (aNorm * bNorm);
}

/**
 * Int8 스칼라 양자화 인메모리 벡터 인덱스
 */
export class QuantizedVectorIndex {
  private readonly embedder: VectorEmbedderFn;
  private readonly entries = new Map<
    string,
    { q: Int8Array; norm: number; metadata?: Record<string, unknown> }
  >();

  constructor(embedder?: VectorEmbedderFn) {
    this.embedder = embedder ?? ((txt) => localHashEmbed(txt));
  }

  public async upsert(entry: VectorDocEntry): Promise<void> {
    const raw = await this.embedder(entry.text);
    const { q, norm } = quantizeInt8(raw);
    this.entries.set(entry.id, { q, norm, metadata: entry.metadata });
  }

  public async search(
    query: string,
    topK: number = MEMORY_VECTOR_CONFIG.DEFAULT_TOP_K
  ): Promise<VectorSearchHit[]> {
    const q = quantizeInt8(await this.embedder(query));
    const hits: VectorSearchHit[] = [];

    for (const [id, item] of this.entries.entries()) {
      const sim = quantizedCosine(q.q, q.norm, item.q, item.norm);
      hits.push({ id, similarity: Number(sim.toFixed(4)), metadata: item.metadata });
    }

    return hits.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
  }

  public size(): number {
    return this.entries.size;
  }
}
