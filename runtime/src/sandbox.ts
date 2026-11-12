/**
 * 초경량 마이크로 샌드박스 가상 머신 (Micro Sandbox VM)
 * - 호스트 위험 API(process, fs, eval 등) 섀도잉 차단
 * - 타임아웃 가드 및 안전한 동적 스크립트 실행
 */
import { createContext, runInContext } from "node:vm";
import { RUNTIME_DEFAULTS, type SandboxConfig } from "./config";
import type { SandboxContext, SandboxExecutionResult } from "./types";

export class MicroSandboxVM {
  private readonly defaultTimeoutMs: number;
  private readonly disallowedGlobals: readonly string[];

  constructor(config: SandboxConfig = {}) {
    this.defaultTimeoutMs = config.timeoutMs ?? RUNTIME_DEFAULTS.TIMEOUT_MS;
    this.disallowedGlobals = config.disallowedGlobals ?? RUNTIME_DEFAULTS.DISALLOWED_GLOBALS;
  }

  /**
   * 샌드박스 내부에서 안전하게 자바스크립트 코드 실행
   */
  public execute<T = any>(
    code: string,
    injectedContext: SandboxContext = {},
    options?: { timeoutMs?: number }
  ): SandboxExecutionResult<T> {
    const start = performance.now();
    const timeout = options?.timeoutMs ?? this.defaultTimeoutMs;

    // 위험 전역 변수 차단 섀도잉 샌드박스 컨텍스트 생성
    const sandboxScope: Record<string, any> = {
      ...injectedContext,
      console: {
        log: () => {},
        warn: () => {},
        error: () => {},
      },
      Math,
      Date,
      JSON,
      String,
      Number,
      Boolean,
      Array,
      Object,
      Set,
      Map,
      RegExp,
    };

    for (const forbidden of this.disallowedGlobals) {
      sandboxScope[forbidden] = undefined;
    }

    try {
      const vmContext = createContext(sandboxScope);
      const output = runInContext(code, vmContext, {
        timeout,
        displayErrors: true,
      });

      const elapsed = performance.now() - start;
      return {
        ok: true,
        result: output as T,
        durationMs: Number(elapsed.toFixed(2)),
        timedOut: false,
      };
    } catch (err: any) {
      const elapsed = performance.now() - start;
      const isTimeout =
        err?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ||
        (err?.message && err.message.includes("timed out"));

      return {
        ok: false,
        durationMs: Number(elapsed.toFixed(2)),
        error: isTimeout ? `실행 제한 시간 초과 (${timeout}ms)` : err?.message || String(err),
        timedOut: Boolean(isTimeout),
      };
    }
  }

  /**
   * 함수 형태의 샌드박스 스크립트 실행 (인자 전달 지원)
   */
  public executeFunction<T = any, TArgs = any>(
    fnBody: string,
    args: TArgs,
    injectedContext: SandboxContext = {},
    options?: { timeoutMs?: number }
  ): SandboxExecutionResult<T> {
    const wrappedCode = `
      (function(input) {
        ${fnBody}
      })(input);
    `;

    return this.execute<T>(
      wrappedCode,
      { ...injectedContext, input: args },
      options
    );
  }
}
