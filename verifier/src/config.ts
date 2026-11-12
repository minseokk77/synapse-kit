/**
 * 시냅스 인과 불변식 검증기 설정 및 규칙 정의 (Synapse Verifier Configuration)
 */

export interface InvariantRuleDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly pattern: RegExp;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly recommendation: string;
}

export const MANDATORY_INVARIANT_RULES: readonly InvariantRuleDef[] = [
  {
    id: "NO_NPM_BUN_REQUIRED",
    name: "npm 사용 금지 및 bun 절대 사용",
    description: "패키지 관리 및 스크립트 실행에 npm을 사용하는 것을 금지하고 bun을 강제합니다.",
    pattern: /\bnpm\s+(?:run|install|add|i|publish|exec)\b/,
    severity: "CRITICAL",
    recommendation: "npm 대신 'bun' 명령어를 사용하십시오.",
  },
  {
    id: "NO_PYTHON_RUST_REQUIRED",
    name: "파이썬(Python) 사용 금지",
    description: "모든 코어 및 백엔드는 100% Rust 및 TS/Bun으로 작성해야 하며 파이썬을 금지합니다.",
    pattern: /\b(?:python|python3)\b|\.py\b/,
    severity: "CRITICAL",
    recommendation: "Python 대신 Rust 또는 TypeScript/Bun을 사용하십시오.",
  },
  {
    id: "NO_CONSOLE_LOG_DEBUG",
    name: "디버그용 console.log 출력 금지",
    description: "프로덕션 코드에 디버그용 console.log가 남지 않도록 합니다.",
    pattern: /\bconsole\.(?:log|debug|trace)\s*\(/,
    severity: "HIGH",
    recommendation: "디버그 출력 대신 정규 로깅 프레임워크 또는 process.stderr.write를 사용하십시오.",
  },
  {
    id: "NO_HARDCODED_MAGIC_STRINGS",
    name: "하드코딩된 매직 주소/포트 사용 지양",
    description: "중요한 엔드포인트 주소나 포트 번호는 config 모듈 또는 상수로 분리해야 합니다.",
    pattern: /(?:localhost:4[0-9]{3}|127\.0\.0\.1:4[0-9]{3})/,
    severity: "MEDIUM",
    recommendation: "상수 값을 config 모듈 또는 환경 변수로 분리하십시오.",
  },
] as const;
