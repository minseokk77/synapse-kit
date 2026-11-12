/**
 * Synapse Kit - Causal Release & Deploy 전역 설정 및 상수 정의
 * 하드코딩 상수를 완전히 분리하여 유지보수성과 보안성을 극대화합니다.
 */

/**
 * 엑손(Axon) 릴리즈 파이프라인 기본값 및 제약 조건 상수
 */
export const AXON_DEFAULTS = {
  /** 섀넌 엔트로피 임계값 (3.5 이상 시 고엔트로피 비밀값 의심) */
  ENTROPY_THRESHOLD: 3.5,
  /** 최소 비밀값 길이 (20자 이상) */
  MIN_SECRET_LENGTH: 20,
  /** GitHub 릴리즈 에셋 파일당 단일 최대 크기 (100MB = 104,857,600 바이트) */
  MAX_GITHUB_ASSET_SIZE_BYTES: 100 * 1024 * 1024,
  /** 텍스트 내용 스캔 대상 파일 최대 크기 (1MB = 1,048,576 바이트) */
  MAX_TEXT_SCAN_SIZE_BYTES: 1024 * 1024,
  /** 기본 폴백 릴리즈 버전 태그 */
  FALLBACK_TAG: 'v0.1.0',
  /** 빈 Git 커밋 해시 (Git 정보 부재 시 사용) */
  EMPTY_COMMIT_HASH: '0000000000000000000000000000000000000000',
  /** 단축 커밋 해시 길이 (7자리) */
  SHORT_COMMIT_LENGTH: 7,
  /** Merkle-DAG Root 해시 길이 (16자리) */
  MERKLE_ROOT_LENGTH: 16,
} as const;

/**
 * 안전한 시맨틱 버전 태그 검증 정규식 (CLI 플래그 인젝션 및 특수문자 공격 차단)
 * 허용 예시: 'v1.0.0', '1.0.0', 'v0.3.1-beta.1', 'v2.0.0+build123'
 */
export const SAFE_TAG_PATTERN = /^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * 알려진 자격증명 시그니처 정규식 목록
 */
export const AXON_KNOWN_SECRET_PATTERNS = [
  {
    name: 'Discord Bot Token',
    pattern: /[\w-]{24}\.[\w-]{6}\.[\w-]{27}/g,
  },
  {
    name: 'npm Automation/Publish Token',
    pattern: /npm_[a-zA-Z0-9]{36}/g,
  },
  {
    name: 'GitHub Personal Access Token',
    pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g,
  },
  {
    name: 'SSH / RSA Private Key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  {
    name: 'Cloudflare API Token / Key',
    pattern: /cfl_[a-zA-Z0-9_-]{32,}/g,
  },
  {
    name: 'AWS Access Key ID',
    pattern: /AKIA[0-9A-Z]{16}/g,
  },
] as const;

/**
 * 릴리즈에 절대 포함되어서는 안 되는 금지 파일 확장자 및 패턴
 */
export const AXON_RESTRICTED_PATTERNS: readonly RegExp[] = [
  /^\.env(?:\..+)?$/i,
  /\.key$/i,
  /\.pem$/i,
  /^id_rsa(?:\.pub)?$/i,
  /^id_ed25519(?:\.pub)?$/i,
  /\.pfx$/i,
  /\.keystore$/i,
  /dummy\d+gb\.tmp$/i,
];
