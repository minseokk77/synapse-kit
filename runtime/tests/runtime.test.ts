/**
 * 시냅스 마이크로 샌드박스 런타임 (Synapse Runtime) 종합 검증 스위트
 */
import { describe, it, expect } from "bun:test";
import { SynapseRuntime } from "../src";

describe("⚙️ Synapse Runtime (마이크로 샌드박스 VM 격리 실행기) 검증", () => {
  const runtime = new SynapseRuntime({ timeoutMs: 500 });

  it("1. [기본 격리 실행] 산술 연산 및 순수 자바스크립트 정상 실행 검증", () => {
    const code = `
      const a = 10;
      const b = 25;
      a * b + 5;
    `;
    const res = runtime.run<number>(code);
    expect(res.ok).toBe(true);
    expect(res.result).toBe(255);
    expect(res.timedOut).toBe(false);
  });

  it("2. [호스트 위험 API 차단] process, Bun, require 접근 차단 검증", () => {
    const code = `
      ({
        hasProcess: typeof process !== "undefined" && process !== null,
        hasBun: typeof Bun !== "undefined" && Bun !== null,
      })
    `;
    const res = runtime.run<{ hasProcess: boolean; hasBun: boolean }>(code);
    expect(res.ok).toBe(true);
    expect(res.result?.hasProcess).toBe(false);
    expect(res.result?.hasBun).toBe(false);
  });

  it("3. [무한 루프 타임아웃 차단] while(true) 시 지정 시간 내 강제 중단 검증", () => {
    const infiniteLoopCode = `
      while (true) {}
    `;
    const res = runtime.run(infiniteLoopCode, {}, { timeoutMs: 50 });
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(res.error).toContain("제한 시간 초과");
  });

  it("4. [함수형 실행 및 인자 주입] input 전달 및 가공 결과 반환 검증", () => {
    const fnBody = `
      return input.items.map(x => x * 2).filter(x => x > 10);
    `;
    const res = runtime.runFunction<number[], { items: number[] }>(fnBody, {
      items: [2, 5, 8, 12],
    });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual([16, 24]);
  });

  it("5. [커스텀 컨텍스트 주입] 주입된 안전한 API 함수 정상 호출 검증", () => {
    const customHelper = (name: string) => `안녕하세요, ${name}님!`;
    const code = `
      greet("시냅스");
    `;
    const res = runtime.run<string>(code, { greet: customHelper });
    expect(res.ok).toBe(true);
    expect(res.result).toBe("안녕하세요, 시냅스님!");
  });
});
