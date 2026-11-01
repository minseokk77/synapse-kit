import { type CausalResonanceResult } from './causal-store';
/**
 * Git 작업 트리의 변경 파일 목록 자동 추출
 */
export declare function detectModifiedFiles(cwd?: string): Promise<string[]>;
/**
 * 인과율 공명 쿼리 실행기
 */
export declare function runCausalQuery(rawOptions: {
    files?: string[];
    keywords?: string[];
    command?: string;
    domain?: string;
    autoGit?: boolean;
    cwd?: string;
    propagateRelations?: boolean;
}, storeCustomPath?: string): Promise<CausalResonanceResult>;
/**
 * AI 에이전트 주입용 초경량 마크다운/텍스트 포맷터
 */
export declare function formatResonanceForAgent(result: CausalResonanceResult, compact?: boolean): string;
