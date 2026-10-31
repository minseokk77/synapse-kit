import { spawn } from 'bun';
import { resolve } from 'node:path';
import type { CheckerPlugin, CheckResult } from '../types';

export interface SveltePluginOptions {
  readonly tsconfig?: string;
  readonly threshold?: 'warning' | 'error';
  readonly appDir?: string;
}

/**
 * Svelte 5 & TypeScript 정적 검사 플러그인 (@synapse/plugin-svelte)
 */
export function svelteChecker(options: SveltePluginOptions = {}): CheckerPlugin {
  return {
    name: 'svelte',
    title: 'Svelte 5 & TypeScript (svelte-check)',
    triggers: [
      '.svelte',
      '.ts',
      '.js',
      'svelte.config.js',
      'tsconfig.json',
      'src/',
    ],
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      const appPath = resolve(ctx.rootDir, options.appDir || './');
      const tsconfigPath = resolve(appPath, options.tsconfig || './tsconfig.json');

      try {
        // 1. SvelteKit sync
        const syncProc = spawn(['bun', 'x', 'svelte-kit', 'sync'], {
          cwd: appPath,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        await syncProc.exited;

        // 2. svelte-check
        const checkProc = spawn(
          ['bun', 'x', 'svelte-check', '--tsconfig', tsconfigPath, '--threshold', options.threshold || 'warning'],
          {
            cwd: appPath,
            stdout: 'pipe',
            stderr: 'pipe',
          }
        );

        const [stdout, stderr] = await Promise.all([
          new Response(checkProc.stdout).text(),
          new Response(checkProc.stderr).text(),
        ]);

        const exitCode = await checkProc.exited;
        const durationMs = performance.now() - start;

        if (exitCode !== 0) {
          const outputText = `${stdout}\n${stderr}`.trim();
          return {
            name: 'svelte',
            title: 'Svelte 5 & TypeScript (svelte-check)',
            status: 'error',
            durationMs,
            details: 'Svelte 템플릿 또는 TypeScript 타입 오류가 발생했습니다.',
            diagnostics: [{ message: outputText.slice(-1500), severity: 'error' }],
          };
        }

        return {
          name: 'svelte',
          title: 'Svelte 5 & TypeScript (svelte-check)',
          status: 'success',
          durationMs,
          details: 'Svelte 5 Runes 및 TS 타입 무결성 검증 완료 (0 Errors, 0 Warnings)',
        };
      } catch (error) {
        return {
          name: 'svelte',
          title: 'Svelte 5 & TypeScript (svelte-check)',
          status: 'error',
          durationMs: performance.now() - start,
          details: `Svelte 검사 도구 실행 실패: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
