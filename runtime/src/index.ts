/**
 * 시냅스 마이크로 샌드박스 런타임 통합 파사드 (Synapse Runtime Façade)
 */
import { MicroSandboxVM } from "./sandbox";
import type { SandboxConfig } from "./config";
import type { SandboxContext, SandboxExecutionResult } from "./types";

export class SynapseRuntime {
  public readonly vm: MicroSandboxVM;

  constructor(config: SandboxConfig = {}) {
    this.vm = new MicroSandboxVM(config);
  }

  /**
   * 샌드박스 코드 실행
   */
  public run<T = any>(
    code: string,
    context?: SandboxContext,
    options?: { timeoutMs?: number }
  ): SandboxExecutionResult<T> {
    return this.vm.execute<T>(code, context, options);
  }

  /**
   * 함수 형태의 샌드박스 스크립트 실행
   */
  public runFunction<T = any, TArgs = any>(
    fnBody: string,
    args: TArgs,
    context?: SandboxContext,
    options?: { timeoutMs?: number }
  ): SandboxExecutionResult<T> {
    return this.vm.executeFunction<T, TArgs>(fnBody, args, context, options);
  }
}

export * from "./config";
export * from "./types";
export * from "./sandbox";
