/**
 * 구형 지식 그래프(memory_backup)를 차세대 인과율 메모리(Causal Memory 2.1)로 무손실 변환합니다.
 * 엔티티뿐만 아니라 모든 인과 간선(Relations)을 100% 보존하며, 도메인 오분류를 방지합니다.
 */
export declare function migrateLegacyMemoryGraph(sourceBackupPath?: string, targetGlobalPath?: string, targetLocalPath?: string): {
    readonly ok: boolean;
    readonly totalRules: number;
    readonly totalRelations: number;
    readonly alwaysActiveCount: number;
    readonly domains: readonly string[];
};
