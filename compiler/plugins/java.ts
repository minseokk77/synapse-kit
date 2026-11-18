import { spawn } from 'bun';
import { existsSync, mkdirSync } from 'node:fs';
import type { CheckerPlugin, CheckResult } from '../types';
import { t } from '../i18n';
import {
  resolvePathInsideRoot,
  sanitizeCompilerArgs,
  sanitizeTargetFiles,
} from './security';

export interface JavaPluginOptions {
  /** Java 소스 코드 루트 디렉터리 (기본값: './services/gateway' 또는 '.') */
  readonly sourceDir?: string;
  /** 바이트코드 출력 대상 디렉터리 (기본값: './target/java-classes') */
  readonly outputDir?: string;
  /** 특정 진입점 소스 파일 배열 (미지정 시 sourceDir 내 Java 파일 자동 탐색) */
  readonly targetFiles?: readonly string[];
  /** 추가 javac 아규먼트 */
  readonly javacArgs?: readonly string[];
}

/**
 * Project Synapse 공식 Java 언어 플러그인 (@synapse/plugin-java)
 * javac 컴파일러를 통한 정적 타입 무결성 및 바이트코드 컴파일 검증
 */
export function javaChecker(options: JavaPluginOptions = {}): CheckerPlugin {
  const sourceDir = options.sourceDir || '.';
  const outputDir = options.outputDir || './target/java-classes';
  const extraArgs = options.javacArgs || [];

  return {
    name: 'java',
    get title() {
      return t('pluginJavaTitle');
    },
    triggers: [
      '.java',
      'pom.xml',
      'build.gradle',
      'build.gradle.kts',
      'settings.gradle',
    ],
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      try {
        const targetDir = resolvePathInsideRoot(ctx.rootDir, sourceDir, 'Java 소스 디렉터리');
        const outDir = resolvePathInsideRoot(ctx.rootDir, outputDir, 'Java 출력 디렉터리');

        if (!existsSync(outDir)) {
          try {
            mkdirSync(outDir, { recursive: true });
          } catch {
            // ignore
          }
        }

        let javaFiles: string[] = options.targetFiles
          ? sanitizeTargetFiles(ctx.rootDir, options.targetFiles, 'Java')
          : [];

        if (javaFiles.length === 0) {
          try {
            const glob = new Bun.Glob('**/*.java');
            const scanned = Array.from(glob.scanSync({ cwd: targetDir, absolute: true }));
            javaFiles = scanned.slice(0, 10); // 과도한 디스크 I/O 방지를 위해 안전한 배치 크기 제한
          } catch {
            javaFiles = [];
          }
        }

        if (javaFiles.length === 0) {
          return {
            name: 'java',
            title: t('pluginJavaTitle'),
            status: 'skipped',
            durationMs: performance.now() - start,
            details: t('pluginJavaNoFiles'),
          };
        }

        const safeExtraArgs = sanitizeCompilerArgs(
          extraArgs,
          ['-J', '-processor', '-processorpath', '--processor-path'],
          'Java'
        );
        const args = ['javac', '-d', outDir, ...safeExtraArgs, ...javaFiles];

        const proc = spawn(args, {
          cwd: ctx.rootDir,
          stdout: 'pipe',
          stderr: 'pipe',
        });

        const stderrText = await new Response(proc.stderr).text();
        await proc.exited;
        const durationMs = performance.now() - start;

        if (proc.exitCode === 0) {
          return {
            name: 'java',
            title: t('pluginJavaTitle'),
            status: 'success',
            durationMs,
            details: t('pluginJavaSuccess', javaFiles.length),
          };
        }

        return {
          name: 'java',
          title: t('pluginJavaTitle'),
          status: 'error',
          durationMs,
          details: stderrText.trim() || t('pluginJavaError'),
          diagnostics: [
            {
              file: javaFiles[0] || 'Unknown.java',
              line: 1,
              message: stderrText.trim() || t('pluginJavaError'),
              severity: 'error',
            },
          ],
        };
      } catch (error) {
        return {
          name: 'java',
          title: t('pluginJavaTitle'),
          status: 'error',
          durationMs: performance.now() - start,
          details: `javac execution failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
