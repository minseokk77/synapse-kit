import type { CausalDecision, CheckerPlugin, SynapseOptions } from './types';
/**
 * 프로젝트 시냅스(Project Synapse) 범용 AI 인과율 메모리 분석 엔진
 * Git 변경 이력과 각 플러그인의 트리거 패턴을 교차 분석하여 불필요한 연산을 지능적으로 스킵합니다.
 */
export declare function analyzeCausalGraph(rootDir: string, plugins: readonly CheckerPlugin[], options: SynapseOptions): Promise<CausalDecision>;
