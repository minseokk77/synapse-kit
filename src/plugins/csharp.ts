import { spawn } from 'bun';
import { resolve } from 'node:path';
import type { CheckerPlugin, CheckResult } from '../types';
import { t } from '../i18n';

export interface CsharpPluginOptions {
  /** 검증할 .NET 프로젝트/솔루션 경로 (기본값: '.') */
  readonly projectPath?: string;
  /** 빌드 구성 (기본값: 'Release') */
  readonly configuration?: 'Debug' | 'Release';
  /** 추가 dotnet CLI 플래그 */
  readonly extraArgs?: readonly string[];
}

/**
 * C# .NET 솔루션 및 프로젝트 정적 검증 플러그인 (@synapse/plugin-csharp)
 */
export function csharpChecker(options: CsharpPluginOptions = {}): CheckerPlugin {
  const projectPath = options.projectPath || '.';
  const configuration = options.configuration || 'Release';

  return {
    name: 'csharp',
    get title() {
      return t('pluginCsharpTitle');
    },
    triggers: [
      '.cs',
      '.csproj',
      '.sln',
      'Directory.Build.props',
      'Directory.Build.targets',
    ],
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      const target = resolve(ctx.rootDir, projectPath);

      const args = [
        'dotnet',
        'build',
        target,
        '-c',
        configuration,
        '-v',
        'q',
        '--nologo',
        ...(options.extraArgs || []),
      ];

      try {
        const proc = spawn(args, {
          cwd: ctx.rootDir,
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
            name: 'csharp',
            title: t('pluginCsharpTitle'),
            status: 'error',
            durationMs,
            details: t('pluginCsharpError'),
            diagnostics: [{ message: outputText.slice(-1500), severity: 'error' }],
          };
        }

        return {
          name: 'csharp',
          title: t('pluginCsharpTitle'),
          status: 'success',
          durationMs,
          details: t('pluginCsharpSuccess'),
        };
      } catch (error) {
        return {
          name: 'csharp',
          title: t('pluginCsharpTitle'),
          status: 'error',
          durationMs: performance.now() - start,
          details: `dotnet execution failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
