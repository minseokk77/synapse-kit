/**
 * 시냅스 옵틱(Synapse Optic) 네이티브 Rust 브라우저 엔진 드라이버
 * - 프로메테우스(prometheus-cli) 고성능 바이너리 프로세스 브리지
 */
import { existsSync } from "node:fs";
import { spawnSync, spawn } from "bun";
import { OPTIC_DEFAULTS, type OpticConfig } from "./config";
import type { OpticActionResult, ReferenceNode } from "./types";

export class OpticDriver {
  private resolvedBinary: string | null = null;

  constructor(private readonly config: OpticConfig = {}) {
    this.resolvedBinary = this.resolveBinaryPath();
  }

  /**
   * 실행 가능한 프로메테우스 네이티브 바이너리 경로 탐색
   */
  public resolveBinaryPath(): string | null {
    if (this.config.binaryPath && existsSync(this.config.binaryPath)) {
      return this.config.binaryPath;
    }

    if (process.env.PROMETHEUS_BIN && existsSync(process.env.PROMETHEUS_BIN)) {
      return process.env.PROMETHEUS_BIN;
    }

    for (const candidate of OPTIC_DEFAULTS.NATIVE_PROMETHEUS_CANDIDATES) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * 네이티브 바이너리 가용성 확인
   */
  public isBinaryAvailable(): boolean {
    return this.resolvedBinary !== null;
  }

  /**
   * 네이티브 CLI 서브커맨드 실행 (JSON 규격 통신)
   */
  public runCommand(args: string[]): { ok: boolean; stdout: string; stderr: string; exitCode: number } {
    const bin = this.resolvedBinary;
    if (!bin) {
      return {
        ok: false,
        stdout: "",
        stderr: "Prometheus 네이티브 바이너리를 찾을 수 없습니다. (prometheus-cli 빌드 필요)",
        exitCode: -1,
      };
    }

    const fullArgs = [...args];
    if (this.config.targetId && !fullArgs.includes("--target")) {
      fullArgs.push("--target", this.config.targetId);
    }

    const proc = spawnSync({
      cmd: [bin, ...fullArgs],
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = proc.stdout ? new TextDecoder().decode(proc.stdout) : "";
    const stderr = proc.stderr ? new TextDecoder().decode(proc.stderr) : "";

    return {
      ok: proc.exitCode === 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: proc.exitCode ?? 1,
    };
  }

  /**
   * 소유 브라우저 데몬 기동
   */
  public launchBrowser(port = 0): { proc: ReturnType<typeof spawn>; endpointPromise: Promise<string> } {
    const bin = this.resolvedBinary;
    if (!bin) {
      throw new Error("[OpticDriver] 프로메테우스 바이너리를 찾을 수 없습니다.");
    }

    const proc = spawn({
      cmd: [bin, "browser", String(port)],
      stdout: "pipe",
      stderr: "pipe",
    });

    const endpointPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("[OpticDriver] 브라우저 기동 시간 초과 (10s)"));
      }, 10_000);

      const reader = proc.stdout ? (proc.stdout as ReadableStream<Uint8Array>).getReader() : null;
      if (!reader) {
        clearTimeout(timeout);
        return reject(new Error("[OpticDriver] stdout 스트림을 열 수 없습니다."));
      }

      const decoder = new TextDecoder();
      let buffer = "";

      const readLoop = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value);
            const match = buffer.match(/Browser endpoint:\s*(http:\/\/[^\s]+)/);
            if (match) {
              clearTimeout(timeout);
              resolve(match[1]);
              break;
            }
          }
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      };

      readLoop();
    });

    return { proc, endpointPromise };
  }
}
