import { spawn } from 'bun';
import type { CheckerPlugin, CheckResult } from '../types';
import { t } from '../i18n';
import {
  assertAllowedBinary,
  resolvePathInsideRoot,
  sanitizeCompilerArgs,
  sanitizeTargetFiles,
} from './security';

export interface CppPluginOptions {
  /** 컴파일러 실행 파일 (기본값: 'g++') */
  readonly compiler?: string;
  /** C++ 표준 버전 (기본값: 'c++17') */
  readonly std?: string;
  /** C/C++ 소스 루트 디렉터리 (기본값: '.') */
  readonly sourceDir?: string;
  /** 추가 인클루드 경로 배열 */
  readonly includeDirs?: readonly string[];
  /** 추가 컴파일러 플래그 */
  readonly extraArgs?: readonly string[];
  /** 특정 진입점 소스 파일 배열 (미지정 시 sourceDir 내 C++ 파일 자동 탐색) */
  readonly targetFiles?: readonly string[];
}

/**
 * C/C++ 네이티브 커널 및 알고리즘 구문 검사 플러그인 (@synapse/plugin-cpp)
 */
export function cppChecker(options: CppPluginOptions = {}): CheckerPlugin {
  const compiler = options.compiler || 'g++';
  const std = options.std || 'c++17';
  const sourceDir = options.sourceDir || '.';

  return {
    name: 'cpp',
    get title() {
      return t('pluginCppTitle');
    },
    triggers: [
      '.cpp',
      '.hpp',
      '.cc',
      '.cxx',
      '.h',
      'CMakeLists.txt',
    ],
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      try {
        const safeCompiler = assertAllowedBinary(
          compiler,
          ['g++', 'gcc', 'clang', 'clang++', 'c++'],
          'C++ 컴파일러'
        );
        if (!/^[a-zA-Z0-9+_-]+$/.test(std)) {
          throw new Error(`[Plugin Security] 유효하지 않은 C++ 표준 지정입니다: ${std}`);
        }
        const targetPath = resolvePathInsideRoot(ctx.rootDir, sourceDir, 'C++ 소스 디렉터리');

        let targetFiles = options.targetFiles
          ? sanitizeTargetFiles(ctx.rootDir, options.targetFiles, 'C++')
          : [];

        if (targetFiles.length === 0) {
          try {
            const glob = new Bun.Glob('**/*.{cpp,cc,cxx}');
            const scanned = Array.from(glob.scanSync({ cwd: targetPath, absolute: true }));
            targetFiles = scanned.slice(0, 50); // 안전한 배치 크기 제한
          } catch {
            targetFiles = [];
          }
        }

        if (targetFiles.length === 0) {
          return {
            name: 'cpp',
            title: t('pluginCppTitle'),
            status: 'skipped',
            durationMs: performance.now() - start,
            details: t('pluginCppNoFiles'),
          };
        }

        const includes = (options.includeDirs || []).map(
          (d) => `-I${resolvePathInsideRoot(ctx.rootDir, d, 'C++ 인클루드 경로')}`
        );
        const safeExtraArgs = sanitizeCompilerArgs(
          options.extraArgs,
          ['-fplugin', '-Xclang', '-B', '--specs'],
          'C++'
        );
        const args = [
          safeCompiler,
          `-std=${std}`,
          '-fsyntax-only',
          ...includes,
          ...safeExtraArgs,
          '--',
          ...targetFiles,
        ];

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
            name: 'cpp',
            title: t('pluginCppTitle'),
            status: 'error',
            durationMs,
            details: t('pluginCppError'),
            diagnostics: [{ message: outputText.slice(-1500), severity: 'error' }],
          };
        }

        return {
          name: 'cpp',
          title: t('pluginCppTitle'),
          status: 'success',
          durationMs,
          details: t('pluginCppSuccess', targetFiles.length),
        };
      } catch (error) {
        return {
          name: 'cpp',
          title: t('pluginCppTitle'),
          status: 'error',
          durationMs: performance.now() - start,
          details: `${compiler} execution failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
