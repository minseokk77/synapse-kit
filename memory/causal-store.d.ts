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
 * 인과율 메모리 저장소 및 O(1) 역인덱스 공명 엔진 클래스 (SRP 및 OCP 준수)
 */
export declare class CausalMemoryStore {
    private readonly dbPath;
    private database;
    private lastMtimeMs;
    private alwaysActiveRules;
    private domainIndex;
    private commandIndex;
    private exactKeywordIndex;
    private exactFileIndex;
    private prefixFileRules;
    private compiledSearchRules;
    private titleToRuleMap;
    private idToRuleMap;
    private relationAdjacency;
    constructor(customPath?: string, initialDatabase?: CausalMemoryDatabase);
    /**
     * 디스크 파일 변경(mtimeMs)이 감지된 경우에만 스마트 리로드 수행 (Zero-Copy Cache)
     */
    reloadIfNeeded(): boolean;
    /**
     * 강제 디스크 리로드
     */
    reload(): void;
    /**
     * 인메모리 데이터베이스 직접 주입 (벤치마크 및 인메모리 시뮬레이션용)
     */
    loadFromMemory(db: CausalMemoryDatabase): void;
    /**
     * O(1) 역인덱스(Inverted Index) 및 인접 리스트 그래프(Adjacency List) 재구축
     */
    private rebuildIndices;
    /**
     * 데이터베이스 로드
     */
    private loadDatabase;
    /**
     * 데이터베이스 디스크 동기화
     */
    private saveDatabase;
    getAllRules(): readonly CausalRule[];
    getAllRelations(): readonly CausalRelation[];
    getStatus(): {
        version: string;
        updatedAt: string;
        totalRules: number;
        totalRelations: number;
        dbPath: string;
        domains: string[];
        domainCounts: Record<string, number>;
    };
    /**
     * 부분 문자열 폴백 검색을 위한 지연 컴파일러 (Lazy Compilation)
     */
    private getCompiledSearchRules;
    /**
     * 초고속 O(1) 역인덱스 및 다중 홉(Multi-Hop) 그래프 전파 공명 쿼리 엔진
     */
    queryResonance(options: CausalQueryOptions): CausalResonanceResult;
    /**
     * 신규 규칙 등록 또는 기존 규칙 갱신
     */
    assertRule(rule: CausalRule, persistToDisk?: boolean): void;
    /**
     * 구형 memory MCP 호환: read_graph 대체 (초경량 인과 공명 요약 반환)
     */
    readSmartGraph(files?: readonly string[]): {
        causalMemoryEngine: string;
        tokenDietSavings: string;
        queryDurationMs: number;
        activeEntitiesCount: number;
        totalIndexedRules: number;
        totalIndexedRelations: number;
        availableDomains: Record<string, number>;
        hint: string;
        entities: {
            name: string;
            entityType: string;
            domain: string;
            invariants: readonly string[];
            actions: readonly string[];
            observations: string[];
        }[];
        relations: readonly CausalRelation[];
    };
    /**
     * 구형 memory MCP 호환: search_nodes
     */
    searchNodes(query: string): {
        causalMemoryEngine: string;
        tokenDietSavings: string;
        queryDurationMs: number;
        activeEntitiesCount: number;
        totalIndexedRules: number;
        totalIndexedRelations: number;
        availableDomains: Record<string, number>;
        hint: string;
        entities: {
            name: string;
            entityType: string;
            domain: string;
            invariants: readonly string[];
            actions: readonly string[];
            observations: string[];
        }[];
        relations: readonly CausalRelation[];
    } | {
        entities: {
            name: string;
            entityType: string;
            observations: string[];
        }[];
        relations: CausalRelation[];
    };
    /**
     * 구형 memory MCP 호환: open_nodes
     */
    openNodes(names: readonly string[]): {
        entities: {
            name: string;
            entityType: string;
            observations: string[];
        }[];
        relations: CausalRelation[];
    };
    /**
     * 구형 memory MCP 호환: create_entities
     */
    createEntities(entities: readonly LegacyEntityInput[], persistToDisk?: boolean): LegacyEntityInput[];
    /**
     * 구형 memory MCP 호환: add_observations
     */
    addObservations(observations: readonly {
        readonly entityName: string;
        readonly contents: readonly string[];
    }[], persistToDisk?: boolean): {
        entityName: string;
        addedObservations: string[];
    }[];
    /**
     * 구형 memory MCP 호환: create_relations
     */
    createRelations(relations: readonly CausalRelation[], persistToDisk?: boolean): CausalRelation[];
    /**
     * 구형 memory MCP 호환: delete_entities
     */
    deleteEntities(entityNames: readonly string[], persistToDisk?: boolean): void;
    /**
     * 구형 memory MCP 호환: delete_observations
     */
    deleteObservations(deletions: readonly {
        readonly entityName: string;
        readonly observations: readonly string[];
    }[], persistToDisk?: boolean): void;
    /**
     * 구형 memory MCP 호환: delete_relations
     */
    deleteRelations(relations: readonly CausalRelation[], persistToDisk?: boolean): void;
    /**
     * 엔티티 입력으로부터 도메인 및 인과율 규칙 자동 추론
     */
    static inferRuleFromEntity(ent: LegacyEntityInput, today: string): CausalRule;
    /**
     * 메모리 무결성 감사 (Audit)
     */
    audit(): {
        ok: boolean;
        totalRules: number;
        totalRelations: number;
        alwaysActiveCount: number;
        issues: string[];
    };
}
