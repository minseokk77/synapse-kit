/**
 * Synapse-DCI: 인과 그래프 + Copy-on-Write 기반 차세대 동적 워크스페이스 확장 엔진
 *
 * DR-DCI(arXiv:2606.14885)의 3대 병목(리트리버 맹점, 셸 멀티턴 오버헤드, 단순 Context Reset 손실)을
 * Synapse 코어 기술(Connectome Multi-Hop, CoW 브랜치, Causal Distillation, Firewall)로 해결합니다.
 */
import { SynapseConnectome } from "./connectome";
import { withCorrectnessFirewall } from "./firewall";
import type { SynapseDocument } from "./types";

/**
 * Synapse-DCI 전역 설정 상수
 */
export const SYNAPSE_DCI_CONFIG = {
  DEFAULT_TOP_K: 12,
  DEFAULT_HOPS: 2,
  MAX_HOPS: 4,
  MAX_WORKSPACE_DOCS: 256,
  MAX_BRANCHES: 64,
  MAX_SNIPPET_LINES: 40,
  MAX_GREP_PATTERN_LEN: 256,
  CHARS_PER_TOKEN: 4,
  DEFAULT_WORKSPACE_NAME: "main",
  INJECTION_PATTERNS: [
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    /<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi,
    /javascript\s*:/gi,
    /\bon(?:load|error|click|mouseover)\s*=/gi,
    /ignore\s+(?:all\s+)?previous\s+instructions?/gi,
    /disregard\s+(?:all\s+)?system\s+prompts?/gi,
    /\beval\s*\(/gi,
  ],
} as const;

export interface DciVectorHit {
  readonly id: string; // "collection/id" 또는 "id"
  readonly similarity: number;
}

export type DciVectorSearchFn = (
  query: string,
  topK: number
) => Promise<readonly DciVectorHit[]> | readonly DciVectorHit[];

export interface DciPullOptions {
  readonly topK?: number;
  readonly hops?: number;
  readonly collection?: string;
  readonly enableFirewall?: boolean;
  readonly vectorSearch?: DciVectorSearchFn;
}

export interface DciAnchorLine {
  readonly lineNumber: number;
  readonly text: string;
}

export interface DciWorkspaceEntry {
  readonly nodeId: string;
  readonly collection: string;
  readonly id: string;
  readonly source: "retriever" | "connectome-hop" | "merged-branch";
  readonly hopDepth: number;
  readonly score: number;
  readonly sanitizedBody: string;
  readonly firewallRedactions: number;
  readonly anchors: readonly DciAnchorLine[];
  readonly linksOut: readonly string[];
}

export interface DciSubgraphEdge {
  readonly from: string;
  readonly to: string;
  readonly alias?: string;
}

export interface DciPullResult {
  readonly query: string;
  readonly pulledCount: number;
  readonly retrieverHits: number;
  readonly connectomeHopHits: number;
  readonly firewallRedactions: number;
  readonly workspaceTotalDocs: number;
  readonly subgraphEdges: readonly DciSubgraphEdge[];
  readonly entries: readonly DciWorkspaceEntry[];
  readonly durationMs: number;
}

export type DciBatchOp =
  | { readonly op: "grep"; readonly pattern: string; readonly caseSensitive?: boolean; readonly maxMatches?: number }
  | { readonly op: "slice"; readonly nodeId: string; readonly startLine: number; readonly endLine: number }
  | { readonly op: "cross_ref"; readonly fromNodeId: string; readonly toNodeId: string }
  | { readonly op: "evict"; readonly nodeIds: readonly string[] };

export interface DciBatchOpOutput {
  readonly op: DciBatchOp["op"];
  readonly ok: boolean;
  readonly data: unknown;
}

export interface DciBatchResult {
  readonly totalOps: number;
  readonly executedOps: number;
  readonly workspaceDocsRemaining: number;
  readonly outputs: readonly DciBatchOpOutput[];
  readonly durationMs: number;
}

export interface DciCausalFact {
  readonly claim: string;
  readonly evidenceNodeIds: readonly string[];
  readonly status: "verified" | "refuted" | "hypothesis";
}

export interface DciFoldedContext {
  readonly workspaceName: string;
  readonly retainedDocs: number;
  readonly verifiedFactsCount: number;
  readonly refutedFactsCount: number;
  readonly digestText: string;
  readonly rawEstimatedTokens: number;
  readonly foldedEstimatedTokens: number;
  readonly tokenReductionRatio: number;
}

export interface DciWorkspaceStats {
  readonly name: string;
  readonly docCount: number;
  readonly branchCount: number;
  readonly foldedFactsCount: number;
  readonly totalPulls: number;
  readonly totalBatchOps: number;
  readonly totalFirewallRedactions: number;
}

export interface DciMergeResult {
  readonly branchName: string;
  readonly mergedDocs: number;
  readonly mergedFacts: number;
}

/**
 * 비신뢰 코퍼스 본문 내 간접 프롬프트 인젝션 및 위험 패턴 정화
 */
function sanitizeCorpusText(rawBody: string): { sanitized: string; redactions: number } {
  let sanitized = rawBody;
  let redactions = 0;

  for (const pattern of SYNAPSE_DCI_CONFIG.INJECTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    sanitized = sanitized.replace(regex, () => {
      redactions++;
      return "[SYNAPSE_FIREWALL_REDACTED]";
    });
  }

  return { sanitized, redactions };
}

/**
 * 검색어 또는 패턴과 일치하는 핵심 앵커 라인 추출
 */
function extractAnchors(body: string, query: string): DciAnchorLine[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (terms.length === 0) return [];

  const lines = body.split(/\r?\n/);
  const anchors: DciAnchorLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (terms.some((term) => lower.includes(term))) {
      anchors.push({ lineNumber: i + 1, text: lines[i].trim() });
      if (anchors.length >= SYNAPSE_DCI_CONFIG.MAX_SNIPPET_LINES) break;
    }
  }
  return anchors;
}

/**
 * Synapse-DCI 동적 워크스페이스 엔진
 */
export class SynapseDciWorkspace {
  public readonly name: string;
  private readonly connectome: SynapseConnectome;
  private readonly entries = new Map<string, DciWorkspaceEntry>();
  private readonly branches = new Map<string, SynapseDciWorkspace>();
  private readonly foldedFacts: DciCausalFact[] = [];
  private totalPulls = 0;
  private totalBatchOps = 0;
  private totalFirewallRedactions = 0;

  constructor(connectome: SynapseConnectome, name: string = SYNAPSE_DCI_CONFIG.DEFAULT_WORKSPACE_NAME) {
    this.connectome = connectome;
    this.name = name;
  }

  /**
   * 1. Hybrid Causal Pull: BM25 1차 검색 + Connectome Multi-Hop 공명 확장 + Firewall 정화
   */
  public pull(query: string, options: DciPullOptions = {}): DciPullResult {
    const start = performance.now();
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      throw new Error("[SynapseDciWorkspace] pull 쿼리는 비어 있을 수 없습니다.");
    }

    const topK = Math.max(1, options.topK ?? SYNAPSE_DCI_CONFIG.DEFAULT_TOP_K);
    const hops = Math.min(SYNAPSE_DCI_CONFIG.MAX_HOPS, Math.max(0, options.hops ?? SYNAPSE_DCI_CONFIG.DEFAULT_HOPS));
    const enableFirewall = options.enableFirewall ?? true;

    // Correctness Firewall로 Fast-Path Pull 무결성 보장
    const outcome = withCorrectnessFirewall(
      () => this.executeHybridPull(cleanQuery, topK, hops, options.collection, enableFirewall),
      () => this.executeSafeFallbackPull(cleanQuery, topK, options.collection, enableFirewall),
      (res) => res.entries.length <= SYNAPSE_DCI_CONFIG.MAX_WORKSPACE_DOCS,
      "dci-hybrid-pull"
    );

    this.totalPulls++;
    const result = outcome.value;

    return {
      ...result,
      durationMs: Number((performance.now() - start).toFixed(4)),
    };
  }

  /**
   * 1-B. 3-Way Hybrid Pull: BM25 + Vector(RRF 융합) + Connectome Multi-Hop 확장
   */
  public async pullHybrid(query: string, options: DciPullOptions = {}): Promise<DciPullResult> {
    const start = performance.now();
    if (!options.vectorSearch) {
      return this.pull(query, options);
    }

    const cleanQuery = query.trim();
    if (!cleanQuery) {
      throw new Error("[SynapseDciWorkspace] pullHybrid 쿼리는 비어 있을 수 없습니다.");
    }

    const topK = Math.max(1, options.topK ?? SYNAPSE_DCI_CONFIG.DEFAULT_TOP_K);
    const hops = Math.min(SYNAPSE_DCI_CONFIG.MAX_HOPS, Math.max(0, options.hops ?? SYNAPSE_DCI_CONFIG.DEFAULT_HOPS));
    const enableFirewall = options.enableFirewall ?? true;
    const rrfK = 60;

    // BM25 + Vector RRF 융합 시드 계산 (외부 벡터 검색 장애 시 BM25+Connectome으로 무중단 폴백)
    const bm25Hits = this.connectome.search(cleanQuery, options.collection).slice(0, topK * 2);
    let vecHits: readonly DciVectorHit[] = [];
    try {
      vecHits = (await options.vectorSearch(cleanQuery, topK * 2)).slice(0, topK * 2);
    } catch {
      return this.pull(cleanQuery, options);
    }

    const scoreByNodeId = new Map<string, { doc: SynapseDocument; rrf: number }>();
    for (let i = 0; i < bm25Hits.length; i++) {
      const h = bm25Hits[i];
      const nodeId = SynapseConnectome.makeNodeId(h.document.collection, h.document.id);
      const cur = scoreByNodeId.get(nodeId) ?? { doc: h.document, rrf: 0 };
      cur.rrf += 1 / (rrfK + i + 1);
      scoreByNodeId.set(nodeId, cur);
    }
    for (let i = 0; i < vecHits.length; i++) {
      const vh = vecHits[i];
      const slash = vh.id.indexOf("/");
      const col = slash > 0 ? vh.id.slice(0, slash) : options.collection || "docs";
      const docId = slash > 0 ? vh.id.slice(slash + 1) : vh.id;
      const doc = this.connectome.getDocument(col, docId);
      if (!doc || (options.collection && doc.collection !== options.collection)) continue;
      const nodeId = SynapseConnectome.makeNodeId(doc.collection, doc.id);
      const cur = scoreByNodeId.get(nodeId) ?? { doc, rrf: 0 };
      cur.rrf += 1 / (rrfK + i + 1);
      scoreByNodeId.set(nodeId, cur);
    }

    const fusedSeeds = Array.from(scoreByNodeId.values())
      .sort((a, b) => b.rrf - a.rrf)
      .slice(0, topK);

    const newlyPulled: DciWorkspaceEntry[] = [];
    const frontier: { doc: SynapseDocument; depth: number; baseScore: number }[] = [];
    const visited = new Set<string>();
    let retrieverHits = 0;
    let connectomeHopHits = 0;
    let redactionsSum = 0;

    for (const seed of fusedSeeds) {
      const nodeId = SynapseConnectome.makeNodeId(seed.doc.collection, seed.doc.id);
      visited.add(nodeId);
      frontier.push({ doc: seed.doc, depth: 0, baseScore: seed.rrf });
      const entry = this.materializeEntry(seed.doc, "retriever", 0, seed.rrf, cleanQuery, enableFirewall);
      if (this.tryInsertEntry(entry)) {
        newlyPulled.push(entry);
        retrieverHits++;
        redactionsSum += entry.firewallRedactions;
      }
    }

    let currentFrontier = frontier;
    for (let depth = 1; depth <= hops && this.entries.size < SYNAPSE_DCI_CONFIG.MAX_WORKSPACE_DOCS; depth++) {
      const nextFrontier: { doc: SynapseDocument; depth: number; baseScore: number }[] = [];
      for (const item of currentFrontier) {
        const neighbors = [
          ...this.connectome.getOutgoingDocuments(item.doc.collection, item.doc.id),
          ...this.connectome.getIncomingDocuments(item.doc.collection, item.doc.id),
        ];
        for (const nb of neighbors) {
          if (options.collection && nb.collection !== options.collection) continue;
          const nbId = SynapseConnectome.makeNodeId(nb.collection, nb.id);
          if (visited.has(nbId)) continue;
          visited.add(nbId);
          const decayed = Number((item.baseScore * (0.65 / depth)).toFixed(4));
          const entry = this.materializeEntry(nb, "connectome-hop", depth, decayed, cleanQuery, enableFirewall);
          if (this.tryInsertEntry(entry)) {
            newlyPulled.push(entry);
            connectomeHopHits++;
            redactionsSum += entry.firewallRedactions;
            nextFrontier.push({ doc: nb, depth, baseScore: decayed });
          }
          if (this.entries.size >= SYNAPSE_DCI_CONFIG.MAX_WORKSPACE_DOCS) break;
        }
        if (this.entries.size >= SYNAPSE_DCI_CONFIG.MAX_WORKSPACE_DOCS) break;
      }
      currentFrontier = nextFrontier;
      if (currentFrontier.length === 0) break;
    }

    this.totalPulls++;
    this.totalFirewallRedactions += redactionsSum;
    return {
      query: cleanQuery,
      pulledCount: newlyPulled.length,
      retrieverHits,
      connectomeHopHits,
      firewallRedactions: redactionsSum,
      workspaceTotalDocs: this.entries.size,
      subgraphEdges: this.computeSubgraphEdges(),
      entries: newlyPulled,
      durationMs: Number((performance.now() - start).toFixed(4)),
    };
  }

  private executeHybridPull(
    query: string,
    topK: number,
    hops: number,
    collection: string | undefined,
    enableFirewall: boolean
  ): Omit<DciPullResult, "durationMs"> {
    const searchHits = this.connectome.search(query, collection).slice(0, topK);
    const newlyPulled: DciWorkspaceEntry[] = [];
    let retrieverHits = 0;
    let connectomeHopHits = 0;
    let redactionsSum = 0;

    // 1단계: 리트리버 1차 히트 적재
    const frontier: { doc: SynapseDocument; depth: number; baseScore: number }[] = [];
    const visited = new Set<string>();

    for (const hit of searchHits) {
      const nodeId = SynapseConnectome.makeNodeId(hit.document.collection, hit.document.id);
      visited.add(nodeId);
      frontier.push({ doc: hit.document, depth: 0, baseScore: hit.score });

      const entry = this.materializeEntry(
        hit.document,
        "retriever",
        0,
        hit.score,
        query,
        enableFirewall
      );
      if (this.tryInsertEntry(entry)) {
        newlyPulled.push(entry);
        retrieverHits++;
        redactionsSum += entry.firewallRedactions;
      }
    }

    // 2단계: Connectome 양방향 Multi-Hop 확장 (리트리버 맹점 보완)
    let currentFrontier = frontier;
    for (let depth = 1; depth <= hops && this.entries.size < SYNAPSE_DCI_CONFIG.MAX_WORKSPACE_DOCS; depth++) {
      const nextFrontier: { doc: SynapseDocument; depth: number; baseScore: number }[] = [];

      for (const item of currentFrontier) {
        const neighbors = [
          ...this.connectome.getOutgoingDocuments(item.doc.collection, item.doc.id),
          ...this.connectome.getIncomingDocuments(item.doc.collection, item.doc.id),
        ];

        for (const neighbor of neighbors) {
          if (collection && neighbor.collection !== collection) continue;
          const neighborId = SynapseConnectome.makeNodeId(neighbor.collection, neighbor.id);
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);

          const decayedScore = Number((item.baseScore * (0.65 / depth)).toFixed(4));
          const entry = this.materializeEntry(
            neighbor,
            "connectome-hop",
            depth,
            decayedScore,
            query,
            enableFirewall
          );

          if (this.tryInsertEntry(entry)) {
            newlyPulled.push(entry);
            connectomeHopHits++;
            redactionsSum += entry.firewallRedactions;
            nextFrontier.push({ doc: neighbor, depth, baseScore: decayedScore });
          }

          if (this.entries.size >= SYNAPSE_DCI_CONFIG.MAX_WORKSPACE_DOCS) break;
        }
        if (this.entries.size >= SYNAPSE_DCI_CONFIG.MAX_WORKSPACE_DOCS) break;
      }

      currentFrontier = nextFrontier;
      if (currentFrontier.length === 0) break;
    }

    this.totalFirewallRedactions += redactionsSum;
    const subgraphEdges = this.computeSubgraphEdges();

    return {
      query,
      pulledCount: newlyPulled.length,
      retrieverHits,
      connectomeHopHits,
      firewallRedactions: redactionsSum,
      workspaceTotalDocs: this.entries.size,
      subgraphEdges,
      entries: newlyPulled,
    };
  }

  private executeSafeFallbackPull(
    query: string,
    topK: number,
    collection: string | undefined,
    enableFirewall: boolean
  ): Omit<DciPullResult, "durationMs"> {
    const searchHits = this.connectome.search(query, collection).slice(0, topK);
    const newlyPulled: DciWorkspaceEntry[] = [];
    let redactionsSum = 0;

    for (const hit of searchHits) {
      const entry = this.materializeEntry(
        hit.document,
        "retriever",
        0,
        hit.score,
        query,
        enableFirewall
      );
      if (this.tryInsertEntry(entry)) {
        newlyPulled.push(entry);
        redactionsSum += entry.firewallRedactions;
      }
    }

    this.totalFirewallRedactions += redactionsSum;
    return {
      query,
      pulledCount: newlyPulled.length,
      retrieverHits: newlyPulled.length,
      connectomeHopHits: 0,
      firewallRedactions: redactionsSum,
      workspaceTotalDocs: this.entries.size,
      subgraphEdges: this.computeSubgraphEdges(),
      entries: newlyPulled,
    };
  }

  private materializeEntry(
    doc: SynapseDocument,
    source: DciWorkspaceEntry["source"],
    hopDepth: number,
    score: number,
    query: string,
    enableFirewall: boolean
  ): DciWorkspaceEntry {
    const nodeId = SynapseConnectome.makeNodeId(doc.collection, doc.id);
    const { sanitized, redactions } = enableFirewall
      ? sanitizeCorpusText(doc.body)
      : { sanitized: doc.body, redactions: 0 };

    const linksOut = doc.wikilinks.map((w) =>
      SynapseConnectome.makeNodeId(w.targetCollection || doc.collection, w.targetId)
    );

    return {
      nodeId,
      collection: doc.collection,
      id: doc.id,
      source,
      hopDepth,
      score,
      sanitizedBody: sanitized,
      firewallRedactions: redactions,
      anchors: extractAnchors(sanitized, query),
      linksOut,
    };
  }

  private tryInsertEntry(entry: DciWorkspaceEntry): boolean {
    if (this.entries.has(entry.nodeId)) return false;
    if (this.entries.size >= SYNAPSE_DCI_CONFIG.MAX_WORKSPACE_DOCS) return false;
    this.entries.set(entry.nodeId, entry);
    return true;
  }

  private computeSubgraphEdges(): DciSubgraphEdge[] {
    const edges: DciSubgraphEdge[] = [];
    for (const entry of this.entries.values()) {
      for (const target of entry.linksOut) {
        if (this.entries.has(target)) {
          edges.push({ from: entry.nodeId, to: target });
        }
      }
    }
    return edges;
  }

  /**
   * 2. In-Memory Zero-Shell Batch DCI: 셸 스폰 없이 단일 배치로 정밀 DCI 연산 실행
   */
  public executeBatch(ops: readonly DciBatchOp[]): DciBatchResult {
    const start = performance.now();
    const outputs: DciBatchOpOutput[] = [];

    for (const op of ops) {
      try {
        switch (op.op) {
          case "grep": {
            if (op.pattern.length > SYNAPSE_DCI_CONFIG.MAX_GREP_PATTERN_LEN) {
              throw new Error(
                `정규식 패턴 길이(${op.pattern.length})가 상한(${SYNAPSE_DCI_CONFIG.MAX_GREP_PATTERN_LEN})을 초과했습니다.`
              );
            }
            if (/(\+|\*|\{[^}]*\})\s*\)?\s*(\+|\*|\?)/.test(op.pattern)) {
              throw new Error("ReDoS 위험이 있는 중첩 수량자 정규식 패턴이 차단되었습니다.");
            }
            const flags = op.caseSensitive ? "g" : "gi";
            const regex = new RegExp(op.pattern, flags);
            const maxMatches = op.maxMatches ?? 50;
            const matches: { nodeId: string; lineNumber: number; line: string }[] = [];

            for (const entry of this.entries.values()) {
              const lines = entry.sanitizedBody.split(/\r?\n/);
              for (let i = 0; i < lines.length; i++) {
                regex.lastIndex = 0;
                if (regex.test(lines[i])) {
                  matches.push({ nodeId: entry.nodeId, lineNumber: i + 1, line: lines[i].trim() });
                  if (matches.length >= maxMatches) break;
                }
              }
              if (matches.length >= maxMatches) break;
            }
            outputs.push({ op: "grep", ok: true, data: matches });
            break;
          }

          case "slice": {
            const entry = this.entries.get(op.nodeId);
            if (!entry) {
              outputs.push({
                op: "slice",
                ok: false,
                data: `워크스페이스에 문서가 존재하지 않습니다: ${op.nodeId}`,
              });
              break;
            }
            const lines = entry.sanitizedBody.split(/\r?\n/);
            const from = Math.max(1, op.startLine);
            const to = Math.min(lines.length, op.endLine);
            const sliced = lines.slice(from - 1, to).map((line, idx) => ({
              lineNumber: from + idx,
              text: line,
            }));
            outputs.push({ op: "slice", ok: true, data: { nodeId: op.nodeId, lines: sliced } });
            break;
          }

          case "cross_ref": {
            const path = this.findWorkspacePath(op.fromNodeId, op.toNodeId);
            outputs.push({
              op: "cross_ref",
              ok: path !== null,
              data: path ? { connected: true, path } : { connected: false, path: [] },
            });
            break;
          }

          case "evict": {
            let evicted = 0;
            for (const id of op.nodeIds) {
              if (this.entries.delete(id)) evicted++;
            }
            outputs.push({ op: "evict", ok: true, data: { evictedCount: evicted } });
            break;
          }
        }
      } catch (err: any) {
        outputs.push({
          op: op.op,
          ok: false,
          data: `배치 연산 실패(${op.op}): ${err?.message || String(err)}`,
        });
      }
    }

    this.totalBatchOps += ops.length;
    return {
      totalOps: ops.length,
      executedOps: outputs.length,
      workspaceDocsRemaining: this.entries.size,
      outputs,
      durationMs: Number((performance.now() - start).toFixed(4)),
    };
  }

  private findWorkspacePath(fromNodeId: string, toNodeId: string): string[] | null {
    if (!this.entries.has(fromNodeId) || !this.entries.has(toNodeId)) return null;
    if (fromNodeId === toNodeId) return [fromNodeId];

    const queue: string[][] = [[fromNodeId]];
    const visited = new Set<string>([fromNodeId]);

    while (queue.length > 0) {
      const currentPath = queue.shift()!;
      const tail = currentPath[currentPath.length - 1];
      const entry = this.entries.get(tail);
      if (!entry) continue;

      for (const next of entry.linksOut) {
        if (!this.entries.has(next) || visited.has(next)) continue;
        const nextPath = [...currentPath, next];
        if (next === toNodeId) return nextPath;
        visited.add(next);
        queue.push(nextPath);
      }
    }
    return null;
  }

  /**
   * 3. Zero-Copy CoW Hypothesis Branching: 가설별 격리 워크스페이스 분기
   */
  public fork(branchName: string): SynapseDciWorkspace {
    const clean = branchName.trim();
    if (!clean) {
      throw new Error("[SynapseDciWorkspace] 브랜치 이름은 비어 있을 수 없습니다.");
    }
    if (this.branches.has(clean)) {
      throw new Error(`[SynapseDciWorkspace] 이미 존재하는 DCI 브랜치입니다: ${clean}`);
    }
    if (this.branches.size >= SYNAPSE_DCI_CONFIG.MAX_BRANCHES) {
      throw new Error(`[SynapseDciWorkspace] 최대 브랜치 개수(${SYNAPSE_DCI_CONFIG.MAX_BRANCHES}) 초과`);
    }

    const child = new SynapseDciWorkspace(this.connectome, clean);
    for (const [k, v] of this.entries) {
      child.entries.set(k, v);
    }
    for (const fact of this.foldedFacts) {
      child.foldedFacts.push(fact);
    }
    this.branches.set(clean, child);
    return child;
  }

  /**
   * 검증 완료된 가설 브랜치를 현재 워크스페이스로 병합
   */
  public mergeFrom(branchName: string, dropAfterMerge = true): DciMergeResult {
    const branch = this.branches.get(branchName);
    if (!branch) {
      throw new Error(`[SynapseDciWorkspace] 병합할 DCI 브랜치를 찾을 수 없습니다: ${branchName}`);
    }

    let mergedDocs = 0;
    for (const [nodeId, entry] of branch.entries) {
      if (!this.entries.has(nodeId) && this.entries.size < SYNAPSE_DCI_CONFIG.MAX_WORKSPACE_DOCS) {
        this.entries.set(nodeId, { ...entry, source: "merged-branch" });
        mergedDocs++;
      }
    }

    let mergedFacts = 0;
    const existingClaims = new Set(this.foldedFacts.map((f) => f.claim));
    for (const fact of branch.foldedFacts) {
      if (!existingClaims.has(fact.claim)) {
        this.foldedFacts.push(fact);
        existingClaims.add(fact.claim);
        mergedFacts++;
      }
    }

    if (dropAfterMerge) {
      this.branches.delete(branchName);
    }
    return { branchName, mergedDocs, mergedFacts };
  }

  public dropBranch(branchName: string): boolean {
    return this.branches.delete(branchName);
  }

  /**
   * 4. Causal-State Context Folding: 컨텍스트 리셋 시 핵심 추론 상태를 무손실 증류 보존
   */
  public foldContext(facts: readonly DciCausalFact[], rawConversationChars = 0): DciFoldedContext {
    const existingClaims = new Set(this.foldedFacts.map((f) => f.claim));
    for (const fact of facts) {
      if (!existingClaims.has(fact.claim)) {
        this.foldedFacts.push(fact);
        existingClaims.add(fact.claim);
      }
    }

    let rawChars = rawConversationChars;
    if (rawChars <= 0) {
      for (const entry of this.entries.values()) {
        rawChars += entry.sanitizedBody.length;
      }
    }

    const verified = this.foldedFacts.filter((f) => f.status === "verified");
    const refuted = this.foldedFacts.filter((f) => f.status === "refuted");
    const digestLines = this.foldedFacts.map(
      (f, idx) => `${idx + 1}. [${f.status.toUpperCase()}] ${f.claim} (ev: ${f.evidenceNodeIds.join(", ")})`
    );
    const digestText = digestLines.join("\n");

    const rawEstimatedTokens = Math.max(1, Math.ceil(rawChars / SYNAPSE_DCI_CONFIG.CHARS_PER_TOKEN));
    const foldedEstimatedTokens = Math.max(1, Math.ceil(digestText.length / SYNAPSE_DCI_CONFIG.CHARS_PER_TOKEN));
    const ratio = Number(Math.max(0, 1 - foldedEstimatedTokens / rawEstimatedTokens).toFixed(4));

    return {
      workspaceName: this.name,
      retainedDocs: this.entries.size,
      verifiedFactsCount: verified.length,
      refutedFactsCount: refuted.length,
      digestText,
      rawEstimatedTokens,
      foldedEstimatedTokens,
      tokenReductionRatio: ratio,
    };
  }

  public getEntry(nodeId: string): DciWorkspaceEntry | undefined {
    return this.entries.get(nodeId);
  }

  public listNodeIds(): string[] {
    return Array.from(this.entries.keys());
  }

  public getStats(): DciWorkspaceStats {
    return {
      name: this.name,
      docCount: this.entries.size,
      branchCount: this.branches.size,
      foldedFactsCount: this.foldedFacts.length,
      totalPulls: this.totalPulls,
      totalBatchOps: this.totalBatchOps,
      totalFirewallRedactions: this.totalFirewallRedactions,
    };
  }
}

