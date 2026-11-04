import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { CAUSAL_MEMORY_CONFIG } from './causal-config';

/**
 * 인과율 트리거 규격
 */
export interface CausalTrigger {
  readonly files?: readonly string[];
  readonly keywords?: readonly string[];
  readonly commands?: readonly string[];
  readonly alwaysActive?: boolean;
}

/**
 * 인과율 간선(Relation) 규격
 */
export interface CausalRelation {
  readonly from: string;
  readonly to: string;
  readonly relationType: string;
}

/**
 * 인과율 규칙(Node) 규격
 */
export interface CausalRule {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly entityType?: string;
  readonly triggers: CausalTrigger;
  readonly invariants: readonly string[];
  readonly actions: readonly string[];
  readonly context: readonly string[];
  readonly lastVerified?: string;
}

/**
 * 인과율 메모리 데이터베이스 규격
 */
export interface CausalMemoryDatabase {
  readonly version: string;
  readonly updatedAt: string;
  readonly totalRules: number;
  readonly totalRelations: number;
  readonly rules: readonly CausalRule[];
  readonly relations: readonly CausalRelation[];
}

/**
 * 공명 쿼리 입력 규격
 */
export interface CausalQueryOptions {
  readonly files?: readonly string[];
  readonly keywords?: readonly string[];
  readonly command?: string;
  readonly domain?: string;
  readonly propagateRelations?: boolean;
  readonly maxHops?: number;
}

/**
 * 공명 쿼리 결과 규격
 */
export interface CausalResonanceResult {
  readonly queryDurationMs: number;
  readonly matchedCount: number;
  readonly totalDatabaseRules: number;
  readonly resonanceRules: readonly CausalRule[];
  readonly activeRelations: readonly CausalRelation[];
  readonly tokenDietSavingsRatio: string;
}

/**
 * 구형 memory MCP 호환 엔티티 규격
 */
export interface LegacyEntityInput {
  readonly name: string;
  readonly entityType: string;
  readonly observations: readonly string[];
}

/**
 * 사전 컴파일된 파일 트리거 엔트리
 */
interface CompiledFileRule {
  readonly rule: CausalRule;
  readonly domainLower: string;
  readonly cleanPatterns: readonly string[];
}

/**
 * 사전 컴파일된 검색 엔트리
 */
interface CompiledSearchRule {
  readonly rule: CausalRule;
  readonly domainLower: string;
  readonly searchableText: string;
}

/**
 * 인과율 메모리 저장소 및 O(1) 역인덱스 공명 엔진 클래스 (SRP 및 OCP 준수)
 */
export class CausalMemoryStore {
  private readonly dbPath: string;
  private database: CausalMemoryDatabase;
  private lastMtimeMs: number = 0;

  // 고속 O(1) 조회용 인메모리 인덱스 구조체
  private alwaysActiveRules: CausalRule[] = [];
  private domainIndex: Map<string, CausalRule[]> = new Map();
  private commandIndex: Map<string, CausalRule[]> = new Map();
  private exactKeywordIndex: Map<string, CausalRule[]> = new Map();
  private exactFileIndex: Map<string, CausalRule[]> = new Map();
  private prefixFileRules: CompiledFileRule[] = [];
  private compiledSearchRules: CompiledSearchRule[] = [];
  private titleToRuleMap: Map<string, CausalRule> = new Map();
  private idToRuleMap: Map<string, CausalRule> = new Map();
  private relationAdjacency: Map<string, CausalRelation[]> = new Map();

  constructor(customPath?: string, initialDatabase?: CausalMemoryDatabase) {
    this.dbPath =
      customPath ||
      (existsSync(CAUSAL_MEMORY_CONFIG.GLOBAL_DB_PATH)
        ? CAUSAL_MEMORY_CONFIG.GLOBAL_DB_PATH
        : CAUSAL_MEMORY_CONFIG.LOCAL_DB_PATH);

    if (initialDatabase) {
      this.database = initialDatabase;
      this.rebuildIndices();
    } else {
      this.database = this.loadDatabase();
      this.rebuildIndices();
    }
  }

  /**
   * 디스크 파일 변경(mtimeMs)이 감지된 경우에만 스마트 리로드 수행 (Zero-Copy Cache)
   */
  public reloadIfNeeded(): boolean {
    try {
      if (!existsSync(this.dbPath)) return false;
      const stat = statSync(this.dbPath);
      if (stat.mtimeMs > this.lastMtimeMs) {
        this.database = this.loadDatabase();
        this.rebuildIndices();
        return true;
      }
    } catch {
      // stat 실패 시 기존 인메모리 상태 유지
    }
    return false;
  }

  /**
   * 강제 디스크 리로드
   */
  public reload(): void {
    this.database = this.loadDatabase();
    this.rebuildIndices();
  }

  /**
   * 인메모리 데이터베이스 직접 주입 (벤치마크 및 인메모리 시뮬레이션용)
   */
  public loadFromMemory(db: CausalMemoryDatabase): void {
    this.database = db;
    this.rebuildIndices();
  }

  /**
   * O(1) 역인덱스(Inverted Index) 및 인접 리스트 그래프(Adjacency List) 재구축
   */
  private rebuildIndices(): void {
    this.alwaysActiveRules = [];
    this.domainIndex.clear();
    this.commandIndex.clear();
    this.exactKeywordIndex.clear();
    this.exactFileIndex.clear();
    this.prefixFileRules = [];
    this.compiledSearchRules = [];
    this.titleToRuleMap.clear();
    this.idToRuleMap.clear();
    this.relationAdjacency.clear();

    const addTokenToKeywordIndex = (token: string, rule: CausalRule) => {
      if (!token) return;
      let list = this.exactKeywordIndex.get(token);
      if (!list) {
        list = [];
        this.exactKeywordIndex.set(token, list);
      }
      if (list[list.length - 1] !== rule) {
        list.push(rule);
      }
    };

    for (const rule of this.database.rules) {
      const domainLower = rule.domain.toLowerCase();
      const titleLower = rule.title.toLowerCase();
      const idLower = rule.id.toLowerCase();

      this.titleToRuleMap.set(titleLower, rule);
      this.idToRuleMap.set(idLower, rule);

      // 1. 도메인 인덱스
      let domList = this.domainIndex.get(domainLower);
      if (!domList) {
        domList = [];
        this.domainIndex.set(domainLower, domList);
      }
      domList.push(rule);

      // 2. 상시 활성 규칙 분리
      if (rule.triggers.alwaysActive) {
        this.alwaysActiveRules.push(rule);
      }

      // 3. 명령어 역인덱스
      if (rule.triggers.commands) {
        for (const cmd of rule.triggers.commands) {
          const cmdLower = cmd.toLowerCase();
          let cmdList = this.commandIndex.get(cmdLower);
          if (!cmdList) {
            cmdList = [];
            this.commandIndex.set(cmdLower, cmdList);
          }
          cmdList.push(rule);
        }
      }

      // 4. 키워드 & 토큰 O(1) 역인덱스
      addTokenToKeywordIndex(titleLower, rule);
      addTokenToKeywordIndex(domainLower, rule);
      for (const part of titleLower.split(/[\s_-]+/)) {
        addTokenToKeywordIndex(part, rule);
      }
      if (rule.triggers.keywords) {
        for (const kw of rule.triggers.keywords) {
          const kwLower = kw.toLowerCase();
          addTokenToKeywordIndex(kwLower, rule);
          for (const sub of kwLower.split(/[\s_-]+/)) {
            addTokenToKeywordIndex(sub, rule);
          }
        }
      }

      // 5. 파일 경로 O(1) 해시 역인덱스 + 부분 접두어 패턴 분리
      if (rule.triggers.files && rule.triggers.files.length > 0) {
        const prefixPatterns: string[] = [];
        for (const pattern of rule.triggers.files) {
          const cleaned = (pattern.includes('\\') ? pattern.replaceAll('\\', '/') : pattern)
            .replace(/^\*\*\/|\*\*$|\*$/g, '')
            .replace(/\/+$/, '')
            .toLowerCase();
          if (!cleaned) continue;

          let fList = this.exactFileIndex.get(cleaned);
          if (!fList) {
            fList = [];
            this.exactFileIndex.set(cleaned, fList);
          }
          fList.push(rule);

          // 하이픈 등으로 끝나는 부분 접두어 패턴(예: crates/vesper-)만 별도 보관
          if (cleaned.endsWith('-') || cleaned.endsWith('_') || cleaned.includes(':')) {
            prefixPatterns.push(cleaned);
          }
        }
        if (prefixPatterns.length > 0) {
          this.prefixFileRules.push({ rule, domainLower, cleanPatterns: prefixPatterns });
        }
      }
    }

    // 7. 양방향 인과 간선 인접 리스트(Adjacency List) 구축
    for (const rel of this.database.relations) {
      const fromLower = rel.from.toLowerCase();
      const toLower = rel.to.toLowerCase();

      let fromAdj = this.relationAdjacency.get(fromLower);
      if (!fromAdj) {
        fromAdj = [];
        this.relationAdjacency.set(fromLower, fromAdj);
      }
      fromAdj.push(rel);

      if (toLower !== fromLower) {
        let toAdj = this.relationAdjacency.get(toLower);
        if (!toAdj) {
          toAdj = [];
          this.relationAdjacency.set(toLower, toAdj);
        }
        toAdj.push(rel);
      }
    }
  }

  /**
   * 데이터베이스 로드
   */
  private loadDatabase(): CausalMemoryDatabase {
    try {
      if (existsSync(this.dbPath)) {
        const stat = statSync(this.dbPath);
        this.lastMtimeMs = stat.mtimeMs;
        const raw = readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const rules: CausalRule[] = Array.isArray(parsed.rules) ? parsed.rules : [];
        const relations: CausalRelation[] = Array.isArray(parsed.relations) ? parsed.relations : [];
        return {
          version: parsed.version || CAUSAL_MEMORY_CONFIG.SCHEMA_VERSION,
          updatedAt: parsed.updatedAt || new Date().toISOString(),
          totalRules: rules.length,
          totalRelations: relations.length,
          rules,
          relations,
        };
      }
    } catch {
      // 파일 손상 또는 부재 시 안전 초기화
    }

    return {
      version: CAUSAL_MEMORY_CONFIG.SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      totalRules: 0,
      totalRelations: 0,
      rules: [],
      relations: [],
    };
  }

  /**
   * 데이터베이스 디스크 동기화
   */
  private saveDatabase(): void {
    try {
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const serialized = JSON.stringify(this.database, null, 2);
      writeFileSync(this.dbPath, serialized, 'utf-8');
      this.lastMtimeMs = statSync(this.dbPath).mtimeMs;

      if (
        this.dbPath === CAUSAL_MEMORY_CONFIG.GLOBAL_DB_PATH &&
        existsSync(dirname(CAUSAL_MEMORY_CONFIG.LOCAL_DB_PATH))
      ) {
        writeFileSync(CAUSAL_MEMORY_CONFIG.LOCAL_DB_PATH, serialized, 'utf-8');
      }
    } catch (error) {
      throw new Error(
        `인과율 메모리 디스크 저장 실패: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public getAllRules(): readonly CausalRule[] {
    return this.database.rules;
  }

  public getAllRelations(): readonly CausalRelation[] {
    return this.database.relations;
  }

  public getStatus() {
    const domainCounts: Record<string, number> = {};
    for (const [dom, list] of this.domainIndex.entries()) {
      const originalDomainName = list[0]?.domain || dom;
      domainCounts[originalDomainName] = list.length;
    }

    return {
      version: this.database.version,
      updatedAt: this.database.updatedAt,
      totalRules: this.database.rules.length,
      totalRelations: this.database.relations.length,
      dbPath: this.dbPath,
      domains: Object.keys(domainCounts),
      domainCounts,
    };
  }

  /**
   * 부분 문자열 폴백 검색을 위한 지연 컴파일러 (Lazy Compilation)
   */
  private getCompiledSearchRules(): readonly CompiledSearchRule[] {
    if (this.compiledSearchRules.length === 0 && this.database.rules.length > 0) {
      for (const rule of this.database.rules) {
        const domainLower = rule.domain.toLowerCase();
        const searchableText = [
          rule.title,
          rule.domain,
          ...(rule.triggers.keywords || []),
          ...rule.invariants,
          ...rule.actions,
          ...rule.context,
        ]
          .join(' ')
          .toLowerCase();
        this.compiledSearchRules.push({ rule, domainLower, searchableText });
      }
    }
    return this.compiledSearchRules;
  }

  /**
   * 초고속 O(1) 역인덱스 및 다중 홉(Multi-Hop) 그래프 전파 공명 쿼리 엔진
   */
  public queryResonance(options: CausalQueryOptions): CausalResonanceResult {
    const startTime = performance.now();
    const targetDomain = options.domain ? options.domain.toLowerCase() : undefined;
    const queryCommand = options.command ? options.command.toLowerCase() : undefined;
    const propagate = options.propagateRelations ?? true;
    const maxHops = options.maxHops ?? 1;

    const matchedRulesMap = new Map<string, CausalRule>();
    const nonAlwaysMatchedTitles = new Set<string>();

    // 1. 상시 활성(alwaysActive) 규칙 즉시 O(1) 등록
    for (const rule of this.alwaysActiveRules) {
      if (targetDomain && rule.domain.toLowerCase() !== targetDomain) continue;
      matchedRulesMap.set(rule.id, rule);
    }

    // 2. 명령어(command) 역인덱스 O(1) 조회
    if (queryCommand) {
      const cmdRules = this.commandIndex.get(queryCommand);
      if (cmdRules) {
        for (const rule of cmdRules) {
          if (targetDomain && rule.domain.toLowerCase() !== targetDomain) continue;
          matchedRulesMap.set(rule.id, rule);
          nonAlwaysMatchedTitles.add(rule.title.toLowerCase());
        }
      }
    }

    // 3. 파일 경로 매칭 (Zero-Set Single-Pass Direct Hash Probe + Directory Locality Cache)
    if (options.files && options.files.length > 0 && this.exactFileIndex.size > 0) {
      const hasPrefixRules = this.prefixFileRules.length > 0;
      const checkedDirs = new Set<string>();

      const registerHits = (hits: CausalRule[] | undefined) => {
        if (!hits) return;
        for (let i = 0; i < hits.length; i++) {
          const rule = hits[i];
          if (targetDomain && rule.domain.toLowerCase() !== targetDomain) continue;
          matchedRulesMap.set(rule.id, rule);
          nonAlwaysMatchedTitles.add(rule.title.toLowerCase());
        }
      };

      let lastTwoSeg = '';

      for (let i = 0; i < options.files.length; i++) {
        const rawFile = options.files[i];
        const nf = (rawFile.includes('\\') ? rawFile.replaceAll('\\', '/') : rawFile).toLowerCase();

        // 1) 전체 경로 즉시 O(1) 조회
        registerHits(this.exactFileIndex.get(nf));

        const firstSlash = nf.indexOf('/');
        if (firstSlash > 0) {
          const secondSlash = nf.indexOf('/', firstSlash + 1);
          const twoSeg = secondSlash > 0 ? nf.slice(0, secondSlash) : nf.slice(0, firstSlash);

          // 2) 디렉터리 지역성(Locality) 캐시: 직전 파일과 동일 디렉터리면 중복 조회 스킵
          if (twoSeg !== lastTwoSeg) {
            lastTwoSeg = twoSeg;
            if (!checkedDirs.has(twoSeg)) {
              checkedDirs.add(twoSeg);
              registerHits(this.exactFileIndex.get(twoSeg));
              const oneSeg = nf.slice(0, firstSlash);
              if (oneSeg !== twoSeg && !checkedDirs.has(oneSeg)) {
                checkedDirs.add(oneSeg);
                registerHits(this.exactFileIndex.get(oneSeg));
              }
            }
          }

          // 3) 파일명(basename) 조회
          const lastSlash = nf.lastIndexOf('/');
          registerHits(this.exactFileIndex.get(nf.slice(lastSlash + 1)));
        } else {
          checkedDirs.add(nf);
        }
      }

      // 4) 부분 접두어 패턴(예: crates/vesper-) 매칭 (고유 디렉터리만 대상)
      if (hasPrefixRules && checkedDirs.size > 0) {
        const prefixArr = Array.from(checkedDirs);
        for (const entry of this.prefixFileRules) {
          if (targetDomain && entry.domainLower !== targetDomain) continue;
          if (matchedRulesMap.has(entry.rule.id)) continue;

          for (const pattern of entry.cleanPatterns) {
            if (prefixArr.some((p) => p.includes(pattern) || pattern.includes(p))) {
              matchedRulesMap.set(entry.rule.id, entry.rule);
              nonAlwaysMatchedTitles.add(entry.rule.title.toLowerCase());
              break;
            }
          }
        }
      }
    }

    // 4. 키워드 매칭 (역인덱스 1차 O(1) 해시 룩업 + 미적중 시에만 서브스트링 폴백)
    const queryKeywords = (options.keywords || [])
      .flatMap((k) => k.toLowerCase().split(/\s+/))
      .filter((k) => k.length > 0);

    if (queryKeywords.length > 0) {
      const unindexedKeywords: string[] = [];

      for (const qk of queryKeywords) {
        const exactHits = this.exactKeywordIndex.get(qk);
        if (exactHits && exactHits.length > 0) {
          for (const rule of exactHits) {
            if (targetDomain && rule.domain.toLowerCase() !== targetDomain) continue;
            matchedRulesMap.set(rule.id, rule);
            nonAlwaysMatchedTitles.add(rule.title.toLowerCase());
          }
        } else {
          unindexedKeywords.push(qk);
        }
      }

      // 역인덱스에 없는 부분 문자열 키워드가 있을 때만 지연 컴파일된 폴백 스캔 수행
      if (unindexedKeywords.length > 0) {
        const searchPool = this.getCompiledSearchRules();
        for (const entry of searchPool) {
          if (targetDomain && entry.domainLower !== targetDomain) continue;
          if (matchedRulesMap.has(entry.rule.id)) continue;

          for (const qk of unindexedKeywords) {
            if (entry.searchableText.includes(qk)) {
              matchedRulesMap.set(entry.rule.id, entry.rule);
              nonAlwaysMatchedTitles.add(entry.rule.title.toLowerCase());
              break;
            }
          }
        }
      }
    }

    // 5. 인접 리스트(Adjacency List) 기반 다중 홉(Multi-Hop) 인과 파동 전파 (순환 참조 완벽 방지)
    const activeRelationsSet = new Set<CausalRelation>();
    const visitedTitles = new Set<string>(
      Array.from(matchedRulesMap.values()).map((r) => r.title.toLowerCase())
    );

    let currentFrontier = new Set<string>(
      nonAlwaysMatchedTitles.size > 0 ? nonAlwaysMatchedTitles : visitedTitles
    );

    const effectiveHops = propagate ? Math.max(1, maxHops) : 1;

    for (let hop = 0; hop < effectiveHops; hop++) {
      const nextFrontier = new Set<string>();

      for (const titleLower of currentFrontier) {
        const adjRelations = this.relationAdjacency.get(titleLower);
        if (!adjRelations) continue;

        for (const rel of adjRelations) {
          activeRelationsSet.add(rel);

          if (propagate && nonAlwaysMatchedTitles.size > 0) {
            const neighborLower =
              rel.from.toLowerCase() === titleLower
                ? rel.to.toLowerCase()
                : rel.from.toLowerCase();

            if (!visitedTitles.has(neighborLower)) {
              visitedTitles.add(neighborLower);
              nextFrontier.add(neighborLower);

              const neighborRule = this.titleToRuleMap.get(neighborLower);
              if (
                neighborRule &&
                (!targetDomain || neighborRule.domain.toLowerCase() === targetDomain)
              ) {
                matchedRulesMap.set(neighborRule.id, neighborRule);
              }
            }
          }
        }
      }

      if (nextFrontier.size === 0) break;
      currentFrontier = nextFrontier;
    }

    const matchedRules = Array.from(matchedRulesMap.values());
    const activeRelations = Array.from(activeRelationsSet);
    const duration = performance.now() - startTime;
    const totalCount = this.database.rules.length;
    const savings =
      totalCount > 0
        ? (((totalCount - matchedRules.length) / totalCount) * 100).toFixed(1) + '%'
        : '0.0%';

    return {
      queryDurationMs: Math.round(duration * 100) / 100,
      matchedCount: matchedRules.length,
      totalDatabaseRules: totalCount,
      resonanceRules: matchedRules,
      activeRelations,
      tokenDietSavingsRatio: savings,
    };
  }

  /**
   * 신규 규칙 등록 또는 기존 규칙 갱신
   */
  public assertRule(rule: CausalRule, persistToDisk: boolean = true): void {
    const existingIndex = this.database.rules.findIndex(
      (r) => r.id === rule.id || r.title.toLowerCase() === rule.title.toLowerCase()
    );
    const updatedRules = [...this.database.rules];
    const today = new Date().toISOString().split('T')[0];

    if (existingIndex >= 0) {
      updatedRules[existingIndex] = {
        ...rule,
        id: rule.id || updatedRules[existingIndex].id,
        lastVerified: today,
      };
    } else {
      updatedRules.push({
        ...rule,
        lastVerified: today,
      });
    }

    this.database = {
      ...this.database,
      updatedAt: new Date().toISOString(),
      totalRules: updatedRules.length,
      rules: updatedRules,
    };

    this.rebuildIndices();
    if (persistToDisk) {
      this.saveDatabase();
    }
  }

  /**
   * 구형 memory MCP 호환: read_graph 대체 (초경량 인과 공명 요약 반환)
   */
  public readSmartGraph(files: readonly string[] = []) {
    const resonance = this.queryResonance({ files });
    const status = this.getStatus();

    const entities = resonance.resonanceRules.map((r) => ({
      name: r.title,
      entityType: r.entityType || r.domain,
      domain: r.domain,
      invariants: r.invariants,
      actions: r.actions,
      observations: [
        ...r.invariants.map((i) => `[불변규칙] ${i}`),
        ...r.actions.map((a) => `[실행지침] ${a}`),
        ...r.context,
      ],
    }));

    return {
      causalMemoryEngine: `v${status.version} (Active Resonance Mode)`,
      tokenDietSavings: resonance.tokenDietSavingsRatio,
      queryDurationMs: resonance.queryDurationMs,
      activeEntitiesCount: entities.length,
      totalIndexedRules: status.totalRules,
      totalIndexedRelations: status.totalRelations,
      availableDomains: status.domainCounts,
      hint: '무관한 도메인 지식은 토큰 절감을 위해 0ms 스킵되었습니다. 특정 도메인 상세 조회는 search_nodes 또는 query_causal_memory를 사용하세요.',
      entities,
      relations: resonance.activeRelations,
    };
  }

  /**
   * 구형 memory MCP 호환: search_nodes
   */
  public searchNodes(query: string) {
    const trimmed = query.trim();
    if (!trimmed) {
      return this.readSmartGraph();
    }

    const tokens = trimmed.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    const matchedRules: CausalRule[] = [];
    const matchedTitles = new Set<string>();

    const searchPool = this.getCompiledSearchRules();
    for (const entry of searchPool) {
      const ruleIdLower = entry.rule.id.toLowerCase();
      if (
        tokens.some(
          (tok) => entry.searchableText.includes(tok) || ruleIdLower.includes(tok)
        )
      ) {
        matchedRules.push(entry.rule);
        matchedTitles.add(entry.rule.title.toLowerCase());
      }
    }

    const relationsSet = new Set<CausalRelation>();
    for (const titleLower of matchedTitles) {
      const adj = this.relationAdjacency.get(titleLower);
      if (adj) {
        for (const r of adj) relationsSet.add(r);
      }
    }

    return {
      entities: matchedRules.map((r) => ({
        name: r.title,
        entityType: r.entityType || r.domain,
        observations: [...r.invariants, ...r.actions, ...r.context],
      })),
      relations: Array.from(relationsSet),
    };
  }

  /**
   * 구형 memory MCP 호환: open_nodes
   */
  public openNodes(names: readonly string[]) {
    const matchedRules: CausalRule[] = [];
    const matchedTitles = new Set<string>();

    for (const name of names) {
      const lower = name.toLowerCase();
      const rule = this.titleToRuleMap.get(lower) || this.idToRuleMap.get(lower);
      if (rule && !matchedTitles.has(rule.title.toLowerCase())) {
        matchedRules.push(rule);
        matchedTitles.add(rule.title.toLowerCase());
      }
    }

    const relationsSet = new Set<CausalRelation>();
    for (const titleLower of matchedTitles) {
      const adj = this.relationAdjacency.get(titleLower);
      if (adj) {
        for (const r of adj) relationsSet.add(r);
      }
    }

    return {
      entities: matchedRules.map((r) => ({
        name: r.title,
        entityType: r.entityType || r.domain,
        observations: [...r.invariants, ...r.actions, ...r.context],
      })),
      relations: Array.from(relationsSet),
    };
  }

  /**
   * 구형 memory MCP 호환: create_entities
   */
  public createEntities(
    entities: readonly LegacyEntityInput[],
    persistToDisk: boolean = true
  ): LegacyEntityInput[] {
    const created: LegacyEntityInput[] = [];
    const updatedRules = [...this.database.rules];
    const today = new Date().toISOString().split('T')[0];

    for (const ent of entities) {
      if (this.titleToRuleMap.has(ent.name.toLowerCase())) continue;

      const inferred = CausalMemoryStore.inferRuleFromEntity(ent, today);
      updatedRules.push(inferred);
      created.push(ent);
    }

    if (created.length > 0) {
      this.database = {
        ...this.database,
        updatedAt: new Date().toISOString(),
        totalRules: updatedRules.length,
        rules: updatedRules,
      };
      this.rebuildIndices();
      if (persistToDisk) {
        this.saveDatabase();
      }
    }

    return created;
  }

  /**
   * 구형 memory MCP 호환: add_observations
   */
  public addObservations(
    observations: readonly { readonly entityName: string; readonly contents: readonly string[] }[],
    persistToDisk: boolean = true
  ) {
    const updatedRules = [...this.database.rules];
    const results: { entityName: string; addedObservations: string[] }[] = [];
    let changed = false;

    for (const item of observations) {
      const idx = updatedRules.findIndex(
        (r) => r.title.toLowerCase() === item.entityName.toLowerCase()
      );
      if (idx < 0) continue;

      const rule = updatedRules[idx];
      const existingObs = new Set([...rule.invariants, ...rule.actions, ...rule.context]);
      const added: string[] = [];
      const newInvariants = [...rule.invariants];
      const newActions = [...rule.actions];
      const newContext = [...rule.context];

      for (const content of item.contents) {
        if (existingObs.has(content)) continue;
        added.push(content);
        existingObs.add(content);
        changed = true;

        if (
          content.includes('금지') ||
          content.includes('절대') ||
          content.includes('필수') ||
          content.includes('주의')
        ) {
          newInvariants.push(content);
        } else if (/^\d+\.|단계|Step/i.test(content)) {
          newActions.push(content);
        } else {
          newContext.push(content);
        }
      }

      updatedRules[idx] = {
        ...rule,
        invariants: newInvariants,
        actions: newActions,
        context: newContext,
        lastVerified: new Date().toISOString().split('T')[0],
      };

      results.push({ entityName: item.entityName, addedObservations: added });
    }

    if (changed) {
      this.database = {
        ...this.database,
        updatedAt: new Date().toISOString(),
        rules: updatedRules,
      };
      this.rebuildIndices();
      if (persistToDisk) {
        this.saveDatabase();
      }
    }

    return results;
  }

  /**
   * 구형 memory MCP 호환: create_relations
   */
  public createRelations(
    relations: readonly CausalRelation[],
    persistToDisk: boolean = true
  ): CausalRelation[] {
    const updatedRelations = [...this.database.relations];
    const created: CausalRelation[] = [];

    for (const rel of relations) {
      const exists = updatedRelations.some(
        (r) =>
          r.from === rel.from && r.to === rel.to && r.relationType === rel.relationType
      );
      if (!exists) {
        updatedRelations.push(rel);
        created.push(rel);
      }
    }

    if (created.length > 0) {
      this.database = {
        ...this.database,
        updatedAt: new Date().toISOString(),
        totalRelations: updatedRelations.length,
        relations: updatedRelations,
      };
      this.rebuildIndices();
      if (persistToDisk) {
        this.saveDatabase();
      }
    }

    return created;
  }

  /**
   * 단일 인과 규칙 삭제
   */
  public deleteRule(ruleId: string, persistToDisk: boolean = true): boolean {
    const targetId = ruleId.toLowerCase();
    const initialCount = this.database.rules.length;
    const filteredRules = this.database.rules.filter((r) => r.id.toLowerCase() !== targetId);

    if (filteredRules.length === initialCount) {
      return false;
    }

    this.database = {
      ...this.database,
      updatedAt: new Date().toISOString(),
      totalRules: filteredRules.length,
      rules: filteredRules,
    };
    this.rebuildIndices();
    if (persistToDisk) {
      this.saveDatabase();
    }
    return true;
  }

  /**
   * 구형 memory MCP 호환: delete_entities
   */
  public deleteEntities(entityNames: readonly string[], persistToDisk: boolean = true): void {
    const nameSet = new Set(entityNames.map((n) => n.toLowerCase()));
    const filteredRules = this.database.rules.filter(
      (r) => !nameSet.has(r.title.toLowerCase()) && !nameSet.has(r.id.toLowerCase())
    );
    const filteredRelations = this.database.relations.filter(
      (rel) => !nameSet.has(rel.from.toLowerCase()) && !nameSet.has(rel.to.toLowerCase())
    );

    this.database = {
      ...this.database,
      updatedAt: new Date().toISOString(),
      totalRules: filteredRules.length,
      totalRelations: filteredRelations.length,
      rules: filteredRules,
      relations: filteredRelations,
    };
    this.rebuildIndices();
    if (persistToDisk) {
      this.saveDatabase();
    }
  }

  /**
   * 구형 memory MCP 호환: delete_observations
   */
  public deleteObservations(
    deletions: readonly { readonly entityName: string; readonly observations: readonly string[] }[],
    persistToDisk: boolean = true
  ): void {
    const updatedRules = [...this.database.rules];

    for (const del of deletions) {
      const idx = updatedRules.findIndex(
        (r) => r.title.toLowerCase() === del.entityName.toLowerCase()
      );
      if (idx < 0) continue;

      const toDelete = new Set(del.observations);
      const rule = updatedRules[idx];
      updatedRules[idx] = {
        ...rule,
        invariants: rule.invariants.filter((x) => !toDelete.has(x)),
        actions: rule.actions.filter((x) => !toDelete.has(x)),
        context: rule.context.filter((x) => !toDelete.has(x)),
      };
    }

    this.database = {
      ...this.database,
      updatedAt: new Date().toISOString(),
      rules: updatedRules,
    };
    this.rebuildIndices();
    if (persistToDisk) {
      this.saveDatabase();
    }
  }

  /**
   * 구형 memory MCP 호환: delete_relations
   */
  public deleteRelations(
    relations: readonly CausalRelation[],
    persistToDisk: boolean = true
  ): void {
    const filtered = this.database.relations.filter(
      (existing) =>
        !relations.some(
          (del) =>
            del.from === existing.from &&
            del.to === existing.to &&
            del.relationType === existing.relationType
        )
    );

    this.database = {
      ...this.database,
      updatedAt: new Date().toISOString(),
      totalRelations: filtered.length,
      relations: filtered,
    };
    this.rebuildIndices();
    if (persistToDisk) {
      this.saveDatabase();
    }
  }

  /**
   * 엔티티 입력으로부터 도메인 및 인과율 규칙 자동 추론
   */
  public static inferRuleFromEntity(ent: LegacyEntityInput, today: string): CausalRule {
    const nameLower = ent.name.toLowerCase();
    const typeLower = ent.entityType.toLowerCase();
    const obsJoined = ent.observations.join(' ').toLowerCase();

    let domain = 'Knowledge_Base';
    const triggers: {
      files?: string[];
      keywords?: string[];
      commands?: string[];
      alwaysActive?: boolean;
    } = {};
    const invariants: string[] = [];
    const actions: string[] = [];
    const context: string[] = [];

    const isTrueUserPreference =
      typeLower === 'preference' ||
      typeLower === 'user_constraint' ||
      typeLower === 'forbidden_rules' ||
      nameLower === 'userpreferences' ||
      nameLower === 'user_web_navigation_preference' ||
      nameLower === 'python_strictly_forbidden' ||
      nameLower === 'forbidden_topics_until_mentioned';

    if (isTrueUserPreference) {
      domain = 'User_Preferences_And_Rules';
      triggers.alwaysActive = true;
      triggers.keywords = ['환경설정', '규칙', '터미널', '출력', '보안', '선호도'];
    } else if (
      nameLower.includes('poe2') ||
      nameLower.includes('noble-babbage') ||
      nameLower.includes('release_workflow') ||
      obsJoined.includes('poe2filter-releases') ||
      obsJoined.includes('noble-babbage')
    ) {
      domain = 'Project_POE2_AutoFilter';
      triggers.files = [
        'noble-babbage',
        'poe2filter-releases',
        'updater.json',
        'post_download_button.js',
      ];
      triggers.keywords = ['poe2', 'autofilter', '필터', '오토필터', 'updater', 'discord', '릴리즈', '배포'];
      triggers.commands = ['release', 'updater', 'build', 'sign'];
    } else if (
      nameLower.includes('vesper') ||
      nameLower.includes('dsp') ||
      nameLower.includes('neurospatial audio') ||
      typeLower.includes('audio_architecture')
    ) {
      domain = 'Project_Vesper_DSP';
      triggers.files = ['vesper', 'crates/vesper-', 'vesper-apo'];
      triggers.keywords = ['vesper', 'dsp', '오디오', 'audio', 'mmcss', 'virtuallock', 'apo', 'eq', '사운드'];
      triggers.commands = ['check', 'build', 'test'];
    } else if (nameLower.includes('synapse') && !nameLower.includes('biophys')) {
      domain = 'Project_Synapse_Kit';
      triggers.files = ['synapse', 'synapse.config.ts'];
      triggers.keywords = ['synapse', 'synapse-kit', '시냅스', '인과율', 'causal', '컴파일러', '체커'];
      triggers.commands = ['check', 'build', 'package', 'sign', 'init', 'memory'];
    } else if (
      nameLower.includes('hardware') ||
      nameLower.includes('pcb') ||
      nameLower.includes('jlcpcb') ||
      nameLower.includes('m2_2230') ||
      nameLower.includes('pocket_orange') ||
      typeLower.includes('hardware')
    ) {
      domain = 'Hardware_And_PCB';
      triggers.files = ['hardware', 'pcb', 'kicad'];
      triggers.keywords = ['pcb', 'hardware', '하드웨어', '회로', 'jlcpcb', 'kicad', 'm2'];
    } else if (
      nameLower.includes('biophys') ||
      nameLower.includes('connectome') ||
      nameLower.includes('drosophila') ||
      nameLower.includes('cortex') ||
      typeLower.includes('whitepaper')
    ) {
      domain = 'BioPhys_Research_And_Architecture';
      triggers.files = ['biophys', 'whitepaper'];
      triggers.keywords = ['biophys', 'connectome', '시냅스신경망', '퀀타이제이션', '백서', '아키텍처'];
    } else {
      domain = 'Knowledge_Base';
      triggers.keywords = [ent.name.toLowerCase().replace(/_/g, ' ')];
    }

    for (const obs of ent.observations) {
      if (
        obs.includes('금지') ||
        obs.includes('절대') ||
        obs.includes('필수') ||
        obs.includes('주의') ||
        obs.includes('VirtualLock') ||
        obs.includes('MMCSS')
      ) {
        invariants.push(obs);
      } else if (/^\d+\.|단계|Step/i.test(obs)) {
        actions.push(obs);
      } else {
        context.push(obs);
      }
    }

    const baseSlug =
      ent.name
        .trim()
        .toLowerCase()
        .replace(/[^\w\uAC00-\uD7A30-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'item';

    return {
      id: `rule-${domain.toLowerCase()}-${baseSlug}`,
      domain,
      title: ent.name,
      entityType: ent.entityType,
      triggers,
      invariants,
      actions,
      context,
      lastVerified: today,
    };
  }

  /**
   * 메모리 무결성 감사 (Audit)
   */
  public audit(): {
    ok: boolean;
    totalRules: number;
    totalRelations: number;
    alwaysActiveCount: number;
    issues: string[];
  } {
    const issues: string[] = [];
    const seenIds = new Set<string>();
    let alwaysActiveCount = 0;

    for (const rule of this.database.rules) {
      if (rule.triggers.alwaysActive) {
        alwaysActiveCount++;
      }

      if (!rule.id || rule.id.trim().length === 0) {
        issues.push(`ID 누락 규칙 발견: ${rule.title}`);
      } else if (seenIds.has(rule.id)) {
        issues.push(`중복 ID 발견: ${rule.id}`);
      } else {
        seenIds.add(rule.id);
      }

      if (!rule.domain) {
        issues.push(`도메인 누락 규칙: ${rule.id}`);
      }
    }

    if (alwaysActiveCount > 10) {
      issues.push(
        `상시 활성(alwaysActive) 규칙 과다 (${alwaysActiveCount}개): 토큰 절감 효율이 저하될 수 있습니다.`
      );
    }

    return {
      ok: issues.length === 0,
      totalRules: this.database.rules.length,
      totalRelations: this.database.relations.length,
      alwaysActiveCount,
      issues,
    };
  }

  /**
   * 원시 데이터베이스 객체 반환 (백업 및 피어 동기화용)
   */
  public getRawDatabase(): CausalMemoryDatabase {
    this.reloadIfNeeded();
    return this.database;
  }

  /**
   * 원격 피어 데이터베이스와 로컬 데이터베이스 양방향 무손실 병합 (Sync)
   */
  public mergeDatabase(
    incomingRules: readonly CausalRule[],
    incomingRelations: readonly CausalRelation[] = []
  ): {
    addedRules: number;
    updatedRules: number;
    addedRelations: number;
    totalRules: number;
    totalRelations: number;
  } {
    this.reloadIfNeeded();
    let addedRules = 0;
    let updatedRules = 0;
    let addedRelations = 0;

    const ruleMap = new Map<string, CausalRule>();
    for (const r of this.database.rules) {
      ruleMap.set(r.id, r);
    }

    for (const incoming of incomingRules) {
      if (!incoming.id) continue;
      const existing = ruleMap.get(incoming.id);
      if (!existing) {
        ruleMap.set(incoming.id, incoming);
        addedRules++;
      } else {
        // 기존 규칙이 있을 경우 더 최신 검증일자이거나 항목이 많으면 갱신
        const existingDate = existing.lastVerified || '';
        const incomingDate = incoming.lastVerified || '';
        if (incomingDate >= existingDate) {
          ruleMap.set(incoming.id, incoming);
          updatedRules++;
        }
      }
    }

    // 간선 병합
    const relationKey = (rel: CausalRelation) =>
      `${rel.from.toLowerCase()}::${rel.relationType.toLowerCase()}::${rel.to.toLowerCase()}`;
    const relMap = new Map<string, CausalRelation>();
    for (const rel of this.database.relations) {
      relMap.set(relationKey(rel), rel);
    }

    for (const incomingRel of incomingRelations) {
      const key = relationKey(incomingRel);
      if (!relMap.has(key)) {
        relMap.set(key, incomingRel);
        addedRelations++;
      }
    }

    const mergedRules = Array.from(ruleMap.values());
    const mergedRelations = Array.from(relMap.values());

    this.database = {
      ...this.database,
      updatedAt: new Date().toISOString(),
      totalRules: mergedRules.length,
      totalRelations: mergedRelations.length,
      rules: mergedRules,
      relations: mergedRelations,
    };

    this.rebuildIndices();
    this.saveDatabase();

    return {
      addedRules,
      updatedRules,
      addedRelations,
      totalRules: mergedRules.length,
      totalRelations: mergedRelations.length,
    };
  }
}
