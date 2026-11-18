/**
 * Synapse-Policy: 한국어/글로벌 개인정보(PII) 비식별화 & Human-in-the-Loop (HITL) 승인 게이트
 */
export const POLICY_CONFIG = {
  HIGH_RISK_ACTIONS: ["db:delete", "deploy", "payment", "external:send", "file:purge"] as const,
  PII_PATTERNS: [
    { kind: "RRN", regex: /\b\d{6}-[1-4]\d{6}\b/g },
    { kind: "PHONE", regex: /\b01[016789]-\d{3,4}-\d{4}\b/g },
    { kind: "CARD", regex: /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g },
    { kind: "EMAIL", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  ] as const,
} as const;

export interface PiiRedactionResult {
  readonly redactedText: string;
  readonly tokenMap: Readonly<Record<string, string>>;
  readonly redactionsCount: number;
}

export interface HitlActionRequest {
  readonly action: string;
  readonly actorId: string;
  readonly summary: string;
  readonly metadata?: Record<string, unknown>;
}

export interface HitlAuditEntry {
  readonly requestId: string;
  readonly action: string;
  readonly actorId: string;
  readonly riskLevel: "low" | "high";
  readonly approved: boolean;
  readonly reason: string;
  readonly timestampMs: number;
}

export type ApprovalCallback = (req: HitlActionRequest) => Promise<boolean> | boolean;

/**
 * LLM 전송 전 주민번호·휴대폰·카드·이메일 자동 비식별화 및 응답 복원
 */
export class PiiRedactor {
  public redact(input: string): PiiRedactionResult {
    let text = input;
    const tokenMap: Record<string, string> = {};
    let count = 0;

    for (const { kind, regex } of POLICY_CONFIG.PII_PATTERNS) {
      const re = new RegExp(regex.source, regex.flags);
      text = text.replace(re, (matched) => {
        count++;
        const token = `[PII_${kind}_${count}]`;
        tokenMap[token] = matched;
        return token;
      });
    }

    return {
      redactedText: text,
      tokenMap,
      redactionsCount: count,
    };
  }

  public unredact(text: string, tokenMap: Readonly<Record<string, string>>): string {
    let out = text;
    for (const [token, original] of Object.entries(tokenMap)) {
      out = out.split(token).join(original);
    }
    return out;
  }
}

/**
 * 고위험 도구 실행 전 Human-in-the-Loop(HITL) 승인 게이트 & 감사 로그
 */
export class HitlApprovalGate {
  private readonly highRiskSet: Set<string>;
  private readonly auditLogs: HitlAuditEntry[] = [];
  private readonly approvalHandler?: ApprovalCallback;

  constructor(options?: {
    extraHighRiskActions?: readonly string[];
    approvalHandler?: ApprovalCallback;
  }) {
    this.highRiskSet = new Set([
      ...POLICY_CONFIG.HIGH_RISK_ACTIONS,
      ...(options?.extraHighRiskActions ?? []),
    ]);
    this.approvalHandler = options?.approvalHandler;
  }

  public async authorize(req: HitlActionRequest): Promise<HitlAuditEntry> {
    const isHighRisk = this.highRiskSet.has(req.action);
    const requestId = `hitl-${this.auditLogs.length + 1}`;

    if (!isHighRisk) {
      const entry: HitlAuditEntry = {
        requestId,
        action: req.action,
        actorId: req.actorId,
        riskLevel: "low",
        approved: true,
        reason: "저위험 작업 자동 승인",
        timestampMs: Date.now(),
      };
      this.auditLogs.push(entry);
      return entry;
    }

    if (!this.approvalHandler) {
      const entry: HitlAuditEntry = {
        requestId,
        action: req.action,
        actorId: req.actorId,
        riskLevel: "high",
        approved: false,
        reason: "고위험 작업 승인 핸들러가 등록되지 않아 자동 차단되었습니다.",
        timestampMs: Date.now(),
      };
      this.auditLogs.push(entry);
      return entry;
    }

    const approved = await this.approvalHandler(req);
    const entry: HitlAuditEntry = {
      requestId,
      action: req.action,
      actorId: req.actorId,
      riskLevel: "high",
      approved,
      reason: approved ? "관리자 승인 완료" : "관리자 승인 거부",
      timestampMs: Date.now(),
    };
    this.auditLogs.push(entry);
    return entry;
  }

  public getAuditLogs(): readonly HitlAuditEntry[] {
    return this.auditLogs;
  }
}

/**
 * 하이브리드 보안·거버넌스 게이트:
 * 1) Fast-Path: 0-토큰 로컬 PII 마스킹 + 시크릿/취약점 검사
 * 2) Slow-Path: 고위험 액션일 때만 HITL 승인 콜백 호출
 */
export class HybridGovernanceGate {
  public readonly redactor = new PiiRedactor();
  public readonly hitl: HitlApprovalGate;

  constructor(options?: {
    extraHighRiskActions?: readonly string[];
    approvalHandler?: ApprovalCallback;
  }) {
    this.hitl = new HitlApprovalGate(options);
  }

  public async evaluateAndRedact(
    req: HitlActionRequest & { readonly payloadText: string; readonly secretDetector?: (text: string) => boolean }
  ): Promise<{
    allowed: boolean;
    redactedText: string;
    redactionsCount: number;
    hasSecretViolation: boolean;
    audit: HitlAuditEntry;
  }> {
    const pii = this.redactor.redact(req.payloadText);
    const hasSecretViolation = req.secretDetector ? req.secretDetector(pii.redactedText) : false;

    if (hasSecretViolation) {
      const blockedAudit: HitlAuditEntry = {
        requestId: `sec-block-${Date.now()}`,
        action: req.action,
        actorId: req.actorId,
        riskLevel: "high",
        approved: false,
        reason: "로컬 보안 가드에서 시크릿/취약점이 탐지되어 즉시 차단되었습니다.",
        timestampMs: Date.now(),
      };
      return {
        allowed: false,
        redactedText: pii.redactedText,
        redactionsCount: pii.redactionsCount,
        hasSecretViolation: true,
        audit: blockedAudit,
      };
    }

    const audit = await this.hitl.authorize(req);
    return {
      allowed: audit.approved,
      redactedText: pii.redactedText,
      redactionsCount: pii.redactionsCount,
      hasSecretViolation: false,
      audit,
    };
  }
}
