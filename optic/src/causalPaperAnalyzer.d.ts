/**
 * 시냅스 옵틱(Synapse Optic) 학술 논문 인과 분석 가속기
 * - 최신 AI 브라우저 에이전트 5대 논문 심층 지식 그래프 인덱싱
 * - 초경량 0ms 인과 공명 쿼리(Causal Resonance) 기반 초고속 대조 분석
 * - 외부 의존성 없는 독립적 인메모리 O(1) 인과 그래프 역인덱스 엔진 내장
 */
export interface PaperCausalTrigger {
    readonly keywords?: readonly string[];
    readonly files?: readonly string[];
    readonly alwaysActive?: boolean;
}
export interface PaperCausalRelation {
    readonly from: string;
    readonly to: string;
    readonly relationType: string;
    readonly relation?: string;
}
export interface PaperCausalRule {
    readonly id: string;
    readonly domain: string;
    readonly title: string;
    readonly triggers: PaperCausalTrigger;
    readonly invariants: readonly string[];
    readonly actions: readonly string[];
    readonly context: readonly string[];
}
export interface PaperCausalResonanceResult {
    readonly queryDurationMs: number;
    readonly matchedCount: number;
    readonly resonanceRules: readonly PaperCausalRule[];
    readonly activeRelations: readonly PaperCausalRelation[];
}
export interface PaperMetadata {
    readonly id: string;
    readonly arxivId: string;
    readonly title: string;
    readonly authors: string;
    readonly year: number;
    readonly url: string;
    readonly coreInsight: string;
    readonly limitationsOrVulnerabilities: string;
    readonly synapseAlignment: {
        readonly targetCore: string;
        readonly mechanism: string;
        readonly invariant: string;
        readonly superiority: string;
    };
}
export declare const PAPERS_SURVEY: readonly PaperMetadata[];
/**
 * 10대 학술 도메인 기반 대규모 논문 데이터셋 자동 생성기 (최대 N편 초고속 생성)
 */
export declare function generateMassivePapersDataset(count?: number): readonly PaperMetadata[];
export interface PaperComparisonResult {
    readonly paper: PaperMetadata;
    readonly queryDurationMs: number;
    readonly matchedRulesCount: number;
    readonly resonanceSummary: string;
}
/**
 * 초고속 O(1) 인메모리 인과율 그래프 공명 엔진
 */
export declare class InMemoryCausalEngine {
    private readonly rules;
    private readonly relations;
    private readonly keywordIndex;
    assertRule(rule: PaperCausalRule): void;
    assertRelation(relation: PaperCausalRelation): void;
    queryResonance(options: {
        keywords?: readonly string[];
        propagateRelations?: boolean;
    }): PaperCausalResonanceResult;
}
export declare class CausalPaperAnalyzer {
    private readonly store;
    private isInitialized;
    private registeredPapers;
    constructor(customStoreOrPath?: InMemoryCausalEngine | string);
    /**
     * 학술 논문 및 시냅스 코어 아키텍처 규칙을 Causal Memory 인과 그래프에 등록
     */
    initializeKnowledgeGraph(customPapers?: readonly PaperMetadata[]): void;
    /**
     * 단일 논문 및 아키텍처 초고속 인과 공명 대조 분석 (0.0ms~0.5ms 소요)
     */
    analyze(paperIdOrKeyword: string, customPapers?: readonly PaperMetadata[]): PaperComparisonResult;
    /**
     * 전체 논문 동시 분석 및 매트릭스 도출
     */
    analyzeAll(customPapers?: readonly PaperMetadata[]): readonly PaperComparisonResult[];
    /**
     * 종합 대조 분석 및 검증 보고서 마크다운 생성
     */
    generateReport(options?: {
        papers?: readonly PaperMetadata[];
        liveOpticDurationMs?: number;
        cacheHitDurationMs?: number;
        batchDurationMs?: number;
    }): string;
}
