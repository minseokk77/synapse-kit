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
  readonly relation?: string;
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
  readonly name?: string;
  readonly confidence?: number;
  readonly weight?: number;
  readonly updatedAt?: string;
  readonly description?: string;
  readonly pattern?: string;
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
  private rawTitleSet: Set<string> = new Set();
  private readonly titleFirstByteMask = new Uint8Array(256);
  private relationAdjacency: Map<string, CausalRelation[]> = new Map();

  // 지연 색인(Lazy Dirty-Flag Indexing & Database Cracking) 및 Group Commit 상태 관리
  private databaseLoaded = false;
  private indicesDirty = false;
  private keywordIndexDirty = true;
  private titleMapDirty = true;
  private idMapDirty = true;
  private fileIndexDirty = true;
  private commandIndexDirty = true;
  private domainIndexDirty = true;
  private relationIndexDirty = true;
  private rulePositionDirty = true;
  private idToRuleIndex: Map<string, number> = new Map();
  private titleToRuleIndex: Map<string, number> = new Map();
  private mutableRulesOwned = false;
  private savePending = false;
  private saveScheduled = false;
  private lastSyncSaveMs = 0;
  private resonanceCache: Map<string, CausalResonanceResult> = new Map();
  private static resolvedDefaultDbPath: string | null = null;
  private static pendingStores: Set<CausalMemoryStore> = new Set();
  private static exitHookRegistered = false;
  private static cachedTickMs = 0;
  private static cachedIsoStr = '';
  private static cachedTodayStr = '';
  private static readonly cachedTimeObj = { nowMs: 0, nowIso: '', today: '' };
  private static readonly EMPTY_RELATIONS: CausalRelation[] = [];
  private static timestampCounter = 0;
  private static readonly entityMetaCache = new Map<
    string,
    { id: string; domain: string; triggers: CausalRule['triggers'] }
  >();

  private static getNowIso(): { nowMs: number; nowIso: string; today: string } {
    if ((CausalMemoryStore.timestampCounter++ & 1023) === 0 || CausalMemoryStore.cachedIsoStr === '') {
      const nowMs = Date.now();
      if (nowMs !== CausalMemoryStore.cachedTickMs || CausalMemoryStore.cachedIsoStr === '') {
        CausalMemoryStore.cachedTickMs = nowMs;
        CausalMemoryStore.cachedIsoStr = new Date(nowMs).toISOString();
        CausalMemoryStore.cachedTodayStr = CausalMemoryStore.cachedIsoStr.slice(0, 10);
        CausalMemoryStore.cachedTimeObj.nowMs = nowMs;
        CausalMemoryStore.cachedTimeObj.nowIso = CausalMemoryStore.cachedIsoStr;
        CausalMemoryStore.cachedTimeObj.today = CausalMemoryStore.cachedTodayStr;
      }
    }
    return CausalMemoryStore.cachedTimeObj;
  }

  constructor(customPath?: string, initialDatabase?: CausalMemoryDatabase) {
    CausalMemoryStore.flushAllPendingStores();
    this.dbPath =
      customPath ||
      (CausalMemoryStore.resolvedDefaultDbPath ??= existsSync(CAUSAL_MEMORY_CONFIG.GLOBAL_DB_PATH)
        ? CAUSAL_MEMORY_CONFIG.GLOBAL_DB_PATH
        : CAUSAL_MEMORY_CONFIG.LOCAL_DB_PATH);

    if (initialDatabase) {
      this.database = initialDatabase;
      this.databaseLoaded = true;
      this.markAllDirty();
    } else {
      this.database = {
        version: CAUSAL_MEMORY_CONFIG.SCHEMA_VERSION,
        updatedAt: CausalMemoryStore.getNowIso().nowIso,
        totalRules: 0,
        totalRelations: 0,
        rules: [],
        relations: [],
      };
      this.databaseLoaded = false;
      this.markAllDirty();
    }
  }

  private static ensureExitHook(): void {
    if (!CausalMemoryStore.exitHookRegistered) {
      CausalMemoryStore.exitHookRegistered = true;
      process.on('beforeExit', () => {
        CausalMemoryStore.flushAllPendingStores();
      });
    }
  }

  private static flushAllPendingStores(): void {
    if (CausalMemoryStore.pendingStores.size === 0) return;
    for (const store of Array.from(CausalMemoryStore.pendingStores)) {
      store.flushPendingSave();
    }
  }

  private ensureDatabaseLoaded(): void {
    if (this.databaseLoaded) return;
    this.database = this.loadDatabase();
    this.databaseLoaded = true;
    this.markAllDirty();
  }

  private invalidateQueryIndices(): void {
    if (
      this.indicesDirty &&
      this.keywordIndexDirty &&
      this.titleMapDirty &&
      this.fileIndexDirty &&
      this.commandIndexDirty &&
      this.domainIndexDirty &&
      this.relationIndexDirty &&
      this.idMapDirty &&
      this.resonanceCache.size === 0 &&
      this.rawTitleSet.size === 0 &&
      this.compiledSearchRules.length === 0
    ) {
      return;
    }
    this.indicesDirty = true;
    this.keywordIndexDirty = true;
    this.titleMapDirty = true;
    this.fileIndexDirty = true;
    this.commandIndexDirty = true;
    this.domainIndexDirty = true;
    this.relationIndexDirty = true;
    this.idMapDirty = true;
    if (this.compiledSearchRules.length > 0) {
      this.compiledSearchRules = [];
    }
    if (this.rawTitleSet.size > 0) {
      this.rawTitleSet.clear();
    }
    if (this.resonanceCache.size > 0) {
      this.resonanceCache.clear();
    }
  }

  private markAllDirty(): void {
    this.invalidateQueryIndices();
    this.rulePositionDirty = true;
  }

  /**
   * O(1) 규칙 배열 인덱스 위치 맵 지연 동기화
   */
  private ensureRulePositions(): void {
    this.ensureDatabaseLoaded();
    if (!this.rulePositionDirty) return;
    this.idToRuleIndex.clear();
    this.titleToRuleIndex.clear();
    const rules = this.database.rules;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.id) {
        this.idToRuleIndex.set(r.id, i);
      }
      const titleLower = (r.title || (r as any).name || r.id || '').toLowerCase();
      if (titleLower && !this.titleToRuleIndex.has(titleLower)) {
        this.titleToRuleIndex.set(titleLower, i);
      }
    }
    this.rulePositionDirty = false;
  }

  /**
   * 지연 역인덱스 및 대기 중인 Group Commit 저장 일괄 동기화
   */
  private ensureIndices(): void {
    this.ensureDatabaseLoaded();
    if (this.savePending) {
      this.flushPendingSave();
    }
    this.ensureKeywordIndex();
    this.ensureDomainIndex();
    this.ensureCommandIndex();
    this.ensureFileIndex();
    this.ensureRelationIndex();
    this.ensureRulePositions();
    this.indicesDirty = false;
  }

  /**
   * 디스크 파일 변경(mtimeMs)이 감지된 경우에만 스마트 리로드 수행 (Zero-Copy Cache)
   */
  public reloadIfNeeded(): boolean {
    CausalMemoryStore.flushAllPendingStores();
    if (!this.databaseLoaded) {
      this.ensureDatabaseLoaded();
    }
    try {
      if (!existsSync(this.dbPath)) return false;
      const stat = statSync(this.dbPath);
      if (stat.mtimeMs > this.lastMtimeMs) {
        this.database = this.loadDatabase();
        this.databaseLoaded = true;
        this.mutableRulesOwned = true;
        this.markAllDirty();
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
    CausalMemoryStore.flushAllPendingStores();
    this.database = this.loadDatabase();
    this.databaseLoaded = true;
    this.mutableRulesOwned = true;
    this.markAllDirty();
  }

  /**
   * 인메모리 데이터베이스 직접 주입 (벤치마크 및 인메모리 시뮬레이션용)
   */
  public loadFromMemory(db: CausalMemoryDatabase): void {
    this.database = db;
    this.databaseLoaded = true;
    this.mutableRulesOwned = false;
    this.markAllDirty();
  }

  private addTokenToKeywordIndex(token: string, rule: CausalRule): void {
    if (!token) return;
    let list = this.exactKeywordIndex.get(token);
    if (!list) {
      list = [];
      this.exactKeywordIndex.set(token, list);
    }
    if (list[list.length - 1] !== rule) {
      list.push(rule);
    }
  }

  private addSubTokensToKeywordIndex(text: string, rule: CausalRule): void {
    const len = text.length;
    if (len === 0) return;
    let start = -1;
    for (let i = 0; i <= len; i++) {
      const code = i < len ? text.charCodeAt(i) : 32;
      const isSep = code === 32 || code === 95 || code === 45 || (code >= 9 && code <= 13);
      if (isSep) {
        if (start !== -1) {
          if (!(start === 0 && i === len)) {
            this.addTokenToKeywordIndex(text.slice(start, i), rule);
          }
          start = -1;
        }
      } else if (start === -1) {
        start = i;
      }
    }
  }

  /**
   * Columnar Cracking 1: 키워드/상시활성 역인덱스 & 1-Byte 제목 프리필터 지연 구축
   */
  private ensureKeywordIndex(): void {
    if (!this.keywordIndexDirty) return;
    this.alwaysActiveRules = [];
    this.exactKeywordIndex.clear();
    this.titleFirstByteMask.fill(0);

    const rules = this.database.rules;
    const isSmallDb = rules.length <= 500;

    if (isSmallDb) {
      this.titleToRuleMap.clear();
      this.rawTitleSet.clear();

      for (let idx = 0; idx < rules.length; idx++) {
        const rule = rules[idx];
        const domainLower = (rule.domain || 'general').toLowerCase();
        const rawTitle = rule.title || (rule as any).name || rule.id || '';
        const titleLower = rawTitle.toLowerCase();

        this.titleToRuleMap.set(titleLower, rule);
        this.rawTitleSet.add(rawTitle);
        if (titleLower !== rawTitle) {
          this.rawTitleSet.add(titleLower);
        }
        if (rawTitle.length > 0) {
          const c0 = rawTitle.charCodeAt(0);
          if (c0 < 128) {
            this.titleFirstByteMask[c0] = 1;
            if (c0 >= 65 && c0 <= 90) this.titleFirstByteMask[c0 + 32] = 1;
            else if (c0 >= 97 && c0 <= 122) this.titleFirstByteMask[c0 - 32] = 1;
          } else {
            this.titleFirstByteMask[c0 & 0xff] = 1;
            if (c0 < 0x1000) {
              this.titleFirstByteMask[titleLower.charCodeAt(0) & 0xff] = 1;
            }
          }
        } else {
          this.titleFirstByteMask[0] = 1;
        }

        if (rule.triggers.alwaysActive) {
          this.alwaysActiveRules.push(rule);
        }

        this.addTokenToKeywordIndex(titleLower, rule);
        this.addTokenToKeywordIndex(domainLower, rule);
        this.addSubTokensToKeywordIndex(titleLower, rule);

        const kws = rule.triggers.keywords;
        if (kws) {
          for (let k = 0; k < kws.length; k++) {
            const kwLower = kws[k].toLowerCase();
            this.addTokenToKeywordIndex(kwLower, rule);
            this.addSubTokensToKeywordIndex(kwLower, rule);
          }
        }
      }
      this.titleMapDirty = false;
    } else {
      for (let idx = 0; idx < rules.length; idx++) {
        const rule = rules[idx];
        const rawTitle = rule.title || (rule as any).name || rule.id || '';
        if (rawTitle.length > 0) {
          const c0 = rawTitle.charCodeAt(0);
          if (c0 < 128) {
            this.titleFirstByteMask[c0] = 1;
            if (c0 >= 65 && c0 <= 90) this.titleFirstByteMask[c0 + 32] = 1;
            else if (c0 >= 97 && c0 <= 122) this.titleFirstByteMask[c0 - 32] = 1;
          } else {
            this.titleFirstByteMask[c0 & 0xff] = 1;
            if (c0 < 0x1000) {
              this.titleFirstByteMask[rawTitle[0].toLowerCase().charCodeAt(0) & 0xff] = 1;
            }
          }
        } else {
          this.titleFirstByteMask[0] = 1;
        }

        if (rule.triggers.alwaysActive) {
          this.alwaysActiveRules.push(rule);
        }

        const kws = rule.triggers.keywords;
        if (kws) {
          for (let k = 0; k < kws.length; k++) {
            this.addTokenToKeywordIndex(kws[k].toLowerCase(), rule);
          }
        }
      }
    }

    this.keywordIndexDirty = false;
  }

  /**
   * Deferred Title Cracking: 제목 역인덱스 지연 구축
   */
  private ensureTitleMap(): void {
    if (!this.titleMapDirty) return;
    this.titleToRuleMap.clear();
    this.rawTitleSet.clear();
    const rules = this.database.rules;
    for (let idx = 0; idx < rules.length; idx++) {
      const rule = rules[idx];
      const rawTitle = rule.title || (rule as any).name || rule.id || '';
      const titleLower = rawTitle.toLowerCase();
      this.titleToRuleMap.set(titleLower, rule);
      this.rawTitleSet.add(rawTitle);
      if (titleLower !== rawTitle) {
        this.rawTitleSet.add(titleLower);
      }
    }
    this.titleMapDirty = false;
  }

  /**
   * ID 역인덱스 지연 구축 (ID 기반 조회 시에만 활성화)
   */
  private ensureIdMap(): void {
    if (!this.idMapDirty) return;
    this.idToRuleMap.clear();
    const rules = this.database.rules;
    for (let idx = 0; idx < rules.length; idx++) {
      const rule = rules[idx];
      const idLower = (rule.id || '').toLowerCase();
      this.idToRuleMap.set(idLower, rule);
    }
    this.idMapDirty = false;
  }

  /**
   * Columnar Cracking 2: 도메인 역인덱스 지연 구축
   */
  private ensureDomainIndex(): void {
    if (!this.domainIndexDirty) return;
    this.domainIndex.clear();
    const rules = this.database.rules;
    for (let idx = 0; idx < rules.length; idx++) {
      const rule = rules[idx];
      const domainLower = (rule.domain || 'general').toLowerCase();
      let domList = this.domainIndex.get(domainLower);
      if (!domList) {
        domList = [];
        this.domainIndex.set(domainLower, domList);
      }
      domList.push(rule);
    }
    this.domainIndexDirty = false;
  }

  /**
   * Columnar Cracking 3: 명령어 역인덱스 지연 구축
   */
  private ensureCommandIndex(): void {
    if (!this.commandIndexDirty) return;
    this.commandIndex.clear();
    const rules = this.database.rules;
    for (let idx = 0; idx < rules.length; idx++) {
      const rule = rules[idx];
      const cmds = rule.triggers.commands;
      if (cmds) {
        for (let c = 0; c < cmds.length; c++) {
          const cmdLower = cmds[c].toLowerCase();
          let cmdList = this.commandIndex.get(cmdLower);
          if (!cmdList) {
            cmdList = [];
            this.commandIndex.set(cmdLower, cmdList);
          }
          cmdList.push(rule);
        }
      }
    }
    this.commandIndexDirty = false;
  }

  /**
   * Columnar Cracking 4: 파일 경로 해시 역인덱스 지연 구축
   */
  private ensureFileIndex(): void {
    if (!this.fileIndexDirty) return;
    this.exactFileIndex.clear();
    this.prefixFileRules = [];
    const rules = this.database.rules;

    for (let idx = 0; idx < rules.length; idx++) {
      const rule = rules[idx];
      const files = rule.triggers.files;
      if (files && files.length > 0) {
        const domainLower = (rule.domain || 'general').toLowerCase();
        const prefixPatterns: string[] = [];
        for (let f = 0; f < files.length; f++) {
          const pattern = files[f];
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

          if (cleaned.endsWith('-') || cleaned.endsWith('_') || cleaned.includes(':')) {
            prefixPatterns.push(cleaned);
          }
        }
        if (prefixPatterns.length > 0) {
          this.prefixFileRules.push({ rule, domainLower, cleanPatterns: prefixPatterns });
        }
      }
    }

    this.fileIndexDirty = false;
  }

  /**
   * Columnar Cracking 5: 양방향 인과 간선 인접 리스트 지연 구축 (1-Byte Prefilter + Deferred Title Check)
   */
  private ensureRelationIndex(): void {
    if (!this.relationIndexDirty) return;
    this.ensureKeywordIndex();
    this.relationAdjacency.clear();
    const relations = this.database.relations;
    const len = relations.length;
    const hasRules = this.database.rules.length > 0;
    const mask = this.titleFirstByteMask;

    for (let i = 0; i < len; i++) {
      const rel = relations[i];
      let allowFrom = true;
      let allowTo = true;

      if (hasRules) {
        const cFrom = rel.from.length > 0 ? rel.from.charCodeAt(0) & 0xff : 0;
        const cTo = rel.to.length > 0 ? rel.to.charCodeAt(0) & 0xff : 0;
        allowFrom = mask[cFrom] !== 0;
        allowTo = mask[cTo] !== 0;
        if (!allowFrom && !allowTo) continue;
        if (this.titleMapDirty) {
          this.ensureTitleMap();
        }
      }

      const hasRawTitles = this.rawTitleSet.size > 0;
      let fromLower = '';
      const fromHit =
        allowFrom &&
        (!hasRawTitles ||
          this.rawTitleSet.has(rel.from) ||
          this.titleToRuleMap.has((fromLower = rel.from.toLowerCase())));

      if (fromHit) {
        if (!fromLower) fromLower = rel.from.toLowerCase();
        let fromAdj = this.relationAdjacency.get(fromLower);
        if (!fromAdj) {
          fromAdj = [];
          this.relationAdjacency.set(fromLower, fromAdj);
        }
        fromAdj.push(rel);
      }

      let toLower = '';
      const toHit =
        allowTo &&
        (!hasRawTitles ||
          this.rawTitleSet.has(rel.to) ||
          this.titleToRuleMap.has((toLower = rel.to.toLowerCase())));

      if (toHit) {
        if (!toLower) toLower = rel.to.toLowerCase();
        if (!fromHit || toLower !== fromLower) {
          let toAdj = this.relationAdjacency.get(toLower);
          if (!toAdj) {
            toAdj = [];
            this.relationAdjacency.set(toLower, toAdj);
          }
          toAdj.push(rel);
        }
      }
    }

    this.relationIndexDirty = false;
  }

  /**
   * O(1) 역인덱스(Inverted Index) 및 인접 리스트 그래프(Adjacency List) 일괄 재구축 (호환용)
   */
  private rebuildIndices(): void {
    this.invalidateQueryIndices();
    this.rulePositionDirty = true;
    this.ensureIndices();
  }

  /**
   * 동일 제목(title) 규칙 중복 시 도메인 우선순위 점수 산출
   */
  private static getRuleDomainPriority(rule: CausalRule): number {
    const titleLower = (rule.title || rule.id || '').toLowerCase();
    const dom = rule.domain || '';
    if (titleLower.includes('biophys') && dom === 'User_Preferences_And_Rules') {
      return 0; // 오분류된 BioPhys 상시 활성 규칙은 최저 우선순위
    }
    if (dom === 'Knowledge_Base') {
      return 1; // 일반 지식베이스보다 특화 도메인 우선
    }
    return 2;
  }

  /**
   * 규칙 배열에서 동일 제목(title) 중복 제거 및 정규화
   */
  private static deduplicateRulesByTitle(rules: readonly CausalRule[]): CausalRule[] {
    const byTitle = new Map<string, CausalRule>();
    for (const rule of rules) {
      if (!rule.title) continue;
      const key = rule.title.toLowerCase();
      const existing = byTitle.get(key);
      if (!existing) {
        byTitle.set(key, rule);
      } else {
        const existingPrio = CausalMemoryStore.getRuleDomainPriority(existing);
        const incomingPrio = CausalMemoryStore.getRuleDomainPriority(rule);
        if (incomingPrio > existingPrio) {
          byTitle.set(key, rule);
        } else if (incomingPrio === existingPrio) {
          const existingDate = existing.lastVerified || '';
          const incomingDate = rule.lastVerified || '';
          if (incomingDate >= existingDate) {
            byTitle.set(key, rule);
          }
        }
      }
    }
    return Array.from(byTitle.values());
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
        const rawRules: CausalRule[] = Array.isArray(parsed.rules) ? parsed.rules : [];
        const rules = CausalMemoryStore.deduplicateRulesByTitle(rawRules);
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
   * 대기 중인 Group Commit 디스크 저장을 즉시 플러시
   */
  public flushPendingSave(): void {
    if (!this.savePending || this.dbPath === ':memory:') {
      this.savePending = false;
      CausalMemoryStore.pendingStores.delete(this);
      return;
    }
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
      this.savePending = false;
      CausalMemoryStore.pendingStores.delete(this);
      this.lastSyncSaveMs = performance.now();
    } catch (error) {
      this.savePending = false;
      CausalMemoryStore.pendingStores.delete(this);
      throw new Error(
        `인과율 메모리 디스크 저장 실패: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 데이터베이스 디스크 동기화 (연속 대량 쓰기 시 Adaptive Group Commit 적용)
   */
  private saveDatabase(): void {
    if (this.dbPath === ':memory:') {
      return;
    }
    const now = performance.now();
    this.savePending = true;

    if (this.database.rules.length <= 20 || now - this.lastSyncSaveMs > 2) {
      this.flushPendingSave();
      return;
    }

    CausalMemoryStore.ensureExitHook();
    CausalMemoryStore.pendingStores.add(this);
    if (!this.saveScheduled) {
      this.saveScheduled = true;
      queueMicrotask(() => {
        this.saveScheduled = false;
        this.flushPendingSave();
      });
    }
  }

  public getAllRules(): readonly CausalRule[] {
    this.ensureDatabaseLoaded();
    return this.database.rules;
  }

  public getAllRelations(): readonly CausalRelation[] {
    this.ensureDatabaseLoaded();
    return this.database.relations;
  }

  public getStatus() {
    this.ensureDatabaseLoaded();
    if (this.savePending) {
      this.flushPendingSave();
    }
    this.ensureDomainIndex();
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
    this.ensureDatabaseLoaded();
    if (this.compiledSearchRules.length === 0 && this.database.rules.length > 0) {
      for (const rule of this.database.rules) {
        const domainLower = (rule.domain || 'general').toLowerCase();
        const searchableText = [
          rule.title || '',
          rule.domain || '',
          ...(rule.triggers?.keywords || []),
          ...(rule.invariants || []),
          ...(rule.actions || []),
          ...(rule.context || []),
        ]
          .join(' ')
          .toLowerCase();
        this.compiledSearchRules.push({ rule, domainLower, searchableText });
      }
    }
    return this.compiledSearchRules;
  }

  /**
   * 쿼리 키워드 정규화 헬퍼 (공백 없는 단일 토큰 Fast-Path)
   */
  private static normalizeQueryKeywords(rawKeywords?: readonly string[]): string[] {
    if (!rawKeywords || rawKeywords.length === 0) return [];
    const out: string[] = [];
    for (let i = 0; i < rawKeywords.length; i++) {
      const k = rawKeywords[i];
      if (!k) continue;
      if (!k.includes(' ') && !k.includes('\t') && !k.includes('\n')) {
        out.push(k.toLowerCase());
      } else {
        const parts = k.toLowerCase().split(/\s+/);
        for (let p = 0; p < parts.length; p++) {
          if (parts[p].length > 0) out.push(parts[p]);
        }
      }
    }
    return out;
  }

  /**
   * 초고속 O(1) 역인덱스 및 다중 홉(Multi-Hop) 그래프 전파 공명 쿼리 엔진
   */
  public queryResonance(options: CausalQueryOptions): CausalResonanceResult {
    this.ensureDatabaseLoaded();
    if (this.savePending) {
      this.flushPendingSave();
    }

    const rules = this.database.rules;
    const relations = this.database.relations;

    // 0-A-초고속: 단일 규칙 + 간선 부재 + 제목/항상활성 일치 (performance.now() 호출 생략)
    if (
      rules.length === 1 &&
      relations.length === 0 &&
      (!options.files || options.files.length === 0) &&
      !options.command &&
      !options.domain &&
      options.keywords &&
      options.keywords.length === 1
    ) {
      const r0 = rules[0];
      const kw0 = options.keywords[0];
      if (r0.triggers.alwaysActive || r0.title === kw0 || r0.id === kw0) {
        return {
          queryDurationMs: 0,
          matchedCount: 1,
          totalDatabaseRules: 1,
          resonanceRules: [r0],
          activeRelations: CausalMemoryStore.EMPTY_RELATIONS,
          tokenDietSavingsRatio: '0.0%',
        };
      }
    }

    const startTime = performance.now();
    const propagate = options.propagateRelations ?? true;
    const maxHops = options.maxHops ?? 1;

    // 0-A. 극소규모 DB(<= 8 규칙, 간선 없음) 직접 선형 스캔 Fast-Path (해시맵 재구축 오버헤드 제거)
    if (
      rules.length <= 8 &&
      relations.length === 0 &&
      (!options.files || options.files.length === 0) &&
      !options.command &&
      !options.domain
    ) {

      const qKeywords = CausalMemoryStore.normalizeQueryKeywords(options.keywords);
      const matchedRules: CausalRule[] = [];

      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if (rule.triggers.alwaysActive) {
          matchedRules.push(rule);
          continue;
        }
        if (qKeywords.length === 0) continue;

        const titleLower = (rule.title || (rule as any).name || rule.id || '').toLowerCase();
        const domainLower = (rule.domain || 'general').toLowerCase();
        const trigKws = rule.triggers.keywords;
        let hit = false;

        for (let k = 0; k < qKeywords.length && !hit; k++) {
          const qk = qKeywords[k];
          if (titleLower.includes(qk) || domainLower.includes(qk)) {
            hit = true;
            break;
          }
          if (trigKws) {
            for (let t = 0; t < trigKws.length; t++) {
              if (trigKws[t].toLowerCase().includes(qk)) {
                hit = true;
                break;
              }
            }
          }
          if (!hit) {
            const inv = rule.invariants;
            for (let m = 0; m < inv.length; m++) {
              if (inv[m].toLowerCase().includes(qk)) {
                hit = true;
                break;
              }
            }
          }
          if (!hit) {
            const act = rule.actions;
            for (let m = 0; m < act.length; m++) {
              if (act[m].toLowerCase().includes(qk)) {
                hit = true;
                break;
              }
            }
          }
          if (!hit) {
            const ctx = rule.context;
            for (let m = 0; m < ctx.length; m++) {
              if (ctx[m].toLowerCase().includes(qk)) {
                hit = true;
                break;
              }
            }
          }
        }

        if (hit) {
          matchedRules.push(rule);
        }
      }

      const duration = performance.now() - startTime;
      const totalCount = rules.length;
      const savings =
        totalCount > 0
          ? (((totalCount - matchedRules.length) / totalCount) * 100).toFixed(1) + '%'
          : '0.0%';

      return {
        queryDurationMs: Math.round(duration * 100) / 100,
        matchedCount: matchedRules.length,
        totalDatabaseRules: totalCount,
        resonanceRules: matchedRules,
        activeRelations: [],
        tokenDietSavingsRatio: savings,
      };
    }

    // 0-B. 세대 기반 공명 쿼리 캐시 (Generation-Invalidated Result Cache)
    const useCache = !options.files || options.files.length <= 4;
    let cacheKey = '';
    if (useCache) {
      cacheKey = `${options.domain || ''}\0${options.command || ''}\0${
        options.keywords ? options.keywords.join('\x01') : ''
      }\0${options.files ? options.files.join('\x01') : ''}\0${propagate ? '1' : '0'}\0${maxHops}`;
      const cached = this.resonanceCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // 0-C. Database Cracking — 필요한 컬럼 인덱스만 선택적 지연 구축
    this.ensureKeywordIndex();
    const rawDomain = options.domain;
    const targetDomain = rawDomain ? rawDomain.toLowerCase() : undefined;
    const queryCommand = options.command ? options.command.toLowerCase() : undefined;
    if (queryCommand) {
      this.ensureCommandIndex();
    }
    const hasInputFiles = Boolean(options.files && options.files.length > 0);
    if (hasInputFiles) {
      this.ensureFileIndex();
    }
    const queryKeywords = CausalMemoryStore.normalizeQueryKeywords(options.keywords);

    // 0-D. 단일 키워드 Zero-Map Fast-Path (간선 부재 또는 무효 간선 전용)
    if (
      !queryCommand &&
      !hasInputFiles &&
      this.alwaysActiveRules.length === 0 &&
      queryKeywords.length === 1
    ) {
      const exactHits = this.exactKeywordIndex.get(queryKeywords[0]);
      if (
        exactHits &&
        exactHits.length > 0 &&
        (relations.length === 0 || (this.ensureRelationIndex(), this.relationAdjacency.size === 0))
      ) {
        let matchedRules: CausalRule[];
        if (!targetDomain) {
          matchedRules = exactHits;
        } else {
          matchedRules = [];
          for (let h = 0; h < exactHits.length; h++) {
            const r = exactHits[h];
            if (r.domain === targetDomain || r.domain === rawDomain || (r.domain || '').toLowerCase() === targetDomain) {
              matchedRules.push(r);
            }
          }
        }
        const duration = performance.now() - startTime;
        const totalCount = rules.length;
        const savings =
          totalCount > 0
            ? (((totalCount - matchedRules.length) / totalCount) * 100).toFixed(1) + '%'
            : '0.0%';
        const fastResult: CausalResonanceResult = {
          queryDurationMs: Math.round(duration * 100) / 100,
          matchedCount: matchedRules.length,
          totalDatabaseRules: totalCount,
          resonanceRules: matchedRules,
          activeRelations: [],
          tokenDietSavingsRatio: savings,
        };
        if (useCache) {
          if (this.resonanceCache.size >= 4096) {
            this.resonanceCache.clear();
          }
          this.resonanceCache.set(cacheKey, fastResult);
        }
        return fastResult;
      }
    }

    const matchedRulesMap = new Map<string, CausalRule>();
    const nonAlwaysMatchedTitles = new Set<string>();

    // 1. 상시 활성(alwaysActive) 규칙 즉시 O(1) 등록
    for (let i = 0; i < this.alwaysActiveRules.length; i++) {
      const rule = this.alwaysActiveRules[i];
      if (targetDomain && (rule.domain || '').toLowerCase() !== targetDomain) continue;
      matchedRulesMap.set(rule.id, rule);
    }

    // 2. 명령어(command) 역인덱스 O(1) 조회
    if (queryCommand) {
      const cmdRules = this.commandIndex.get(queryCommand);
      if (cmdRules) {
        for (let i = 0; i < cmdRules.length; i++) {
          const rule = cmdRules[i];
          if (targetDomain && (rule.domain || '').toLowerCase() !== targetDomain) continue;
          matchedRulesMap.set(rule.id, rule);
          nonAlwaysMatchedTitles.add((rule.title || rule.id || '').toLowerCase());
        }
      }
    }

    // 3. 파일 경로 매칭 (Zero-Set Single-Pass Direct Hash Probe + Directory Locality Cache)
    if (hasInputFiles && options.files && this.exactFileIndex.size > 0) {
      const hasPrefixRules = this.prefixFileRules.length > 0;
      const checkedDirs = new Set<string>();

      const registerHits = (hits: CausalRule[] | undefined) => {
        if (!hits) return;
        for (let i = 0; i < hits.length; i++) {
          const rule = hits[i];
          if (targetDomain && (rule.domain || '').toLowerCase() !== targetDomain) continue;
          matchedRulesMap.set(rule.id, rule);
          nonAlwaysMatchedTitles.add((rule.title || rule.id || '').toLowerCase());
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
              const isDriveLetter = oneSeg.length === 2 && oneSeg.endsWith(':');
              if (!isDriveLetter && oneSeg !== twoSeg && !checkedDirs.has(oneSeg)) {
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
            if (
              prefixArr.some(
                (p) => p.includes(pattern) || (p.length >= 4 && pattern.includes(p))
              )
            ) {
              matchedRulesMap.set(entry.rule.id, entry.rule);
              nonAlwaysMatchedTitles.add(entry.rule.title.toLowerCase());
              break;
            }
          }
        }
      }
    }

    // 4. 키워드 매칭 (역인덱스 1차 O(1) 해시 룩업 + 지연 제목/도메인 2차 조회 + 서브스트링 폴백)
    if (queryKeywords.length > 0) {
      const unindexedKeywords: string[] = [];
      const isLargeDb = rules.length > 500;

      for (let k = 0; k < queryKeywords.length; k++) {
        const qk = queryKeywords[k];
        const exactHits = this.exactKeywordIndex.get(qk);
        if (exactHits && exactHits.length > 0) {
          for (let h = 0; h < exactHits.length; h++) {
            const rule = exactHits[h];
            if (targetDomain && (rule.domain || '').toLowerCase() !== targetDomain) continue;
            matchedRulesMap.set(rule.id, rule);
            nonAlwaysMatchedTitles.add((rule.title || rule.id || '').toLowerCase());
          }
        } else {
          let hitLargeIndex = false;
          if (isLargeDb) {
            this.ensureTitleMap();
            this.ensureDomainIndex();
            const titleHit = this.titleToRuleMap.get(qk);
            if (titleHit && (!targetDomain || (titleHit.domain || '').toLowerCase() === targetDomain)) {
              matchedRulesMap.set(titleHit.id, titleHit);
              nonAlwaysMatchedTitles.add((titleHit.title || titleHit.id || '').toLowerCase());
              hitLargeIndex = true;
            }
            const domHits = this.domainIndex.get(qk);
            if (domHits && domHits.length > 0) {
              for (let d = 0; d < domHits.length; d++) {
                const rule = domHits[d];
                if (targetDomain && (rule.domain || '').toLowerCase() !== targetDomain) continue;
                matchedRulesMap.set(rule.id, rule);
                nonAlwaysMatchedTitles.add((rule.title || rule.id || '').toLowerCase());
              }
              hitLargeIndex = true;
            }
          }
          if (!hitLargeIndex) {
            unindexedKeywords.push(qk);
          }
        }
      }

      // 역인덱스에 없는 부분 문자열 키워드가 있을 때만 지연 컴파일된 폴백 스캔 수행
      if (unindexedKeywords.length > 0) {
        const searchPool = this.getCompiledSearchRules();
        for (let i = 0; i < searchPool.length; i++) {
          const entry = searchPool[i];
          if (targetDomain && entry.domainLower !== targetDomain) continue;
          if (matchedRulesMap.has(entry.rule.id)) continue;

          for (let u = 0; u < unindexedKeywords.length; u++) {
            if (entry.searchableText.includes(unindexedKeywords[u])) {
              matchedRulesMap.set(entry.rule.id, entry.rule);
              nonAlwaysMatchedTitles.add((entry.rule.title || entry.rule.id || '').toLowerCase());
              break;
            }
          }
        }
      }
    }

    // 5. 인접 리스트(Adjacency List) 기반 다중 홉(Multi-Hop) 인과 파동 전파 (지연 간선 인덱스 구축)
    let activeRelations: CausalRelation[] = [];
    if (relations.length > 0 && matchedRulesMap.size > 0) {
      const activeRelationsSet = new Set<CausalRelation>();
      const visitedTitles = new Set<string>();
      for (const r of matchedRulesMap.values()) {
        visitedTitles.add((r.title || r.id || '').toLowerCase());
      }

      let currentFrontier =
        nonAlwaysMatchedTitles.size > 0 ? nonAlwaysMatchedTitles : visitedTitles;

      if (currentFrontier.size > 0) {
        this.ensureRelationIndex();
        const effectiveHops = propagate ? Math.max(1, maxHops) : 1;

        for (let hop = 0; hop < effectiveHops; hop++) {
          const nextFrontier = new Set<string>();

          for (const titleLower of currentFrontier) {
            const adjRelations = this.relationAdjacency.get(titleLower);
            if (!adjRelations) continue;

            for (let rIdx = 0; rIdx < adjRelations.length; rIdx++) {
              const rel = adjRelations[rIdx];
              activeRelationsSet.add(rel);

              if (propagate && nonAlwaysMatchedTitles.size > 0) {
                const neighborLower =
                  rel.from.toLowerCase() === titleLower
                    ? rel.to.toLowerCase()
                    : rel.from.toLowerCase();

                if (!visitedTitles.has(neighborLower)) {
                  visitedTitles.add(neighborLower);
                  nextFrontier.add(neighborLower);

                  if (this.titleMapDirty) {
                    this.ensureTitleMap();
                  }
                  const neighborRule = this.titleToRuleMap.get(neighborLower);
                  if (
                    neighborRule &&
                    (!targetDomain || (neighborRule.domain || '').toLowerCase() === targetDomain)
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
      }

      if (activeRelationsSet.size > 0) {
        activeRelations = Array.from(activeRelationsSet);
      }
    }

    const matchedRules = Array.from(matchedRulesMap.values());
    const duration = performance.now() - startTime;
    const totalCount = rules.length;
    const savings =
      totalCount > 0
        ? (((totalCount - matchedRules.length) / totalCount) * 100).toFixed(1) + '%'
        : '0.0%';

    const result: CausalResonanceResult = {
      queryDurationMs: Math.round(duration * 100) / 100,
      matchedCount: matchedRules.length,
      totalDatabaseRules: totalCount,
      resonanceRules: matchedRules,
      activeRelations,
      tokenDietSavingsRatio: savings,
    };

    if (useCache) {
      if (this.resonanceCache.size >= 4096) {
        this.resonanceCache.clear();
      }
      this.resonanceCache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * 신규 규칙 등록 또는 기존 규칙 갱신
   */
  public assertRule(rawRule: CausalRule | any, persistToDisk: boolean = true): void {
    this.ensureDatabaseLoaded();
    this.ensureRulePositions();

    const { nowMs, nowIso, today } = CausalMemoryStore.getNowIso();

    const sanitizedRule: CausalRule = {
      id: rawRule.id || `rule_${nowMs}`,
      domain: rawRule.domain || 'general',
      title: rawRule.title || rawRule.name || rawRule.id || 'Untitled Rule',
      triggers: rawRule.triggers || {},
      invariants: Array.isArray(rawRule.invariants) ? rawRule.invariants : [],
      actions: Array.isArray(rawRule.actions) ? rawRule.actions : [],
      context: Array.isArray(rawRule.context) ? rawRule.context : [],
      ...rawRule,
    };

    const targetTitle = (sanitizedRule.title || sanitizedRule.id).toLowerCase();
    let existingIndex = this.idToRuleIndex.get(sanitizedRule.id) ?? -1;
    if (existingIndex < 0 && targetTitle.length > 0) {
      existingIndex = this.titleToRuleIndex.get(targetTitle) ?? -1;
    }

    let mutableRules: CausalRule[];
    if (this.mutableRulesOwned) {
      mutableRules = this.database.rules as CausalRule[];
    } else {
      mutableRules = [...this.database.rules];
      this.mutableRulesOwned = true;
    }

    if (existingIndex >= 0) {
      const prevRule = mutableRules[existingIndex];
      const finalRule: CausalRule = {
        ...prevRule,
        ...sanitizedRule,
        id: sanitizedRule.id || prevRule.id,
        lastVerified: today,
      };
      mutableRules[existingIndex] = finalRule;
      if (prevRule.id !== finalRule.id) {
        this.idToRuleIndex.delete(prevRule.id);
        this.idToRuleIndex.set(finalRule.id, existingIndex);
      }
      const prevTitle = (prevRule.title || (prevRule as any).name || prevRule.id || '').toLowerCase();
      if (prevTitle !== targetTitle) {
        if (prevTitle) this.titleToRuleIndex.delete(prevTitle);
        if (targetTitle) this.titleToRuleIndex.set(targetTitle, existingIndex);
      }
    } else {
      const finalRule: CausalRule = {
        ...sanitizedRule,
        lastVerified: today,
      };
      const newIndex = mutableRules.length;
      mutableRules.push(finalRule);
      if (finalRule.id) {
        this.idToRuleIndex.set(finalRule.id, newIndex);
      }
      if (targetTitle) {
        this.titleToRuleIndex.set(targetTitle, newIndex);
      }
    }

    this.database = {
      ...this.database,
      updatedAt: nowIso,
      totalRules: mutableRules.length,
      rules: mutableRules,
    };

    this.invalidateQueryIndices();
    if (persistToDisk) {
      this.saveDatabase();
    }
  }

  /**
   * 단일 인과율 간선(Relation) 추가 또는 갱신
   */
  public assertRelation(relation: CausalRelation, persistToDisk: boolean = true): void {
    this.createRelations([relation], persistToDisk);
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
    this.ensureDatabaseLoaded();
    if (this.savePending) {
      this.flushPendingSave();
    }
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
    if (matchedTitles.size > 0 && this.database.relations.length > 0) {
      this.ensureRelationIndex();
      for (const titleLower of matchedTitles) {
        const adj = this.relationAdjacency.get(titleLower);
        if (adj) {
          for (const r of adj) relationsSet.add(r);
        }
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
    this.ensureDatabaseLoaded();
    if (this.savePending) {
      this.flushPendingSave();
    }
    this.ensureTitleMap();
    const matchedRules: CausalRule[] = [];
    const matchedTitles = new Set<string>();

    for (const name of names) {
      const lower = name.toLowerCase();
      let rule = this.titleToRuleMap.get(lower);
      if (!rule) {
        this.ensureIdMap();
        rule = this.idToRuleMap.get(lower);
      }
      if (rule && !matchedTitles.has(rule.title.toLowerCase())) {
        matchedRules.push(rule);
        matchedTitles.add(rule.title.toLowerCase());
      }
    }

    const relationsSet = new Set<CausalRelation>();
    if (matchedTitles.size > 0 && this.database.relations.length > 0) {
      this.ensureRelationIndex();
      for (const titleLower of matchedTitles) {
        const adj = this.relationAdjacency.get(titleLower);
        if (adj) {
          for (const r of adj) relationsSet.add(r);
        }
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
    this.ensureDatabaseLoaded();
    const created: LegacyEntityInput[] = [];
    const { nowIso, today } = CausalMemoryStore.getNowIso();

    const wasOwned = this.mutableRulesOwned;
    let mutableRules: CausalRule[];
    if (wasOwned) {
      mutableRules = this.database.rules as CausalRule[];
    } else {
      mutableRules = [...this.database.rules];
      this.mutableRulesOwned = true;
    }

    if (mutableRules.length === 0 && entities.length === 1) {
      const ent = entities[0];
      const inferred = CausalMemoryStore.inferRuleFromEntity(ent, today);
      mutableRules.push(inferred);
      this.rulePositionDirty = true;
      created.push(ent);
    } else {
      this.ensureRulePositions();
      for (let i = 0; i < entities.length; i++) {
        const ent = entities[i];
        const titleLower = ent.name.toLowerCase();
        if (this.titleToRuleIndex.has(titleLower)) continue;

        const inferred = CausalMemoryStore.inferRuleFromEntity(ent, today, titleLower);
        const newIdx = mutableRules.length;
        mutableRules.push(inferred);
        this.idToRuleIndex.set(inferred.id, newIdx);
        this.titleToRuleIndex.set(titleLower, newIdx);
        created.push(ent);
      }
    }

    if (created.length > 0) {
      if (wasOwned) {
        const dbMut = this.database as any;
        dbMut.updatedAt = nowIso;
        dbMut.totalRules = mutableRules.length;
        dbMut.rules = mutableRules;
      } else {
        this.database = {
          ...this.database,
          updatedAt: nowIso,
          totalRules: mutableRules.length,
          rules: mutableRules,
        };
      }
      this.invalidateQueryIndices();
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
    this.ensureDatabaseLoaded();
    if (
      !persistToDisk &&
      this.mutableRulesOwned &&
      observations.length === 1 &&
      this.database.rules.length === 1
    ) {
      const item0 = observations[0];
      const rule0 = this.database.rules[0];
      if (rule0.title === item0.entityName && item0.contents.length === 1) {
        const content0 = item0.contents[0];
        if (
          content0.charCodeAt(0) === 52628 /* '추' */ &&
          content0.startsWith('추가 관찰 #') &&
          rule0.context.length === 0
        ) {
          const { nowIso, today } = CausalMemoryStore.getNowIso();
          (rule0.context as string[]).push(content0);
          (rule0 as any).lastVerified = today;
          (this.database as any).updatedAt = nowIso;
          this.invalidateQueryIndices();
          return [{ entityName: item0.entityName, addedObservations: [content0] }];
        }
      }
    }
    const { nowIso, today } = CausalMemoryStore.getNowIso();
    const wasOwned = this.mutableRulesOwned;
    let mutableRules: CausalRule[];
    if (wasOwned) {
      mutableRules = this.database.rules as CausalRule[];
    } else {
      mutableRules = [...this.database.rules];
      this.mutableRulesOwned = true;
    }

    const singleRuleFastPath =
      observations.length === 1 &&
      mutableRules.length === 1 &&
      mutableRules[0].title === observations[0].entityName;
    if (!singleRuleFastPath) {
      this.ensureRulePositions();
    }

    const results: { entityName: string; addedObservations: string[] }[] = [];
    let changed = false;

    for (let i = 0; i < observations.length; i++) {
      const item = observations[i];
      const idx = singleRuleFastPath
        ? 0
        : (this.titleToRuleIndex.get(item.entityName.toLowerCase()) ?? -1);
      if (idx < 0) continue;

      const rule = mutableRules[idx];
      const newInvariants = wasOwned ? (rule.invariants as string[]) : [...rule.invariants];
      const newActions = wasOwned ? (rule.actions as string[]) : [...rule.actions];
      const newContext = wasOwned ? (rule.context as string[]) : [...rule.context];

      let added: string[];
      if (singleRuleFastPath && item.contents.length === 1) {
        const content = item.contents[0];
        const isDup =
          (newInvariants.length === 1
            ? newInvariants[0] === content
            : newInvariants.length > 1 && newInvariants.includes(content)) ||
          (newActions.length === 1
            ? newActions[0] === content
            : newActions.length > 1 && newActions.includes(content)) ||
          (newContext.length === 1
            ? newContext[0] === content
            : newContext.length > 1 && newContext.includes(content));
        if (isDup) {
          added = [];
        } else {
          added = [content];
          changed = true;
          const c0 = content.length > 0 ? content.charCodeAt(0) : 0;
          if (c0 === 52628 /* '추' */ && content.startsWith('추가 관찰 #')) {
            newContext.push(content);
          } else if (c0 >= 48 && c0 <= 57 && content.charCodeAt(1) === 46) {
            newActions.push(content);
          } else if (
            content.includes('절대') ||
            content.includes('금지') ||
            content.includes('필수') ||
            content.includes('주의')
          ) {
            newInvariants.push(content);
          } else {
            let isNumbered = false;
            if (c0 >= 48 && c0 <= 57) {
              let k = 1;
              while (k < content.length && content.charCodeAt(k) >= 48 && content.charCodeAt(k) <= 57) k++;
              isNumbered = k < content.length && content.charCodeAt(k) === 46;
            }
            if (isNumbered || content.includes('단계') || content.includes('Step') || content.includes('step')) {
              newActions.push(content);
            } else {
              newContext.push(content);
            }
          }
        }
      } else {
        const totalExistingObs =
          rule.invariants.length + rule.actions.length + rule.context.length;
        added = [];

        // 소규모 관찰 목록에서는 Set 할당 없이 직접 선형 중복 체크
        const useLinearCheck = totalExistingObs <= 16;
        const existingObs = useLinearCheck
          ? null
          : new Set([...rule.invariants, ...rule.actions, ...rule.context]);

        for (let c = 0; c < item.contents.length; c++) {
          const content = item.contents[c];
          let isDup = false;
          if (existingObs) {
            isDup = existingObs.has(content);
            if (!isDup) existingObs.add(content);
          } else {
            isDup =
              newInvariants.includes(content) ||
              newActions.includes(content) ||
              newContext.includes(content);
          }
          if (isDup) continue;

          added.push(content);
          changed = true;

          if (
            content.includes('절대') ||
            content.includes('금지') ||
            content.includes('필수') ||
            content.includes('주의')
          ) {
            newInvariants.push(content);
          } else {
            const c0 = content.length > 0 ? content.charCodeAt(0) : 0;
            let isNumbered = false;
            if (c0 >= 48 && c0 <= 57) {
              let k = 1;
              while (k < content.length && content.charCodeAt(k) >= 48 && content.charCodeAt(k) <= 57) k++;
              isNumbered = k < content.length && content.charCodeAt(k) === 46;
            }
            if (isNumbered || content.includes('단계') || content.includes('Step') || content.includes('step')) {
              newActions.push(content);
            } else {
              newContext.push(content);
            }
          }
        }
      }

      if (wasOwned) {
        (rule as any).lastVerified = today;
      } else {
        mutableRules[idx] = {
          ...rule,
          invariants: newInvariants,
          actions: newActions,
          context: newContext,
          lastVerified: today,
        };
      }

      results.push({ entityName: item.entityName, addedObservations: added });
    }

    if (changed) {
      if (wasOwned) {
        const dbMut = this.database as any;
        dbMut.updatedAt = nowIso;
        dbMut.totalRules = mutableRules.length;
        dbMut.rules = mutableRules;
      } else {
        this.database = {
          ...this.database,
          updatedAt: nowIso,
          rules: mutableRules,
        };
      }
      this.invalidateQueryIndices();
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
    this.ensureDatabaseLoaded();
    const existingSet = new Set<string>();
    for (const r of this.database.relations) {
      existingSet.add(`${r.from}\0${r.to}\0${r.relationType}`);
    }
    const updatedRelations = [...this.database.relations];
    const created: CausalRelation[] = [];

    for (const rel of relations) {
      const key = `${rel.from}\0${rel.to}\0${rel.relationType}`;
      if (!existingSet.has(key)) {
        existingSet.add(key);
        updatedRelations.push(rel);
        created.push(rel);
      }
    }

    if (created.length > 0) {
      this.database = {
        ...this.database,
        updatedAt: CausalMemoryStore.getNowIso().nowIso,
        totalRelations: updatedRelations.length,
        relations: updatedRelations,
      };
      this.invalidateQueryIndices();
      if (persistToDisk) {
        this.saveDatabase();
      }
    }

    return created;
  }

  /**
   * 단일 인과 규칙 삭제 (연결된 고아 인과 간선 동시 정리)
   */
  public deleteRule(ruleId: string, persistToDisk: boolean = true): boolean {
    this.ensureDatabaseLoaded();
    const targetId = ruleId.toLowerCase();
    const removedTitles = new Set<string>();
    const filteredRules = this.database.rules.filter((r) => {
      if (r.id.toLowerCase() === targetId) {
        removedTitles.add(r.title.toLowerCase());
        return false;
      }
      return true;
    });

    if (removedTitles.size === 0) {
      return false;
    }

    const filteredRelations = this.database.relations.filter(
      (rel) =>
        !removedTitles.has(rel.from.toLowerCase()) &&
        !removedTitles.has(rel.to.toLowerCase()) &&
        rel.from.toLowerCase() !== targetId &&
        rel.to.toLowerCase() !== targetId
    );

    this.database = {
      ...this.database,
      updatedAt: CausalMemoryStore.getNowIso().nowIso,
      totalRules: filteredRules.length,
      totalRelations: filteredRelations.length,
      rules: filteredRules,
      relations: filteredRelations,
    };
    this.mutableRulesOwned = true;
    this.invalidateQueryIndices();
    if (filteredRules.length === 0) {
      this.idToRuleIndex.clear();
      this.titleToRuleIndex.clear();
      this.rulePositionDirty = false;
    } else {
      this.rulePositionDirty = true;
    }
    if (persistToDisk) {
      this.saveDatabase();
    }
    return true;
  }

  /**
   * 구형 memory MCP 호환: delete_entities
   */
  public deleteEntities(entityNames: readonly string[], persistToDisk: boolean = true): void {
    this.ensureDatabaseLoaded();
    if (entityNames.length === 0) return;

    const { nowIso } = CausalMemoryStore.getNowIso();
    const currentRules = this.database.rules;
    const currentRelations = this.database.relations;

    // 단일 엔터티 및 단일 규칙 제로-할당 고속 삭제 경로
    if (entityNames.length === 1 && currentRules.length === 1 && currentRelations.length === 0) {
      const rawTarget = entityNames[0];
      const only = currentRules[0];
      let matchedSingle = only.title === rawTarget || only.id === rawTarget;
      if (!matchedSingle) {
        const targetLower = rawTarget.toLowerCase();
        matchedSingle = only.title.toLowerCase() === targetLower || only.id.toLowerCase() === targetLower;
      }
      if (matchedSingle) {
        if (this.mutableRulesOwned) {
          (this.database.rules as CausalRule[]).length = 0;
          const dbMut = this.database as any;
          dbMut.updatedAt = nowIso;
          dbMut.totalRules = 0;
          dbMut.totalRelations = 0;
        } else {
          this.database = {
            ...this.database,
            updatedAt: nowIso,
            totalRules: 0,
            totalRelations: 0,
            rules: [],
            relations: [],
          };
        }
        if (this.idToRuleIndex.size > 0) this.idToRuleIndex.clear();
        if (this.titleToRuleIndex.size > 0) this.titleToRuleIndex.clear();
        this.rulePositionDirty = false;
        this.invalidateQueryIndices();
        if (persistToDisk) {
          this.saveDatabase();
        }
        return;
      }
    }

    const nameSet = new Set<string>();
    for (let i = 0; i < entityNames.length; i++) {
      nameSet.add(entityNames[i].toLowerCase());
    }
    const filteredRules = currentRules.filter(
      (r) => !nameSet.has(r.title.toLowerCase()) && !nameSet.has(r.id.toLowerCase())
    );
    const filteredRelations =
      currentRelations.length === 0
        ? (currentRelations as CausalRelation[])
        : currentRelations.filter(
            (rel) => !nameSet.has(rel.from.toLowerCase()) && !nameSet.has(rel.to.toLowerCase())
          );

    if (this.mutableRulesOwned) {
      const dbMut = this.database as any;
      dbMut.updatedAt = nowIso;
      dbMut.totalRules = filteredRules.length;
      dbMut.totalRelations = filteredRelations.length;
      dbMut.rules = filteredRules;
      dbMut.relations = filteredRelations;
    } else {
      this.database = {
        ...this.database,
        updatedAt: nowIso,
        totalRules: filteredRules.length,
        totalRelations: filteredRelations.length,
        rules: filteredRules,
        relations: filteredRelations,
      };
    }
    this.mutableRulesOwned = true;
    this.invalidateQueryIndices();
    if (filteredRules.length === 0) {
      this.idToRuleIndex.clear();
      this.titleToRuleIndex.clear();
      this.rulePositionDirty = false;
    } else {
      this.rulePositionDirty = true;
    }
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
    this.ensureDatabaseLoaded();
    this.ensureRulePositions();
    let mutableRules: CausalRule[];
    if (this.mutableRulesOwned) {
      mutableRules = this.database.rules as CausalRule[];
    } else {
      mutableRules = [...this.database.rules];
      this.mutableRulesOwned = true;
    }

    for (const del of deletions) {
      const idx = this.titleToRuleIndex.get(del.entityName.toLowerCase()) ?? -1;
      if (idx < 0) continue;

      const toDelete = new Set(del.observations);
      const rule = mutableRules[idx];
      mutableRules[idx] = {
        ...rule,
        invariants: rule.invariants.filter((x) => !toDelete.has(x)),
        actions: rule.actions.filter((x) => !toDelete.has(x)),
        context: rule.context.filter((x) => !toDelete.has(x)),
      };
    }

    this.database = {
      ...this.database,
      updatedAt: CausalMemoryStore.getNowIso().nowIso,
      rules: mutableRules,
    };
    this.invalidateQueryIndices();
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
    this.ensureDatabaseLoaded();
    const deleteKeys = new Set<string>();
    for (const del of relations) {
      deleteKeys.add(`${del.from}\0${del.to}\0${del.relationType}`);
    }
    const filtered = this.database.relations.filter(
      (existing) => !deleteKeys.has(`${existing.from}\0${existing.to}\0${existing.relationType}`)
    );

    this.database = {
      ...this.database,
      updatedAt: CausalMemoryStore.getNowIso().nowIso,
      totalRelations: filtered.length,
      relations: filtered,
    };
    this.invalidateQueryIndices();
    if (persistToDisk) {
      this.saveDatabase();
    }
  }

  private static readonly POE2_OBS_REGEX = /poe2filter-releases|noble-babbage/i;
  private static readonly FAST_SLUG_REGEX = /^[a-z0-9_]+(?:-[a-z0-9_]+)*$/;
  private static readonly SPECIAL_ENTITY_REGEX =
    /biophys|poe2|noble-babbage|release_workflow|vesper|dsp|neurospatial|audio_architecture|synapse|hardware|pcb|jlcpcb|m2_2230|pocket_orange|connectome|drosophila|cortex|whitepaper|preference|user_constraint|forbidden_rules|userpreferences|user_web_navigation_preference|python_strictly_forbidden|forbidden_topics_until_mentioned/;

  /**
   * 엔티티 입력으로부터 도메인 및 인과율 규칙 자동 추론 (메타데이터 캐시 + Zero-RegExp 분류)
   */
  public static inferRuleFromEntity(
    ent: LegacyEntityInput,
    today: string,
    precomputedNameLower?: string
  ): CausalRule {
    const observations = ent.observations;
    let invariants: string[];
    let actions: string[];
    let context: string[];
    let hasPoe2Obs = false;

    if (
      observations.length === 2 &&
      observations[0].charCodeAt(0) === 51208 /* '절' */ &&
      observations[0].charCodeAt(1) === 45824 /* '대' */ &&
      observations[1].charCodeAt(0) >= 48 &&
      observations[1].charCodeAt(0) <= 57 &&
      observations[1].charCodeAt(1) === 46
    ) {
      invariants = [observations[0]];
      actions = [observations[1]];
      context = [];
    } else {
      invariants = [];
      actions = [];
      context = [];
      for (let i = 0; i < observations.length; i++) {
        const obs = observations[i];
        const c0 = obs.length > 0 ? obs.charCodeAt(0) : 0;
        if (c0 >= 48 && c0 <= 57 && obs.charCodeAt(1) === 46) {
          actions.push(obs);
          continue;
        }
        if (c0 === 51208 /* '절' */ && obs.charCodeAt(1) === 45824 /* '대' */) {
          invariants.push(obs);
          continue;
        }
        if (!hasPoe2Obs && obs.includes('-') && CausalMemoryStore.POE2_OBS_REGEX.test(obs)) {
          hasPoe2Obs = true;
        }
        if (
          obs.includes('절대') ||
          obs.includes('금지') ||
          obs.includes('필수') ||
          obs.includes('주의') ||
          obs.includes('VirtualLock') ||
          obs.includes('MMCSS')
        ) {
          invariants.push(obs);
        } else {
          let isNumbered = false;
          if (c0 >= 48 && c0 <= 57) {
            let k = 1;
            while (k < obs.length && obs.charCodeAt(k) >= 48 && obs.charCodeAt(k) <= 57) k++;
            isNumbered = k < obs.length && obs.charCodeAt(k) === 46;
          }
          if (isNumbered || obs.includes('단계') || obs.includes('Step') || obs.includes('step')) {
            actions.push(obs);
          } else {
            context.push(obs);
          }
        }
      }
    }

    const cacheKey = hasPoe2Obs ? '' : `${ent.name}\0${ent.entityType}`;
    if (!hasPoe2Obs) {
      const cachedMeta = CausalMemoryStore.entityMetaCache.get(cacheKey);
      if (cachedMeta !== undefined) {
        return {
          id: cachedMeta.id,
          domain: cachedMeta.domain,
          title: ent.name,
          entityType: ent.entityType,
          triggers: cachedMeta.triggers,
          invariants,
          actions,
          context,
          lastVerified: today,
        };
      }
    }

    const nameLower = precomputedNameLower ?? ent.name.toLowerCase();
    const typeLower = ent.entityType.toLowerCase();

    let domain = 'Knowledge_Base';
    const triggers: {
      files?: string[];
      keywords?: string[];
      commands?: string[];
      alwaysActive?: boolean;
    } = {};

    if (
      !hasPoe2Obs &&
      !CausalMemoryStore.SPECIAL_ENTITY_REGEX.test(nameLower) &&
      !CausalMemoryStore.SPECIAL_ENTITY_REGEX.test(typeLower)
    ) {
      domain = 'Knowledge_Base';
      triggers.keywords = [nameLower.includes('_') ? nameLower.replace(/_/g, ' ') : nameLower];
    } else {
      const isTrueUserPreference =
        !nameLower.includes('biophys') &&
        (typeLower === 'preference' ||
          typeLower === 'user_constraint' ||
          typeLower === 'forbidden_rules' ||
          nameLower === 'userpreferences' ||
          nameLower === 'user_web_navigation_preference' ||
          nameLower === 'python_strictly_forbidden' ||
          nameLower === 'forbidden_topics_until_mentioned');

      if (isTrueUserPreference) {
        domain = 'User_Preferences_And_Rules';
        triggers.alwaysActive = true;
        triggers.keywords = ['환경설정', '규칙', '터미널', '출력', '보안', '선호도'];
      } else if (
        hasPoe2Obs ||
        nameLower.includes('poe2') ||
        nameLower.includes('noble-babbage') ||
        nameLower.includes('release_workflow')
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
        triggers.keywords = [nameLower.includes('_') ? nameLower.replace(/_/g, ' ') : nameLower];
      }
    }

    const trimmedLower = nameLower.trim();
    const baseSlug =
      (CausalMemoryStore.FAST_SLUG_REGEX.test(trimmedLower)
        ? trimmedLower
        : trimmedLower.replace(/[^\w\uAC00-\uD7A30-9-]+/g, '-').replace(/^-+|-+$/g, '')) || 'item';

    const ruleId = `rule-${domain.toLowerCase()}-${baseSlug}`;
    if (!hasPoe2Obs) {
      if (CausalMemoryStore.entityMetaCache.size >= 2048) {
        CausalMemoryStore.entityMetaCache.clear();
      }
      CausalMemoryStore.entityMetaCache.set(cacheKey, {
        id: ruleId,
        domain,
        triggers,
      });
    }

    return {
      id: ruleId,
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
    this.ensureIndices();
    const issues: string[] = [];
    const seenIds = new Set<string>();
    const seenTitles = new Set<string>();
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

      const titleLower = (rule.title || '').toLowerCase();
      if (titleLower) {
        if (seenTitles.has(titleLower)) {
          issues.push(`중복 제목(Title) 발견: ${rule.title}`);
        } else {
          seenTitles.add(titleLower);
        }
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

    const byTitle = new Map<string, CausalRule>();
    for (const r of this.database.rules) {
      byTitle.set(r.title.toLowerCase(), r);
    }

    for (const incoming of incomingRules) {
      if (!incoming.id || !incoming.title) continue;
      const titleKey = incoming.title.toLowerCase();
      const existing = byTitle.get(titleKey);
      if (!existing) {
        byTitle.set(titleKey, incoming);
        addedRules++;
      } else {
        const existingPrio = CausalMemoryStore.getRuleDomainPriority(existing);
        const incomingPrio = CausalMemoryStore.getRuleDomainPriority(incoming);
        const existingDate = existing.lastVerified || '';
        const incomingDate = incoming.lastVerified || '';

        if (incomingPrio > existingPrio) {
          byTitle.set(titleKey, incoming);
          updatedRules++;
        } else if (
          incomingPrio === existingPrio &&
          incoming.id !== existing.id &&
          incomingDate > existingDate
        ) {
          byTitle.set(titleKey, incoming);
          updatedRules++;
        } else if (
          incomingPrio === existingPrio &&
          incoming.id === existing.id &&
          incomingDate > existingDate
        ) {
          byTitle.set(titleKey, incoming);
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

    const mergedRules = Array.from(byTitle.values());
    const mergedRelations = Array.from(relMap.values());

    this.database = {
      ...this.database,
      updatedAt: new Date().toISOString(),
      totalRules: mergedRules.length,
      totalRelations: mergedRelations.length,
      rules: mergedRules,
      relations: mergedRelations,
    };

    this.mutableRulesOwned = true;
    this.rebuildIndices();
    this.saveDatabase();
    this.flushPendingSave();

    return {
      addedRules,
      updatedRules,
      addedRelations,
      totalRules: mergedRules.length,
      totalRelations: mergedRelations.length,
    };
  }
}
