/**
 * 8대 언어(TypeScript · Rust · C/C++ · Svelte · Java · C# · Go · Python) 자체 구조적 취약점 정적 감사기
 */
import type { GuardAuditReport, SecuritySeverity, SecurityViolation, SecurityViolationType } from "./types";

interface PitfallRule {
  readonly type: SecurityViolationType;
  readonly severity: SecuritySeverity;
  readonly pattern: RegExp;
  readonly description: string;
}

export const LANGUAGE_PITFALL_CONFIG = {
  TS_RULES: [
    {
      type: "TS_PROTOTYPE_POLLUTION",
      severity: "HIGH",
      pattern: /__proto__|constructor\s*\[\s*["']prototype["']\s*\]|Object\.prototype\./,
      description: "TypeScript/JS 프로토타입 체인 오염(__proto__/prototype) 위험 패턴 탐지",
    },
    {
      type: "TS_TYPE_ERASURE_BYPASS",
      severity: "MEDIUM",
      pattern: /\bas\s+any\b|\bas\s+unknown\s+as\b/,
      description: "런타임 타입 소거를 악화시키는 무검증 타입 단언(as any / as unknown as) 탐지",
    },
    {
      type: "TS_REDOS_RISK",
      severity: "HIGH",
      pattern: /new\s+RegExp\([^)]*(\(\s*[^)]*[\+\*][^)]*\)\s*[\+\*])|\/[^/\n]*\([^/\n]*[\+\*][^/\n]*\)[\+\*][^/\n]*\//,
      description: "싱글 스레드 이벤트 루프를 마비시킬 수 있는 중첩 수량자 ReDoS 패턴 탐지",
    },
  ] as const satisfies readonly PitfallRule[],
  RUST_RULES: [
    {
      type: "RUST_UNSAFE_BLOCK",
      severity: "HIGH",
      pattern: /\bunsafe\s*\{|std::mem::transmute|std::mem::forget/,
      description: "Rust 메모리 안전성 보증을 우회하는 unsafe / transmute / mem::forget 탐지",
    },
    {
      type: "RUST_INT_CAST_WRAP",
      severity: "MEDIUM",
      pattern: /\bas\s+(?:i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize)\b/,
      description: "절삭 및 음수 랩어라운드를 유발하는 무검증 'as' 정수 캐스팅 탐지 (try_from/checked_* 권장)",
    },
    {
      type: "RUST_PANIC_RISK",
      severity: "MEDIUM",
      pattern: /\.unwrap\s*\(|\.expect\s*\(/,
      description: "프로덕션 스레드 패닉 DoS를 유발할 수 있는 unwrap()/expect() 호출 탐지",
    },
  ] as const satisfies readonly PitfallRule[],
  CPP_RULES: [
    {
      type: "CPP_BUFFER_OVERFLOW",
      severity: "CRITICAL",
      pattern: /\b(?:strcpy|strcat|sprintf|vsprintf|gets)\s*\(/,
      description: "C/C++ 경계 미검사 버퍼 오버플로우 취약 함수 탐지 (strncpy/snprintf 권장)",
    },
    {
      type: "CPP_FORMAT_STRING",
      severity: "HIGH",
      pattern: /\b(?:printf|fprintf)\s*\(\s*[a-zA-Z_]\w*\s*\)/,
      description: "C/C++ 포맷 리터럴 누락 포맷 스트링 취약점 탐지",
    },
  ] as const satisfies readonly PitfallRule[],
  SVELTE_RULES: [
    {
      type: "SVELTE_RAW_HTML_XSS",
      severity: "HIGH",
      pattern: /\{@html\b/,
      description: "Svelte {@html} 원시 HTML 삽입으로 인한 DOM XSS 위험 탐지",
    },
  ] as const satisfies readonly PitfallRule[],
  JAVA_RULES: [
    {
      type: "JAVA_INSECURE_DESERIALIZE",
      severity: "CRITICAL",
      pattern: /\bObjectInputStream\b|\.readObject\s*\(/,
      description: "Java 안전하지 않은 역직렬화(RCE 가젯 체인) 위험 탐지",
    },
    {
      type: "JAVA_JNDI_OR_EXEC",
      severity: "HIGH",
      pattern: /\bInitialContext\b|Runtime\.getRuntime\(\)\.exec\s*\(/,
      description: "Java JNDI 인젝션 또는 Runtime.exec() 명령 실행 위험 탐지",
    },
    {
      type: "JAVA_XXE_RISK",
      severity: "HIGH",
      pattern: /DocumentBuilderFactory\.newInstance\s*\(/,
      description: "Java XML 파서 XXE(외부 엔터티) 방어 설정 누락 위험 탐지",
    },
  ] as const satisfies readonly PitfallRule[],
  CSHARP_RULES: [
    {
      type: "CSHARP_INSECURE_DESERIALIZE",
      severity: "CRITICAL",
      pattern: /\b(?:BinaryFormatter|NetDataContractSerializer)\b|TypeNameHandling\.All/,
      description: "C# 위험한 역직렬화(BinaryFormatter/TypeNameHandling.All) RCE 위험 탐지",
    },
    {
      type: "CSHARP_SQL_INTERPOLATION",
      severity: "HIGH",
      pattern: /FromSqlRaw\s*\(\s*\$"/,
      description: 'C# 문자열 보간($"") 기반 FromSqlRaw SQL Injection 위험 탐지',
    },
    {
      type: "CSHARP_SHELL_EXEC",
      severity: "HIGH",
      pattern: /UseShellExecute\s*=\s*true/,
      description: "C# ProcessStartInfo UseShellExecute=true 셸 명령 인젝션 위험 탐지",
    },
  ] as const satisfies readonly PitfallRule[],
  GO_RULES: [
    {
      type: "GO_UNSAFE_POINTER",
      severity: "HIGH",
      pattern: /\bunsafe\.Pointer\b/,
      description: "Go 메모리 안전성을 우회하는 unsafe.Pointer 사용 탐지",
    },
    {
      type: "GO_TEMPLATE_XSS",
      severity: "HIGH",
      pattern: /"text\/template"|template\.HTML\s*\(/,
      description: "Go HTML 자동 이스케이프가 비활성화되는 text/template 또는 template.HTML() 탐지",
    },
    {
      type: "GO_WEAK_RAND",
      severity: "MEDIUM",
      pattern: /"math\/rand"/,
      description: "Go 암호학적 비안전 난수(math/rand) 탐지 (보안 토큰엔 crypto/rand 권장)",
    },
  ] as const satisfies readonly PitfallRule[],
  PYTHON_RULES: [
    {
      type: "PY_INSECURE_DESERIALIZE",
      severity: "CRITICAL",
      pattern: /\b(?:pickle|marshal)\.loads?\s*\(|\byaml\.load\s*\(/,
      description: "Python 역직렬화 RCE 위험 함수(pickle/marshal/yaml.load) 탐지 (safe_load 권장)",
    },
    {
      type: "PY_SHELL_OR_EXEC",
      severity: "CRITICAL",
      pattern: /subprocess\.[a-zA-Z_]+\([^)]*shell\s*=\s*True|\b(?:eval|exec)\s*\(/,
      description: "Python shell=True 명령 인젝션 또는 eval()/exec() 동적 실행 탐지",
    },
    {
      type: "PY_ASSERT_SECURITY",
      severity: "LOW",
      pattern: /^assert\s+/,
      description: "Python -O 프로덕션 최적화 모드에서 삭제되는 assert 문 탐지",
    },
  ] as const satisfies readonly PitfallRule[],
} as const;

/**
 * 확장자별 규칙 매핑 테이블 (균일한 분기 처리)
 */
function resolveRulesByFileName(fileName: string): readonly PitfallRule[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".rs")) return LANGUAGE_PITFALL_CONFIG.RUST_RULES;
  if (lower.endsWith(".c") || lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".h") || lower.endsWith(".hpp")) {
    return LANGUAGE_PITFALL_CONFIG.CPP_RULES;
  }
  if (lower.endsWith(".svelte")) {
    return [...LANGUAGE_PITFALL_CONFIG.SVELTE_RULES, ...LANGUAGE_PITFALL_CONFIG.TS_RULES];
  }
  if (lower.endsWith(".java")) return LANGUAGE_PITFALL_CONFIG.JAVA_RULES;
  if (lower.endsWith(".cs")) return LANGUAGE_PITFALL_CONFIG.CSHARP_RULES;
  if (lower.endsWith(".go")) return LANGUAGE_PITFALL_CONFIG.GO_RULES;
  if (lower.endsWith(".py")) return LANGUAGE_PITFALL_CONFIG.PYTHON_RULES;
  return LANGUAGE_PITFALL_CONFIG.TS_RULES;
}

/**
 * 8대 언어 확장자 기반 언어별 자체 취약점 함정 정적 감사
 */
export function auditLanguagePitfalls(code: string, fileName: string = "source.ts"): GuardAuditReport {
  const violations: SecurityViolation[] = [];
  if (!code) {
    return { ok: true, totalViolations: 0, violations, timestampMs: Date.now() };
  }

  const rules = resolveRulesByFileName(fileName);
  const lines = code.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("#")) continue;

    for (const rule of rules) {
      if (rule.pattern.test(trimmed)) {
        violations.push({
          type: rule.type,
          severity: rule.severity,
          target: fileName,
          line: i + 1,
          description: rule.description,
          maskedSnippet: trimmed.slice(0, 120),
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    totalViolations: violations.length,
    violations,
    timestampMs: Date.now(),
  };
}
