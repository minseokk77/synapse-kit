/**
 * Synapse Kit - Causal Release & Deploy 타입 정의
 * 토큰 절약형 초경량 릴리즈 및 GitHub CLI 연동을 위한 규격
 */

export interface ReleaseOptions {
  /** 릴리즈 버전 태그 (예: 'v0.3.2', 생략 시 package.json에서 자동 추출) */
  readonly tag?: string;
  /** 릴리즈 타이틀 (생략 시 기본 템플릿 사용) */
  readonly title?: string;
  /** 커스텀 릴리즈 노트 (생략 시 인과율 다이제스트 자동 생성) */
  readonly notes?: string;
  /** GitHub 릴리즈에 첨부할 에셋 파일 경로 목록 */
  readonly assets?: readonly string[];
  /** 실제 배포 없이 검증 및 시뮬레이션만 수행 여부 */
  readonly dryRun?: boolean;
  /** 초극단적 토큰 압축 모드 (단일 라인 JSON 반환) */
  readonly compact?: boolean;
  /** AI 에이전트 모드 */
  readonly agentMode?: boolean;
  /** 시크릿 실드 검사 건너뛰기 여부 (권장하지 않음) */
  readonly skipGuard?: boolean;
  /** 초안(Draft) 릴리즈 생성 여부 */
  readonly isDraft?: boolean;
  /** 시험판(Prerelease) 여부 */
  readonly isPrerelease?: boolean;
  /** 배포 전 buildTracks 자동 실행 여부 */
  readonly build?: boolean;
  /** 시맨틱 버전 자동 승격 ('patch' | 'minor' | 'major') */
  readonly bump?: 'patch' | 'minor' | 'major';
}

export interface ModuleChangeSummary {
  /** 모듈 또는 디렉터리 카테고리 (예: 'compiler', 'memory', 'guard', 'runtime', 'docs') */
  readonly module: string;
  /** 변경된 파일 개수 */
  readonly count: number;
  /** 주요 변경 파일 목록 (최대 3개) */
  readonly sampleFiles: readonly string[];
  /** 변경 성격 요약 (예: '기능 추가', '버그 수정', '성능 최적화') */
  readonly category: string;
}

export interface CausalDigest {
  /** 최신 Git HEAD 커밋 해시 (단축형 7자리) */
  readonly commitHash: string;
  /** 전체 커밋 해시 */
  readonly fullCommitHash: string;
  /** 변경된 총 파일 개수 */
  readonly totalFilesChanged: number;
  /** 변경 파일 기반 SHA-256 Merkle 루트 다이제스트 */
  readonly merkleRoot: string;
  /** 모듈별 변경 요약 목록 */
  readonly moduleSummaries: readonly ModuleChangeSummary[];
  /** 자동 생성된 초압축 마크다운 릴리즈 노트 */
  readonly markdownNotes: string;
  /** 원본 git diff 추정 토큰 수 */
  readonly estimatedRawTokens: number;
  /** 다이제스트 마크다운 추정 토큰 수 */
  readonly digestTokens: number;
  /** 절약된 토큰 수 */
  readonly tokensSaved: number;
  /** 압축 절감률 (%) */
  readonly compressionRatio: number;
}

export interface PreflightViolation {
  readonly type: 'SECRET_EXPOSED' | 'FILE_TOO_LARGE' | 'RESTRICTED_FILE' | 'MISSING_ASSET';
  readonly target: string;
  readonly message: string;
  readonly severity: 'CRITICAL' | 'WARNING';
}

export interface PreflightCheckResult {
  readonly passed: boolean;
  readonly violations: readonly PreflightViolation[];
  readonly scannedFilesCount: number;
  readonly durationMs: number;
}

export interface ReleaseResult {
  readonly ok: boolean;
  readonly tag: string;
  readonly commit: string;
  readonly merkleRoot: string;
  readonly releaseUrl?: string;
  readonly tokensSaved: number;
  readonly durationMs: number;
  readonly dryRun: boolean;
  readonly error?: string;
}
