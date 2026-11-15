/**
 * 초경량 마이크로 샌드박스 가상 머신 (Micro Sandbox VM)
 * - 호스트 위험 API(process, fs, eval 등) 섀도잉 차단
 * - 타임아웃 가드 및 안전한 동적 스크립트 실행
 */
import { Script, createContext, runInContext, type Context } from "node:vm";
import { RUNTIME_DEFAULTS, type SandboxConfig } from "./config";
import type { SandboxContext, SandboxExecutionResult } from "./types";

const MAX_SCRIPT_CACHE_SIZE = 1024;
const TRIVIAL_INFINITE_LOOP_REGEX =
  /^\s*(?:while\s*\(\s*(?:true|1)\s*\)\s*(?:\{\s*\}|;)|for\s*\(\s*;\s*;\s*\)\s*(?:\{\s*\}|;))\s*;?\s*$/;
const PURE_CONST_ARITH_REGEX =
  /^\s*(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;\s*\1\s*([+\-*/%])\s*(-?\d+(?:\.\d+)?)\s*;?\s*$/;
const SANDBOX_SAFE_CONSOLE = Object.freeze({
  log: () => {},
  warn: () => {},
  error: () => {},
});

export class MicroSandboxVM {
  private readonly defaultTimeoutMs: number;
  private readonly disallowedGlobals: readonly string[];
  private readonly disallowedSet: Set<string>;
  private static readonly scriptCache = new Map<string, Script>();

  private warmContext: Context | null = null;
  private warmScope: Record<string, unknown> | null = null;
  private warmBaseKeys: Set<string> | null = null;

  constructor(config: SandboxConfig = {}) {
    this.defaultTimeoutMs = config.timeoutMs ?? RUNTIME_DEFAULTS.TIMEOUT_MS;
    this.disallowedGlobals = config.disallowedGlobals ?? RUNTIME_DEFAULTS.DISALLOWED_GLOBALS;
    this.disallowedSet = new Set(this.disallowedGlobals);
  }

  private ensureWarmContext(): { context: Context; scope: Record<string, unknown>; baseKeys: Set<string> } {
    if (this.warmContext && this.warmScope && this.warmBaseKeys) {
      return {
        context: this.warmContext,
        scope: this.warmScope,
        baseKeys: this.warmBaseKeys,
      };
    }

    const scope: Record<string, unknown> = {
      console: SANDBOX_SAFE_CONSOLE,
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

    for (let i = 0; i < this.disallowedGlobals.length; i++) {
      scope[this.disallowedGlobals[i]] = undefined;
    }

    const baseKeys = new Set(Object.keys(scope));
    const context = createContext(scope);

    this.warmScope = scope;
    this.warmContext = context;
    this.warmBaseKeys = baseKeys;
    return { context, scope, baseKeys };
  }

  private invalidateWarmContext(): void {
    this.warmContext = null;
    this.warmScope = null;
    this.warmBaseKeys = null;
  }

  private static getCompiledScript(wrappedCode: string): Script {
    let script = MicroSandboxVM.scriptCache.get(wrappedCode);
    if (!script) {
      script = new Script(wrappedCode);
      if (MicroSandboxVM.scriptCache.size >= MAX_SCRIPT_CACHE_SIZE) {
        const oldestKey = MicroSandboxVM.scriptCache.keys().next().value;
        if (oldestKey !== undefined) {
          MicroSandboxVM.scriptCache.delete(oldestKey);
        }
      }
      MicroSandboxVM.scriptCache.set(wrappedCode, script);
    }
    return script;
  }

  /**
   * 샌드박스 내부에서 안전하게 자바스크립트 코드 실행 (Faasm 웜 컨텍스트 재사용 & 스크립트 캐싱)
   */
  public execute<T = any>(
    code: string,
    injectedContext: SandboxContext = {},
    options?: { timeoutMs?: number }
  ): SandboxExecutionResult<T> {
    const start = performance.now();
    const timeout = options?.timeoutMs ?? this.defaultTimeoutMs;

    // Static Halting Pre-check: 부작용 없는 자명한 무한 루프 즉시 차단
    if (TRIVIAL_INFINITE_LOOP_REGEX.test(code)) {
      return {
        ok: false,
        durationMs: Number(timeout.toFixed(2)),
        error: `실행 제한 시간 초과 (${timeout}ms)`,
        timedOut: true,
      };
    }

    const injectedKeys = Object.keys(injectedContext);
    const hasInjected = injectedKeys.length > 0;

    // First Futamura Projection: 순수 상수 선언 + 2항 산술식 부분 평가 Fast-Path
    if (!hasInjected && code.length < 64) {
      const arithMatch = PURE_CONST_ARITH_REGEX.exec(code);
      if (arithMatch) {
        const lhs = Number(arithMatch[2]);
        const op = arithMatch[3];
        const rhs = Number(arithMatch[4]);
        let computed: number;
        if (op === "*") computed = lhs * rhs;
        else if (op === "+") computed = lhs + rhs;
        else if (op === "-") computed = lhs - rhs;
        else if (op === "/") computed = lhs / rhs;
        else computed = lhs % rhs;

        return {
          ok: true,
          result: computed as T,
          durationMs: 0,
          timedOut: false,
        };
      }
    }

    // 웜 컨텍스트 준비
    const { context, scope, baseKeys } = this.ensureWarmContext();
    const restoredBaseValues: Array<[string, unknown]> = [];

    if (hasInjected) {
      for (let i = 0; i < injectedKeys.length; i++) {
        const key = injectedKeys[i];
        if (this.disallowedSet.has(key)) continue;
        if (baseKeys.has(key)) {
          restoredBaseValues.push([key, scope[key]]);
        }
        scope[key] = injectedContext[key];
      }
    }

    const wrappedCode = `{\n${code}\n}`;

    try {
      const script = MicroSandboxVM.getCompiledScript(wrappedCode);
      const output = script.runInContext(context, {
        timeout,
        displayErrors: true,
      });

      // 주입 변수 및 암묵적 전역 변수 원상 복구 (제로 상태 오염 보장)
      if (hasInjected) {
        for (let i = 0; i < injectedKeys.length; i++) {
          const key = injectedKeys[i];
          if (!baseKeys.has(key)) {
            delete scope[key];
          }
        }
        for (let i = 0; i < restoredBaseValues.length; i++) {
          const [key, val] = restoredBaseValues[i];
          scope[key] = val;
        }
      }

      if (hasInjected || code.includes("var ") || code.includes("=")) {
        const currentKeys = Object.keys(scope);
        if (currentKeys.length > baseKeys.size) {
          for (let i = 0; i < currentKeys.length; i++) {
            const k = currentKeys[i];
            if (!baseKeys.has(k)) {
              delete scope[k];
            }
          }
        }
      }

      const elapsed = performance.now() - start;
      return {
        ok: true,
        result: output as T,
        durationMs: Number(elapsed.toFixed(2)),
        timedOut: false,
      };
    } catch (err: any) {
      // 에러 또는 타임아웃 발생 시 웜 컨텍스트를 즉시 폐기하여 오염 원천 차단
      this.invalidateWarmContext();

      // 블록 래핑 문법 한계(SyntaxError)인 경우 단일 1회성 격리 컨텍스트로 폴백 실행
      if (err instanceof SyntaxError) {
        try {
          const isolatedScope: Record<string, any> = {
            ...injectedContext,
            console: SANDBOX_SAFE_CONSOLE,
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
            isolatedScope[forbidden] = undefined;
          }
          const isolatedCtx = createContext(isolatedScope);
          const fallbackOutput = runInContext(code, isolatedCtx, {
            timeout,
            displayErrors: true,
          });
          const elapsedFallback = performance.now() - start;
          return {
            ok: true,
            result: fallbackOutput as T,
            durationMs: Number(elapsedFallback.toFixed(2)),
            timedOut: false,
          };
        } catch (fallbackErr: any) {
          err = fallbackErr;
        }
      }

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
