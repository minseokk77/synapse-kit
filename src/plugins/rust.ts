import { spawn } from 'bun';
import { resolve } from 'node:path';
import type { CheckerPlugin, CheckResult } from '../types';
import { t } from '../i18n';

export interface RustPluginOptions {
  readonly workspaceDir?: string;
  readonly allTargets?: boolean;
}

/**
 * Rust Cargo 워크스페이스 검사 플러그인 (@synapse/plugin-rust)
 */
export function rustChecker(options: RustPluginOptions = {}): CheckerPlugin {
  return {
    name: 'rust',
    get title() {
      return t('pluginRustTitle');
    },
    triggers: [
      'Cargo.toml',
      'Cargo.lock',
      '.rs',
      'src-tauri/',
      'crates/',
    ],
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      const workspacePath = resolve(ctx.rootDir, options.workspaceDir || './');

      try {
        // 1. cargo check
        const checkProc = spawn(['cargo', 'check', '--workspace'], {
          cwd: workspacePath,
          stdout: 'pipe',
          stderr: 'pipe',
        });

        const [checkStdout, checkStderr] = await Promise.all([
          new Response(checkProc.stdout).text(),
          new Response(checkProc.stderr).text(),
        ]);
        const checkExitCode = await checkProc.exited;

        if (checkExitCode !== 0) {
          const durationMs = performance.now() - start;
          const outputText = `${checkStderr}\n${checkStdout}`.trim();
          return {
            name: 'rust',
            title: t('pluginRustTitle'),
            status: 'error',
            durationMs,
            details: t('pluginRustCompileFail'),
            diagnostics: [{ message: outputText.slice(-1500), severity: 'error' }],
          };
        }

        // 2. cargo clippy
        const clippyProc = spawn(['cargo', 'clippy', '--workspace'], {
          cwd: workspacePath,
          stdout: 'pipe',
          stderr: 'pipe',
        });

        const [clippyStdout, clippyStderr] = await Promise.all([
          new Response(clippyProc.stdout).text(),
          new Response(clippyProc.stderr).text(),
        ]);
        const clippyExitCode = await clippyProc.exited;
        const clippyOutput = `${clippyStderr}\n${clippyStdout}`;
        const warningMatches = clippyOutput.match(/warning: /g);
        const warningCount = warningMatches ? warningMatches.length : 0;
        const durationMs = performance.now() - start;

        if (clippyExitCode !== 0 || warningCount > 0) {
          return {
            name: 'rust',
            title: t('pluginRustTitle'),
            status: warningCount > 0 && clippyExitCode === 0 ? 'warning' : 'error',
            durationMs,
            details: t('pluginRustClippyWarn', warningCount),
          };
        }

        return {
          name: 'rust',
          title: t('pluginRustTitle'),
          status: 'success',
          durationMs,
          details: t('pluginRustSuccess'),
        };
      } catch (error) {
        return {
          name: 'rust',
          title: t('pluginRustTitle'),
          status: 'error',
          durationMs: performance.now() - start,
          details: t('pluginRustExecFail', error instanceof Error ? error.message : String(error)),
        };
      }
    },
  };
}
