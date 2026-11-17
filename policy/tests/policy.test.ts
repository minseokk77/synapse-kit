import { describe, expect, it } from "bun:test";
import { HitlApprovalGate, PiiRedactor } from "../index";

describe("🛡️ Synapse-Policy 검증", () => {
  it("1. 한국어 PII(주민번호·휴대폰·카드·이메일) 자동 비식별화 및 복원", () => {
    const redactor = new PiiRedactor();
    const raw = "고객 홍길동(900101-1234567), 연락처 010-1234-5678, 카드 1234-5678-9012-3456, user@example.com";
    const res = redactor.redact(raw);

    expect(res.redactionsCount).toBe(4);
    expect(res.redactedText).not.toContain("900101-1234567");
    expect(res.redactedText).not.toContain("010-1234-5678");
    expect(redactor.unredact(res.redactedText, res.tokenMap)).toBe(raw);
  });

  it("2. 고위험 액션 HITL 승인 게이트 차단 및 승인 로깅", async () => {
    const gateNoHandler = new HitlApprovalGate();
    const blocked = await gateNoHandler.authorize({
      action: "db:delete",
      actorId: "agent-1",
      summary: "운영 테이블 삭제 시도",
    });
    expect(blocked.approved).toBe(false);

    const gateWithHandler = new HitlApprovalGate({
      approvalHandler: async (req) => req.actorId === "admin-agent",
    });
    const ok = await gateWithHandler.authorize({
      action: "deploy",
      actorId: "admin-agent",
      summary: "v0.1.0 배포",
    });
    expect(ok.approved).toBe(true);
    expect(gateWithHandler.getAuditLogs().length).toBe(1);
  });
});
