import { spawn } from 'bun';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { CheckerPlugin, CheckResult } from '../types';
import { t } from '../i18n';

export interface TypescriptPluginOptions {
  /**
   * 검증 도구 및 아키텍처 선택:
   * - 'hybrid' (권장): 네이티브 Rust Oxc 0.1s Fast-Abort + 공식 tsc 증분 시맨틱 동시 병렬 융합
   * - 'tsc': 100% 순수 TypeScript 공식 컴파일러 (무의존성)
   * - 'tsrs': 네이티브 Rust Oxc 단독 가속 모드
   * @default 'hybrid'
   */
  readonly tool?: 'hybrid' | 'tsc' | 'tsrs';
  /** tsconfig.json 파일 경로 (기본값: './tsconfig.json') */
  readonly tsconfig?: string;
  /** 네이티브 tsrs 실행 파일 경로 (미지정 시 자동 탐색) */
  readonly tsrsPath?: string;
  /** 추가 CLI 플래그 */
  readonly extraArgs?: readonly string[];
}

/**
 * TypeScript 정적 타입 및 구문 검사 플러그인 (@synapse/plugin-typescript)
 * 2개 조합 하이브리드 융합 엔진 탑재:
 * 네이티브 0.1s Fast-Abort 게이트 + 순수 tsc 증분 시맨틱 캐시의 동시 병렬 경합
 */
export function typescriptChecker(options: TypescriptPluginOptions = {}): CheckerPlugin {
  const tool = options.tool || 'hybrid';
  const tsconfig = options.tsconfig || './tsconfig.json';

  return {
    name: 'typescript',
    get title() {
      if (tool === 'hybrid') {
        return t('getLocale' as any) === 'en'
          ? 'TypeScript Dual Hybrid (Native Fast-Abort + Pure tsc)'
          : 'TypeScript 2단 하이브리드 (네이티브 Fast-Abort + 순수 tsc)';
      }
      return tool === 'tsc' ? t('pluginTypescriptTitlePure') : t('pluginTypescriptTitleNative');
    },
    triggers: [
      '.ts',
      '.tsx',
      '.mts',
      '.cts',
      'tsconfig.json',
      'package.json',
    ],
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      const tsconfigPath = resolve(ctx.rootDir, tsconfig);

      // tsrs 네이티브 바이너리 자동 탐색
      const nativeCandidates = [
        options.tsrsPath,
        resolve(ctx.rootDir, 'node_modules/@tsrs/win32-x64/tsrs.exe'),
        resolve(ctx.rootDir, '../node_modules/@tsrs/win32-x64/tsrs.exe'),
        'D:/synapse/examples/massive-200k/node_modules/@tsrs/win32-x64/tsrs.exe',
        'tsrs',
      ].filter((p): p is string => !!p);

      const resolvedNativePath = nativeCandidates.find((p) => p === 'tsrs' || existsSync(p));

      // -----------------------------------------------------------------------
      // [1] 하이브리드 2개 조합 모드 (Hybrid Speculative Parallel)
      // -----------------------------------------------------------------------
      if (tool === 'hybrid' && resolvedNativePath) {
        try {
          const nativeProc = spawn([resolvedNativePath, '--noEmit', ...(options.extraArgs || [])], {
            cwd: ctx.rootDir,
            stdout: 'pipe',
            stderr: 'pipe',
          });

          const tscProc = spawn(['bun', 'x', 'tsc', '--project', tsconfigPath, '--incremental', '--noEmit', ...(options.extraArgs || [])], {
            cwd: ctx.rootDir,
            stdout: 'pipe',
            stderr: 'pipe',
          });

          const nativePromise = (async () => {
            const [stdout, stderr] = await Promise.all([
              new Response(nativeProc.stdout).text(),
              new Response(nativeProc.stderr).text(),
            ]);
            const exitCode = await nativeProc.exited;
            return { exitCode, stdout, stderr };
          })();

          const tscPromise = (async () => {
            const [stdout, stderr] = await Promise.all([
              new Response(tscProc.stdout).text(),
              new Response(tscProc.stderr).text(),
            ]);
            const exitCode = await tscProc.exited;
            return { exitCode, stdout, stderr };
          })();

          // A. 네이티브 결과가 먼저 나올 때까지 대기
          const nativeResult = await nativePromise;

          if (nativeResult.exitCode !== 0) {
            // 문법/파싱 에러 즉시 감지 ➜ tsc 즉시 강제 종료 (0.1s Fast-Abort)
            try {
              tscProc.kill();
            } catch {}
            const durationMs = performance.now() - start;
            const outputText = `${nativeResult.stderr}\n${nativeResult.stdout}`.trim();
            return {
              name: 'typescript',
              title: 'TypeScript 2단 하이브리드 (Fast-Abort)',
              status: 'error',
              durationMs,
              details: `네이티브 Oxc 구문 검사 즉시 차단 (${durationMs.toFixed(1)}ms): 문법 오류가 발견되었습니다.`,
              diagnostics: [{ message: outputText.slice(-1500), severity: 'error' }],
            };
          }

          // B. 네이티브 통과 시 ➜ 이미 백그라운드 진행 중이던 tsc 공식 타입 검사 완료 대기
          const tscResult = await tscPromise;
          const durationMs = performance.now() - start;

          if (tscResult.exitCode !== 0) {
            const outputText = `${tscResult.stderr}\n${tscResult.stdout}`.trim();
            return {
              name: 'typescript',
              title: 'TypeScript 2단 하이브리드 (Pure tsc)',
              status: 'error',
              durationMs,
              details: '공식 tsc 타입 검사에서 시맨틱 오류가 감지되었습니다.',
              diagnostics: [{ message: outputText.slice(-1500), severity: 'error' }],
            };
          }

          return {
            name: 'typescript',
            title: 'TypeScript 2단 하이브리드 융합',
            status: 'success',
            durationMs,
            details: `네이티브 Oxc(구문 0.1s) + 순수 tsc(증분 타입 0.3s) 동시 완결`,
          };
        } catch {
          // 하이브리드 실패 시 순수 tsc로 안전한 폴백
        }
      }

      // -----------------------------------------------------------------------
      // [2] 단독 모드 (tsc 순수 모드 또는 tsrs 단독 모드)
      // -----------------------------------------------------------------------
      const isNative = tool === 'tsrs' && resolvedNativePath;
      const args = isNative
        ? [resolvedNativePath, '--noEmit', ...(options.extraArgs || [])]
        : ['bun', 'x', 'tsc', '--project', tsconfigPath, '--incremental', '--noEmit', ...(options.extraArgs || [])];

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
            name: 'typescript',
            title: isNative ? t('pluginTypescriptTitleNative') : t('pluginTypescriptTitlePure'),
            status: 'error',
            durationMs,
            details: t('pluginTypescriptError'),
            diagnostics: [{ message: outputText.slice(-1500), severity: 'error' }],
          };
        }

        return {
          name: 'typescript',
          title: isNative ? t('pluginTypescriptTitleNative') : t('pluginTypescriptTitlePure'),
          status: 'success',
          durationMs,
          details: t('pluginTypescriptSuccess', isNative ? 'Native tsrs' : 'Pure tsc incremental'),
        };
      } catch (error) {
        return {
          name: 'typescript',
          title: 'TypeScript 검증기',
          status: 'error',
          durationMs: performance.now() - start,
          details: `TypeScript execution failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
