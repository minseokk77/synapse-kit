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

export const GUARD_DEFAULTS = {
  ENTROPY_THRESHOLD: 3.5,
  MIN_SECRET_LENGTH: 20,
} as const;

/**
 * 알려진 자격증명 시그니처 정규식 목록
 */
export const KNOWN_SECRET_PATTERNS = [
  {
    name: "Discord Bot Token",
    pattern: /[\w-]{24}\.[\w-]{6}\.[\w-]{27}/g,
  },
  {
    name: "npm Automation/Publish Token",
    pattern: /npm_[a-zA-Z0-9]{36}/g,
  },
  {
    name: "GitHub Personal Access Token",
    pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g,
  },
  {
    name: "SSH / RSA Private Key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  {
    name: "Cloudflare API Token / Key",
    pattern: /cfl_[a-zA-Z0-9_-]{32,}/g,
  },
  {
    name: "AWS Access Key ID",
    pattern: /AKIA[0-9A-Z]{16}/g,
  },
] as const;

/**
 * SQL Injection 위험 패턴
 */
export const SQL_INJECTION_PATTERNS = [
  /SELECT\s+.*\s+FROM\s+.*\s+(?:WHERE\s+)?.*['"]\s*\+\s*[a-zA-Z0-9_]+/i,
  /INSERT\s+INTO\s+.*\s+VALUES\s*\(.*['"]\s*\+\s*[a-zA-Z0-9_]+/i,
  /DROP\s+(?:TABLE|DATABASE|VIEW)\s+/i,
  /;\s*TRUNCATE\s+TABLE/i,
  /(?:OR|AND)\s+['"]?1['"]?\s*=\s*['"]?1['"]?/i,
] as const;
