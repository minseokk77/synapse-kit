/**
 * 시냅스 옵틱(Synapse Optic) 브라우저 엔진 설정 및 상수
 */
export const OPTIC_DEFAULTS = {
  /** 기본 CDP 디버깅 호스트 엔드포인트 */
  DEFAULT_ENDPOINT: "http://127.0.0.1:9222",
  /** 기본 동작 제한 타임아웃 (ms) */
  DEFAULT_ACTION_TIMEOUT_MS: 30_000,
  /** 기본 네트워크 유휴 대기 시간 (ms) */
  DEFAULT_NETWORK_IDLE_MS: 3_000,
  /** 기본 스크롤 이동 픽셀 (px) */
  DEFAULT_SCROLL_AMOUNT: 600,
  /** 네이티브 프로메테우스 바이너리 탐색 후보 경로 */
  NATIVE_PROMETHEUS_CANDIDATES: [
    "C:\\Users\\minse\\.gemini\\antigravity\\scratch\\project-prometheus\\target\\release\\prometheus-cli.exe",
    "C:\\Users\\minse\\.gemini\\antigravity\\scratch\\project-prometheus\\target\\debug\\prometheus-cli.exe",
    "./target/release/prometheus-cli.exe",
    "prometheus-cli.exe",
    "prom.exe",
  ],
  /** 상호작용 지원 표준 역할(Role) 집합 */
  INTERACTIVE_ROLES: new Set([
    "button",
    "link",
    "textbox",
    "searchbox",
    "checkbox",
    "combobox",
    "menuitem",
    "tab",
    "radio",
    "switch",
    "slider",
    "spinbutton",
    "listbox",
    "option",
    "heading",
  ]),
} as const;

/**
 * 시냅스 옵틱 하이브리드 라우터 및 액션 레코더 기본 상수
 */
export const OPTIC_HYBRID_DEFAULTS = {
  FAST_PATH_PATTERNS: ["arxiv.org", ".pdf", "github.com", "docs."] as const,
  TEXT_PAYLOAD_THRESHOLD: 500,
  DEFAULT_SESSION_NAME: "default_session",
} as const;

export interface OpticConfig {
  /** CDP 엔드포인트 URL (기본: http://127.0.0.1:9222) */
  readonly endpoint?: string;
  /** 명시적 대상 브라우저 탭 타깃 ID */
  readonly targetId?: string;
  /** 네이티브 바이너리 실행 파일 경로 */
  readonly binaryPath?: string;
  /** 작업 제한 타임아웃 (ms) */
  readonly timeoutMs?: number;
  /** 헤드리스 모드 활성화 여부 */
  readonly headless?: boolean;
}
