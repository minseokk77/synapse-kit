/**
 * Synapse-Runtime Hybrid Sandbox: MicroSandboxVM + SandboxOverlayFS + Verifier 통합 커밋
 */
import { MicroSandboxVM } from "./sandbox";
import { SandboxOverlayFS, type OverlayFileDiff } from "./overlayFs";
import type { SandboxExecutionResult } from "./types";

export interface HybridSandboxStageOptions {
  readonly writes: Readonly<Record<string, string>>;
  readonly evalScript?: string;
  readonly verifier?: (
    diffs: readonly OverlayFileDiff[],
    readOverlay: (relPath: string) => string
  ) => Promise<boolean> | boolean;
}

export interface HybridSandboxOutcome {
  readonly committed: boolean;
  readonly diffsCount: number;
  readonly evalResult?: SandboxExecutionResult<unknown>;
  readonly committedWrites: number;
}

/**
 * 가상 CoW 오버레이에 파일 수정 스테이징 -> VM 샌드박스 검증 -> Verifier 통과 시에만 디스크 커밋
 */
export class HybridCodeSandbox {
  public readonly overlay: SandboxOverlayFS;
  public readonly vm: MicroSandboxVM;

  constructor(rootDir: string, timeoutMs?: number) {
    this.overlay = new SandboxOverlayFS(rootDir);
    this.vm = new MicroSandboxVM({ timeoutMs });
  }

  public async stageAndVerify(options: HybridSandboxStageOptions): Promise<HybridSandboxOutcome> {
    for (const [relPath, content] of Object.entries(options.writes)) {
      this.overlay.writeFile(relPath, content);
    }

    const diffs = this.overlay.diff();
    let evalResult: SandboxExecutionResult<unknown> | undefined;

    if (options.evalScript) {
      evalResult = this.vm.execute(options.evalScript);
      if (!evalResult.ok) {
        this.overlay.rollback();
        return {
          committed: false,
          diffsCount: diffs.length,
          evalResult,
          committedWrites: 0,
        };
      }
    }

    if (options.verifier) {
      const ok = await options.verifier(diffs, (rel) => this.overlay.readFile(rel));
      if (!ok) {
        this.overlay.rollback();
        return {
          committed: false,
          diffsCount: diffs.length,
          evalResult,
          committedWrites: 0,
        };
      }
    }

    const res = this.overlay.commitToDisk();
    return {
      committed: true,
      diffsCount: diffs.length,
      evalResult,
      committedWrites: res.committedWrites,
    };
  }
}
