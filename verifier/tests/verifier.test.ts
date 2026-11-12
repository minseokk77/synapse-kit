/**
 * 시냅스 인과 불변식 검증기 (Synapse Verifier) 종합 검증 스위트
 */
import { describe, it, expect } from "bun:test";
import { SynapseVerifier, ContinuousVerifier } from "../src";

describe("🛡️ Synapse Verifier (인과 불변식 자율 검증기 & 무결성 리포터) 검증", () => {
  const verifier = new SynapseVerifier();

  it("1. [불변식: npm 금지 & bun 강제] npm 명령어 탐지 및 치명적 위반 검증", () => {
    const badNpmScript = `
      const build = () => {
        exec("npm run build");
      };
    `;
    const res = verifier.checkSource(badNpmScript, "build.ts");
    expect(res.ok).toBe(false);
    expect(res.violations[0].ruleId).toBe("NO_NPM_BUN_REQUIRED");
    expect(res.violations[0].severity).toBe("CRITICAL");
    expect(res.violations[0].recommendation).toContain("bun");
  });

  it("2. [불변식: 파이썬 금지] Python 실행 및 확장자 탐지 검증", () => {
    const badPyScript = `
      function runAi() {
        exec("python3 script.py");
      }
    `;
    const res = verifier.checkSource(badPyScript, "runner.ts");
    expect(res.ok).toBe(false);
    expect(res.violations[0].ruleId).toBe("NO_PYTHON_RUST_REQUIRED");
    expect(res.violations[0].severity).toBe("CRITICAL");
    expect(res.violations[0].recommendation).toContain("Rust");
  });

  it("3. [불변식: console.log 금지] 디버그 출력 탐지 검증", () => {
    const debugCode = `
      export function calc(a: number): number {
        console.log("debug value:", a);
        return a * 2;
      }
    `;
    const res = verifier.checkSource(debugCode, "calc.ts");
    expect(res.ok).toBe(false);
    expect(res.violations[0].ruleId).toBe("NO_CONSOLE_LOG_DEBUG");
    expect(res.violations[0].severity).toBe("HIGH");
  });

  it("4. [런타임 그래프 대칭성 검증] 양방향 시냅스 대칭성 100% 무결성 증명", () => {
    const outgoing = new Map<string, Set<string>>([
      ["docs/a", new Set(["docs/b"])],
    ]);
    const incoming = new Map<string, Set<string>>([
      ["docs/b", new Set(["docs/a"])],
    ]);
    const existing = new Set(["docs/a", "docs/b"]);

    const res = verifier.verifyGraphSymmetry({
      outgoingEdges: outgoing,
      incomingEdges: incoming,
      existingNodeIds: existing,
    });

    expect(res.ok).toBe(true);
    expect(res.brokenOutgoing.length).toBe(0);
    expect(res.brokenIncoming.length).toBe(0);
  });

  it("5. [런타임 비대칭 및 고아 노드 탐지] 간선 비대칭 정확 탐지", () => {
    // docs/a -> docs/b는 있으나 b의 incoming에 a가 누락된 경우
    const outgoing = new Map<string, Set<string>>([
      ["docs/a", new Set(["docs/b"])],
    ]);
    const incoming = new Map<string, Set<string>>([
      ["docs/b", new Set()],
    ]);
    const existing = new Set(["docs/a", "docs/b"]);

    const res = verifier.verifyGraphSymmetry({
      outgoingEdges: outgoing,
      incomingEdges: incoming,
      existingNodeIds: existing,
    });

    expect(res.ok).toBe(false);
    expect(res.brokenOutgoing).toContain("docs/a->docs/b");
  });

  it("6. [한국어 보고서 포맷팅 및 assertIntegrity] 진단 마크다운 생성 및 예외 검증", () => {
    const files = {
      "clean.ts": "export const value = 42;",
      "dirty.ts": "console.log('bad');",
    };

    const summary = verifier.verifyFiles(files);
    expect(summary.ok).toBe(false);
    expect(summary.totalViolationsCount).toBe(1);

    const report = verifier.generateReport(summary);
    expect(report).toContain("Synapse 인과 불변식 및 코드 무결성 검증 보고서");
    expect(report).toContain("FAILED");
    expect(report).toContain("NO_CONSOLE_LOG_DEBUG");

    expect(() => verifier.assertIntegrity(files)).toThrow();
  });

  it("7. [연속 불변식 감시자: ContinuousVerifier] 실시간 스트림 감시 및 위반 누적/리셋 검증", () => {
    const watcher = new ContinuousVerifier();
    expect(watcher.getViolationCount()).toBe(0);

    // 정상 상태 검사
    const normalGraph = {
      outgoingEdges: new Map([["nodeA", new Set(["nodeB"])]]),
      incomingEdges: new Map([["nodeB", new Set(["nodeA"])]]),
      existingNodeIds: new Set(["nodeA", "nodeB"]),
    };
    const res1 = watcher.check(normalGraph);
    expect(res1.ok).toBe(true);
    expect(watcher.getViolationCount()).toBe(0);

    // 비정상(결함) 상태 검사: 대칭성 파괴
    const brokenGraph = {
      outgoingEdges: new Map([["nodeA", new Set(["nodeB"])]]),
      incomingEdges: new Map([["nodeB", new Set<string>()]]),
      existingNodeIds: new Set(["nodeA", "nodeB"]),
    };
    const res2 = watcher.check(brokenGraph);
    expect(res2.ok).toBe(false);
    expect(watcher.getViolationCount()).toBe(1);

    // 두 번째 결함 발생
    watcher.check(brokenGraph);
    expect(watcher.getViolationCount()).toBe(2);

    // 리셋 검증
    watcher.reset();
    expect(watcher.getViolationCount()).toBe(0);
  });
});
