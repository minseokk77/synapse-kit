/**
 * 시냅스 ActGuard 사전 실행 액션 감사기 (Pre-execution Action Auditor)
 * - arXiv:2609.14987 (ActGuard) 대조 스팬 정밀 마스킹 및 도구 사전 분포(Tool Prior) 검증
 * - arXiv:2609.04495 (Test-Time Search IPI) 적응형 변종 간접 프롬프트 인젝션 패턴 탐지
 */

export const ACT_GUARD_CONFIG = {
  /** 도구 호출 이탈 위험 임계 점수 */
  DEVIATION_BLOCK_THRESHOLD: 0.7,
  /** 마스킹 치환 토큰 */
  REDACTION_MARKER: "[ACTGUARD_SPAN_REDACTED]",
  /** 비가시적 제로폭 문자 정규식 */
  ZERO_WIDTH_PATTERN: /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,
  /** 간접 프롬프트 인젝션(IPI) 탐지 규칙 */
  IPI_SPAN_PATTERNS: [
    {
      category: "ROLE_OVERRIDE",
      weight: 0.85,
      pattern: /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|prompts?)/gi,
    },
    {
      category: "TOOL_HIJACK",
      weight: 0.9,
      pattern: /(?:instead|now)\s+(?:call|invoke|execute|run)\s+(?:tool|command|shell|bash|curl|fetch)\b[^.\n]{0,120}/gi,
    },
    {
      category: "HIDDEN_DIRECTIVE",
      weight: 0.8,
      pattern: /(?:<!--[\s\S]{0,300}?(?:system|assistant|instruction|execute|secret|token)[\s\S]{0,300}?-->|<important>[\s\S]{0,300}?<\/important>)/gi,
    },
    {
      category: "EXFILTRATION_PROBE",
      weight: 0.95,
      pattern: /(?:exfiltrate|leak|send|post|upload)\s+(?:all\s+)?(?:env|secret|token|key|password|credential|ssh)[^\n.!?]{0,120}[.!?]?/gi,
    },
    {
      category: "ADAPTIVE_SMUGGLING",
      weight: 0.75,
      pattern: /(?:override_policy|bypass_guard|sudo_mode|developer_override)\s*[:=]/gi,
    },
  ],
  /** 고위험 도구 목록 (사전 분포 이탈 시 즉시 차단 대상) */
  HIGH_RISK_TOOLS: new Set<string>([
    "shell_exec",
    "run_command",
    "bash",
    "fs_delete",
    "rm",
    "http_post",
    "exfiltrate",
  ]),
} as const;

export interface ActionAuditInput {
  /** 호출 예정 도구명 또는 Optic 액션 */
  readonly toolName: string;
  /** 도구 인자 또는 대상 셀렉터 */
  readonly args?: Record<string, unknown>;
  /** 관측 컨텍스트 (웹 ARIA/문서 본문 등) */
  readonly observationContext?: string;
  /** 현재 태스크에서 허용된 사전 도구 분포(Tool Prior) */
  readonly expectedTools?: readonly string[];
}

export interface ActionAuditSpan {
  readonly category: string;
  readonly matchedText: string;
  readonly weight: number;
}

export interface ActionAuditResult {
  readonly allowed: boolean;
  readonly riskScore: number;
  readonly toolPriorMismatch: boolean;
  readonly detectedSpans: readonly ActionAuditSpan[];
  readonly sanitizedContext: string;
  readonly reason: string;
}

/**
 * 실행 직전 도구 호출 및 관측 컨텍스트 대조 감사기
 */
export class ActGuardActionAuditor {
  private readonly blockThreshold: number;

  constructor(blockThreshold: number = ACT_GUARD_CONFIG.DEVIATION_BLOCK_THRESHOLD) {
    this.blockThreshold = blockThreshold;
  }

  /**
   * 도구 호출 전 의도 이탈 여부 및 악성 스팬 정밀 정화 수행
   */
  public auditBeforeExecution(input: ActionAuditInput): ActionAuditResult {
    try {
      const detectedSpans: ActionAuditSpan[] = [];
      let maxRisk = 0;

      // 1. 도구 사전 분포(Tool Prior) 이탈 점검
      const normalizedTool = input.toolName.trim();
      const toolPriorMismatch =
        Array.isArray(input.expectedTools) &&
        input.expectedTools.length > 0 &&
        !input.expectedTools.includes(normalizedTool);

      if (toolPriorMismatch) {
        maxRisk = Math.max(
          maxRisk,
          ACT_GUARD_CONFIG.HIGH_RISK_TOOLS.has(normalizedTool) ? 1.0 : 0.75
        );
      }

      // 2. 관측 컨텍스트 내 비가시 문자 및 적응형 IPI 스팬 정밀 탐지/마스킹
      let sanitized = (input.observationContext ?? "").replace(
        ACT_GUARD_CONFIG.ZERO_WIDTH_PATTERN,
        ""
      );

      for (const rule of ACT_GUARD_CONFIG.IPI_SPAN_PATTERNS) {
        rule.pattern.lastIndex = 0;
        sanitized = sanitized.replace(rule.pattern, (match) => {
          detectedSpans.push({
            category: rule.category,
            matchedText: match,
            weight: rule.weight,
          });
          maxRisk = Math.max(maxRisk, rule.weight);
          return ACT_GUARD_CONFIG.REDACTION_MARKER;
        });
      }

      // 3. 인자 직렬화 텍스트에 대한 스팬 검사
      if (input.args) {
        const serializedArgs = JSON.stringify(input.args);
        for (const rule of ACT_GUARD_CONFIG.IPI_SPAN_PATTERNS) {
          rule.pattern.lastIndex = 0;
          const m = rule.pattern.exec(serializedArgs);
          if (m) {
            detectedSpans.push({
              category: `${rule.category}_IN_ARGS`,
              matchedText: m[0],
              weight: Math.min(1.0, rule.weight + 0.1),
            });
            maxRisk = Math.max(maxRisk, Math.min(1.0, rule.weight + 0.1));
          }
        }
      }

      const argsPoisoned = detectedSpans.some((s) => s.category.endsWith("_IN_ARGS"));
      const blockedByPrior = toolPriorMismatch && maxRisk >= this.blockThreshold;
      const allowed = !blockedByPrior && !argsPoisoned && (detectedSpans.length === 0 || !toolPriorMismatch);

      const reason = !allowed
        ? toolPriorMismatch
          ? `도구 사전 분포 이탈 차단: '${normalizedTool}' 호출이 허용된 사전 목록에 없습니다.`
          : `도구 인자 내 간접 프롬프트 인젝션(IPI) 탐지로 실행을 차단했습니다.`
        : detectedSpans.length > 0
          ? `관측 컨텍스트 내 악성 스팬 ${detectedSpans.length}건을 정밀 마스킹하고 정상 컨텍스트를 보존했습니다.`
          : "사전 실행 액션 감사 통과 (이탈 없음)";

      return {
        allowed,
        riskScore: Number(maxRisk.toFixed(2)),
        toolPriorMismatch,
        detectedSpans,
        sanitizedContext: sanitized,
        reason,
      };
    } catch (err: any) {
      return {
        allowed: false,
        riskScore: 1,
        toolPriorMismatch: true,
        detectedSpans: [],
        sanitizedContext: "",
        reason: `사전 실행 감사 중 오류 발생으로 안전 차단: ${err?.message || err}`,
      };
    }
  }
}
