/**
 * 시냅스 보안 방화벽 (Synapse Guard) 종합 검증 스위트
 */
import { describe, it, expect } from "bun:test";
import { SynapseGuard } from "../src";

describe("🔒 Synapse Guard (AST 보안 방화벽 & 자격증명 유출 차단기) 검증", () => {
  const guard = new SynapseGuard();

  it("1. [자격증명 유출 차단] Discord 봇 토큰, npm 토큰, SSH 개인키 탐지 및 마스킹 검증", () => {
    // 1) 더미 Discord 봇 토큰 (정적 시크릿 스캐너 오탐 방지를 위한 런타임 결합)
    const dummyDiscordToken = ["MTIzNDU2Nzg5MDEyMzQ1Njc4", "Ga12bC", "123456789012345678901234567"].join(".");
    const dummyDiscordCode = `const token = "${dummyDiscordToken}";`;
    const res1 = guard.auditSource(dummyDiscordCode, "bot.ts");
    expect(res1.ok).toBe(false);
    expect(res1.violations[0].type).toBe("EXPOSED_SECRET");
    expect(res1.violations[0].description).toContain("Discord Bot Token");
    expect(res1.violations[0].maskedSnippet).toContain("MTIz***567");

    // 2) 더미 npm 토큰
    const dummyNpmToken = ["npm_", "1234567890abcdef1234567890abcdef1234"].join("");
    const dummyNpmCode = `const npmKey = "${dummyNpmToken}";`;
    const res2 = guard.auditSource(dummyNpmCode, "deploy.ts");
    expect(res2.ok).toBe(false);
    expect(res2.violations[0].description).toContain("npm Automation/Publish Token");

    // 3) 더미 SSH 개인키 헤더
    const dummySshCode = `const key = "-----BEGIN OPENSSH PRIVATE KEY-----";`;
    const res3 = guard.auditSource(dummySshCode, "server.ts");
    expect(res3.ok).toBe(false);
    expect(res3.violations[0].description).toContain("SSH / RSA Private Key");
  });

  it("2. [고엔트로피 비밀값 탐지] 무작위 고엔트로피 패스워드 탐지 검증", () => {
    const highEntropyCode = `const api_key = "k9#mP$2vL!8xQ&5zR*1wA@4bC";`;
    const report = guard.auditSource(highEntropyCode, "config.ts");
    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.description.includes("고엔트로피"))).toBe(true);
  });

  it("3. [SQL Injection 차단] 문자열 연결형 SELECT 질의문 정적 차단 검증", () => {
    const vulnCode = `
      function getUser(userId) {
        const query = "SELECT * FROM users WHERE id = '" + userId + "'";
        return db.query(query);
      }
    `;
    const report = guard.auditSource(vulnCode, "userDao.ts");
    expect(report.ok).toBe(false);
    expect(report.violations[0].type).toBe("SQL_INJECTION");
    expect(report.violations[0].description).toContain("SQL Injection");
  });

  it("4. [위험 코드 실행 차단] eval() 및 new Function() 패턴 차단 검증", () => {
    const unsafeCode = `
      const result = eval("2 + 2");
      const fn = new Function("a", "return a * 2");
    `;
    const report = guard.auditSource(unsafeCode, "evalTest.ts");
    expect(report.ok).toBe(false);
    expect(report.violations.length).toBe(2);
    expect(report.violations[0].type).toBe("UNSAFE_EVAL");
    expect(report.violations[1].type).toBe("UNSAFE_EVAL");
  });

  it("5. [볼트 XSS 새니타이징] 마크다운 내 악성 <script> 태그 및 의사 스키마 제거 검증", () => {
    const dirtyMd = `
# 제목
<script>alert("hacked");</script>
본문 내용
<a href="javascript:doEvil()">악성 링크</a>
<img src="avatar.png" onerror="stealCookie()" />
    `;

    const { cleanContent, report } = guard.auditAndSanitizeVault(dirtyMd, "memo.md");
    expect(report.ok).toBe(false);
    expect(report.violations.length).toBeGreaterThanOrEqual(3);
    expect(cleanContent).not.toContain("<script>");
    expect(cleanContent).not.toContain("alert(");
    expect(cleanContent).not.toContain("javascript:");
    expect(cleanContent).not.toContain("onerror=");
    expect(cleanContent).toContain("본문 내용");
  });

  it("6. [assertClean 엄격 모드] 위반 코드 시 예외 발생 및 안전 코드 통과 검증", () => {
    const safeCode = `
      export function add(a: number, b: number): number {
        return a + b;
      }
    `;
    expect(() => guard.assertClean(safeCode, "safe.ts")).not.toThrow();

    const dangerCode = `eval("danger()");`;
    expect(() => guard.assertClean(dangerCode, "danger.ts")).toThrow();
  });
});
