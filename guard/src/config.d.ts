/**
 * 시냅스 보안 방화벽 전역 설정 및 정규식 규칙 (Synapse Guard Configuration)
 */
export interface GuardConfig {
    /** 섀넌 엔트로피 최소 임계치 (기본: 3.5) */
    readonly entropyThreshold?: number;
    /** 최소 토큰 의심 길이 (기본: 20) */
    readonly minSecretLength?: number;
    /** 엄격 모드 (위반 발견 시 예외 throw 여부, 기본: true) */
    readonly strict?: boolean;
}
export declare const GUARD_DEFAULTS: {
    readonly ENTROPY_THRESHOLD: 3.5;
    readonly MIN_SECRET_LENGTH: 20;
};
/**
 * 알려진 자격증명 시그니처 정규식 목록
 */
export declare const KNOWN_SECRET_PATTERNS: readonly [{
    readonly name: "Discord Bot Token";
    readonly pattern: RegExp;
}, {
    readonly name: "npm Automation/Publish Token";
    readonly pattern: RegExp;
}, {
    readonly name: "GitHub Personal Access Token";
    readonly pattern: RegExp;
}, {
    readonly name: "SSH / RSA Private Key";
    readonly pattern: RegExp;
}, {
    readonly name: "Cloudflare API Token / Key";
    readonly pattern: RegExp;
}, {
    readonly name: "AWS Access Key ID";
    readonly pattern: RegExp;
}];
/**
 * SQL Injection 위험 패턴
 */
export declare const SQL_INJECTION_PATTERNS: readonly [RegExp, RegExp, RegExp, RegExp, RegExp];
