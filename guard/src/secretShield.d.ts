/**
 * 엔트로피 및 시그니처 기반 자격증명 유출 방패 (Secret Shield)
 * - 섀넌 엔트로피(Shannon Entropy) 분석 및 알려진 API 토큰 시그니처 매칭
 * - 코드 및 문서 내 평문 비밀값 노출 0초 탐지 및 마스킹
 */
import { type GuardConfig } from "./config";
import type { SecurityViolation } from "./types";
export declare class SecretShield {
    private readonly entropyThreshold;
    private readonly minSecretLength;
    constructor(config?: GuardConfig);
    /**
     * 문자열의 섀넌 엔트로피(Shannon Entropy) 계산
     */
    calculateEntropy(str: string): number;
    /**
     * 텍스트 내 비밀값 마스킹 처리
     */
    maskSecret(secret: string): string;
    /**
     * 텍스트 전체 스캔 및 자격증명 유출 위반 탐지
     */
    scanText(text: string, targetName?: string): SecurityViolation[];
}
