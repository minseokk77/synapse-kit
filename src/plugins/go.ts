import { spawn } from 'bun';
import { resolve } from 'node:path';
import type { CheckerPlugin, CheckResult } from '../types';
import { t } from '../i18n';

export interface GoPluginOptions {
  /** Go 모듈 루트 디렉터리 (기본값: '.') */
  readonly moduleDir?: string;
  /** 정적 분석 대상 패키지 (기본값: './...') */
  readonly targetPackage?: string;
  /** 검증 명령 (기본값: 'vet') */
  readonly checkCommand?: 'vet' | 'build';
  /** 추가 go CLI 플래그 */
  readonly extraArgs?: readonly string[];
}

/**
 * Go 패키지 및 고루틴 정적 무결성 검증 플러그인 (@synapse/plugin-go)
 */
export function goChecker(options: GoPluginOptions = {}): CheckerPlugin {
  const moduleDir = options.moduleDir || '.';
  const targetPackage = options.targetPackage || './...';
  const checkCmd = options.checkCommand || 'vet';

  return {
    name: 'go',
    get title() {
      return t('pluginGoTitle');
    },
    triggers: [
      '.go',
      'go.mod',
      'go.sum',
      'go.work',
    ],
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      const cwd = resolve(ctx.rootDir, moduleDir);

      const args = checkCmd === 'vet'
        ? ['go', 'vet', ...(options.extraArgs || []), targetPackage]
        : ['go', 'build', '-n', ...(options.extraArgs || []), targetPackage];

      try {
        const proc = spawn(args, {
          cwd,
          stdout: 'pipe',
          stderr: 'pipe',
        });

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        const durationMs = performance.now() - start;

        if (exitCode !== 0) {
          const outputText = `${stderr}\n${stdout}`.trim();
          return {
            name: 'go',
            title: t('pluginGoTitle'),
            status: 'error',
            durationMs,
            details: t('pluginGoError'),
            diagnostics: [{ message: outputText.slice(-1500), severity: 'error' }],
          };
        }

        return {
          name: 'go',
          title: t('pluginGoTitle'),
          status: 'success',
          durationMs,
          details: t('pluginGoSuccess'),
        };
      } catch (error) {
        return {
          name: 'go',
          title: t('pluginGoTitle'),
          status: 'error',
          durationMs: performance.now() - start,
          details: `go execution failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
