export interface OverloadBenchmarkConfig {
    readonly ruleScale: number;
    readonly relationScale: number;
    readonly concurrency: number;
    readonly totalRequests: number;
    readonly fileInputScale: number;
    readonly crudIterations: number;
}
export interface ScenarioMetrics {
    readonly name: string;
    readonly passed: boolean;
    readonly details: Record<string, string | number>;
}
export interface OverloadBenchmarkReport {
    readonly timestamp: string;
    readonly config: OverloadBenchmarkConfig;
    readonly allPassed: boolean;
    readonly totalDurationMs: number;
    readonly scenarios: readonly ScenarioMetrics[];
}
/**
 * 차세대 인과율 메모리(Causal Memory 2.1) 4대 차원 과부하 벤치마크 실행기
 */
export declare function executeOverloadBenchmark(customConfig?: Partial<OverloadBenchmarkConfig>, silent?: boolean): Promise<OverloadBenchmarkReport>;
