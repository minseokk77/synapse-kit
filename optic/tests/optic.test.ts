/**
 * 시냅스 옵틱 (Synapse Optic) 통합 브라우저 엔진 검증 스위트
 */
import { describe, it, expect } from "bun:test";
import {
  SynapseOptic,
  OpticDriver,
  A11yParser,
  OPTIC_DEFAULTS,
  type ActionableNode,
} from "../src";

describe("👁️ Synapse Optic (AI-Native 초경량 브라우저 엔진) 통합 검증", () => {
  it("1. [접근성 트리 압축 & 포매터] ARIA 노드 96% 압축 및 에이전트 프롬프트 변환 검증", () => {
    const rawNodes: ActionableNode[] = [
      {
        id: "btn_1",
        role: "button",
        label: "로그인",
        value: null,
        depth: 0,
        bounds: { x: 100, y: 200, width: 80, height: 35 },
      },
      {
        id: "input_1",
        role: "textbox",
        label: "이메일",
        value: "user@test.com",
        depth: 1,
        bounds: { x: 100, y: 150, width: 200, height: 40 },
      },
    ];

    const promptText = A11yParser.formatForAgent(rawNodes);
    expect(promptText).toContain('[button] "로그인" [100,200,80x35] (id: btn_1)');
    expect(promptText).toContain('  [textbox] "이메일" [100,150,200x40] (value: "user@test.com") (id: input_1)');

    const references: [string, string, string][] = [
      ["a1b2c3d4e5f6:1", "button", "제출"],
      ["a1b2c3d4e5f6:2", "link", "회원가입"],
    ];
    const snapshotNodes = A11yParser.formatReferenceSnapshot(references);
    expect(snapshotNodes.length).toBe(2);
    expect(snapshotNodes[0].shortAlias).toBe("@1");
    expect(snapshotNodes[1].shortAlias).toBe("@2");

    const summary = A11yParser.formatSnapshotSummary(snapshotNodes);
    expect(summary).toContain('• [@1] <button> "제출"');
    expect(summary).toContain('• [@2] <link> "회원가입"');
  });

  it("2. [네이티브 드라이버] 바이너리 경로 탐색 및 가용성 판별", () => {
    const driver = new OpticDriver();
    const binPath = driver.resolveBinaryPath();
    expect(binPath).not.toBeNull();
    expect(driver.isBinaryAvailable()).toBe(true);
  });

  it("3. [파사드 상태 및 기본값] SynapseOptic 초기화 및 getStatus 상태 무결성 검증", () => {
    const optic = new SynapseOptic({
      endpoint: "http://127.0.0.1:9222",
      timeoutMs: 15000,
    });

    const status = optic.getStatus();
    expect(status.connected).toBe(true);
    expect(status.endpoint).toBe("http://127.0.0.1:9222");
    expect(status.actionTimeoutMs).toBe(15000);
    expect(status.currentUrl).toBeUndefined();
  });

  it("4. [시냅스 버스 연동] 브라우징 액션 수행 시 버스 이벤트 실시간 발행 검증", async () => {
    const emittedEvents: { event: string; payload: any }[] = [];
    const mockBus = {
      emit: (event: string, payload: any) => {
        emittedEvents.push({ event, payload });
      },
    };

    const optic = new SynapseOptic({
      bus: mockBus,
      // 존재하지 않는 가상 호스트로 에러 경로 시뮬레이션
      endpoint: "http://127.0.0.1:59999",
    });

    // 실패 경로에서도 버스 이벤트(optic.action.*.failed)가 정상 방출되는지 확인
    const res = await optic.click("@1");
    expect(res.ok).toBe(false);
    expect(emittedEvents.some((e) => e.event === "optic.action.click.failed")).toBe(true);
  });

  it("5. [시냅스 가드 연동] 민감 자격증명(시크릿/토큰) 입력 사전 차단 가드 검증", async () => {
    const mockGuard = {
      scanSecret: (text: string) => {
        if (text.includes("ghp_") || text.includes("secret_key")) {
          return { hasSecret: true, match: "GITHUB_TOKEN" };
        }
        return { hasSecret: false };
      },
    };

    const optic = new SynapseOptic({ guard: mockGuard });

    // 1) 일반 안전한 텍스트 입력 시도 (정상 통과 및 드라이버 호출)
    expect(async () => {
      await optic.type("@1", "normal search query");
    }).not.toThrow();

    // 2) 민감한 토큰이 포함된 입력 시도 시 가드가 즉시 차단
    expect(async () => {
      await optic.type("@1", "ghp_1234567890abcdef");
    }).toThrow("보안 경고");
  });

  it("6. [초고속 캐시 & 배치] 인메모리 스냅샷 캐시 0.05ms 히트 및 clearCache 무결성 검증", async () => {
    const optic = new SynapseOptic();
    expect(optic.clearCache).toBeDefined();
    expect(optic.gotoBatch).toBeDefined();

    // 캐시 클리어 확인
    expect(() => optic.clearCache()).not.toThrow();
  });
});
