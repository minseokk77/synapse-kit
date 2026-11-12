export interface SurveyPipelineOptions {
    readonly query?: string;
    readonly quiet?: boolean;
    readonly targetCount?: number;
}
export interface SurveyPipelineResult {
    readonly totalPapers: number;
    readonly pipelineDurationMs: number;
    readonly resonanceAverageMs: number;
    readonly passedTestsCount: number;
    readonly summary: string;
}
export declare function runAcceleratedSurveyPipeline(options?: SurveyPipelineOptions): Promise<SurveyPipelineResult>;
