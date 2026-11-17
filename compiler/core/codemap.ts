/**
 * Synapse-Codemap: 초압축 리포지토리 심볼 맵 · 의존성 그래프 · PR Blast Radius 엔진
 */
export const CODEMAP_CONFIG = {
  CHARS_PER_TOKEN: 4,
  MAX_FILES: 50_000,
} as const;

export interface SourceFileInput {
  readonly path: string;
  readonly content: string;
}

export interface SymbolEntry {
  readonly kind: "class" | "function" | "interface" | "type" | "const" | "fn" | "struct";
  readonly name: string;
  readonly line: number;
}

export interface FileMapNode {
  readonly path: string;
  readonly symbols: readonly SymbolEntry[];
  readonly imports: readonly string[];
}

export interface RepoMapResult {
  readonly totalFiles: number;
  readonly totalSymbols: number;
  readonly compactMapText: string;
  readonly rawEstimatedTokens: number;
  readonly mapEstimatedTokens: number;
  readonly tokenReductionRatio: number;
  readonly nodes: readonly FileMapNode[];
  readonly reverseDeps: Readonly<Record<string, readonly string[]>>;
}

/**
 * TypeScript / Rust / JS 소스에서 핵심 export 심볼과 import 의존성 추출
 */
export function extractFileMap(file: SourceFileInput): FileMapNode {
  const symbols: SymbolEntry[] = [];
  const imports: string[] = [];
  const lines = file.content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Import 추출
    const impMatch = line.match(/^import\s+[\s\S]*?\s+from\s+["']([^"']+)["']/);
    if (impMatch) {
      imports.push(impMatch[1]);
      continue;
    }
    const useMatch = line.match(/^use\s+([a-zA-Z0-9_:]+);/);
    if (useMatch) {
      imports.push(useMatch[1]);
      continue;
    }

    // TS / JS export 심볼 추출
    const tsMatch = line.match(
      /^export\s+(?:async\s+)?(class|function|interface|type|const)\s+([A-Za-z0-9_]+)/
    );
    if (tsMatch) {
      symbols.push({
        kind: tsMatch[1] as SymbolEntry["kind"],
        name: tsMatch[2],
        line: i + 1,
      });
      continue;
    }

    // Rust pub fn / struct 추출
    const rsMatch = line.match(/^pub\s+(?:async\s+)?(fn|struct)\s+([A-Za-z0-9_]+)/);
    if (rsMatch) {
      symbols.push({
        kind: rsMatch[1] as SymbolEntry["kind"],
        name: rsMatch[2],
        line: i + 1,
      });
    }
  }

  return { path: file.path, symbols, imports };
}

/**
 * 전체 코드베이스를 초압축 Repo-Map 텍스트 및 역의존성 그래프로 컴파일
 */
export function buildRepoMap(files: readonly SourceFileInput[]): RepoMapResult {
  if (files.length > CODEMAP_CONFIG.MAX_FILES) {
    throw new Error(`[Synapse-Codemap] 최대 파일 수(${CODEMAP_CONFIG.MAX_FILES}) 초과`);
  }

  const nodes = files.map(extractFileMap);
  const reverseMap = new Map<string, string[]>();
  let rawChars = 0;
  let totalSymbols = 0;
  const mapLines: string[] = [];

  for (let i = 0; i < files.length; i++) {
    rawChars += files[i].content.length;
    const node = nodes[i];
    totalSymbols += node.symbols.length;

    const symSummary = node.symbols.map((s) => `${s.kind}:${s.name}@L${s.line}`).join(", ");
    mapLines.push(`${node.path} => [${symSummary || "no-exports"}]`);

    for (const imp of node.imports) {
      const list = reverseMap.get(imp) ?? [];
      list.push(node.path);
      reverseMap.set(imp, list);
    }
  }

  const compactMapText = mapLines.join("\n");
  const rawEstimatedTokens = Math.max(1, Math.ceil(rawChars / CODEMAP_CONFIG.CHARS_PER_TOKEN));
  const mapEstimatedTokens = Math.max(1, Math.ceil(compactMapText.length / CODEMAP_CONFIG.CHARS_PER_TOKEN));
  const ratio = Number(Math.max(0, 1 - mapEstimatedTokens / rawEstimatedTokens).toFixed(4));

  const reverseDeps: Record<string, readonly string[]> = {};
  for (const [k, v] of reverseMap.entries()) reverseDeps[k] = v;

  return {
    totalFiles: files.length,
    totalSymbols,
    compactMapText,
    rawEstimatedTokens,
    mapEstimatedTokens,
    tokenReductionRatio: ratio,
    nodes,
    reverseDeps,
  };
}

/**
 * PR 변경 파일 기준 역의존성 전파(Blast Radius) 계산 (O(V+E) 역인덱스 탐색)
 */
export function computePrBlastRadius(
  changedPaths: readonly string[],
  repoMap: RepoMapResult
): { changedCount: number; impactedFiles: readonly string[] } {
  const impacted = new Set<string>(changedPaths);
  const queue = [...changedPaths];

  // O(1) 조회를 위해 reverseDeps 키에서 선행 './' 제거 정규화 맵 1회 구축
  const normalizedDeps = new Map<string, readonly string[]>();
  for (const [impKey, dependents] of Object.entries(repoMap.reverseDeps)) {
    const cleanKey = impKey.replace(/^\.\//, "");
    const existing = normalizedDeps.get(cleanKey);
    normalizedDeps.set(cleanKey, existing ? [...existing, ...dependents] : dependents);
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const noExt = cur.replace(/\.[a-z]+$/i, "");
    const slashIdx = noExt.indexOf("/");
    const tail = slashIdx >= 0 ? noExt.slice(slashIdx + 1) : noExt;

    const candidates = [
      normalizedDeps.get(cur),
      normalizedDeps.get(noExt),
      normalizedDeps.get(tail),
    ];

    for (const list of candidates) {
      if (!list) continue;
      for (const dep of list) {
        if (!impacted.has(dep)) {
          impacted.add(dep);
          queue.push(dep);
        }
      }
    }
  }

  return {
    changedCount: changedPaths.length,
    impactedFiles: Array.from(impacted),
  };
}
