import { spawn } from 'bun';
import type { CheckerPlugin, CheckResult } from '../types';
import { t } from '../i18n';
import { resolvePathInsideRoot } from './security';

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
    get title() {
      return t('pluginSvelteTitle');
    },
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

      try {
        const appPath = resolvePathInsideRoot(ctx.rootDir, options.appDir || './', 'Svelte 앱 디렉터리');
        const tsconfigPath = resolvePathInsideRoot(appPath, options.tsconfig || './tsconfig.json', 'Svelte tsconfig');
        const threshold = options.threshold || 'warning';
        if (threshold !== 'warning' && threshold !== 'error') {
          throw new Error(`[Plugin Security] 유효하지 않은 svelte-check threshold 값입니다: ${threshold}`);
        }

        // 1. SvelteKit sync
        const syncProc = spawn(['bun', 'x', 'svelte-kit', 'sync'], {
          cwd: appPath,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        await syncProc.exited;

        // 2. svelte-check
        const checkProc = spawn(
          ['bun', 'x', 'svelte-check', '--tsconfig', tsconfigPath, '--threshold', threshold],
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
            title: t('pluginSvelteTitle'),
            status: 'error',
            durationMs,
            details: t('pluginSvelteError'),
            diagnostics: [{ message: outputText.slice(-1500), severity: 'error' }],
          };
        }

        return {
          name: 'svelte',
          title: t('pluginSvelteTitle'),
          status: 'success',
          durationMs,
          details: t('pluginSvelteSuccess'),
        };
      } catch (error) {
        return {
          name: 'svelte',
          title: t('pluginSvelteTitle'),
          status: 'error',
          durationMs: performance.now() - start,
          details: t('pluginSvelteExecFail', error instanceof Error ? error.message : String(error)),
        };
      }
    },
  };
}
