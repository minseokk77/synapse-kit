import { spawn } from 'bun';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckerPlugin, CheckResult } from '../types';

export interface JavaPluginOptions {
  /** Java 소스 코드 루트 디렉터리 (기본값: './services/gateway' 또는 '.') */
  sourceDir?: string;
  /** 바이트코드 출력 대상 디렉터리 (기본값: './target/java-classes') */
  outputDir?: string;
  /** 추가 javac 아규먼트 */
  javacArgs?: string[];
}

/**
 * Project Synapse 공식 Java 언어 플러그인
 * javac 컴파일러를 통한 정적 타입 무결성 및 바이트코드 컴파일 검증
 */
export function javaChecker(options: JavaPluginOptions = {}): CheckerPlugin {
  const sourceDir = options.sourceDir || '.';
  const outputDir = options.outputDir || './target/java-classes';
  const extraArgs = options.javacArgs || [];

  return {
    name: 'java',
    title: 'Java 엔터프라이즈 컴파일러 (javac)',
    triggers: ['.java'],
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      const targetDir = join(ctx.rootDir, sourceDir);
      const outDir = join(ctx.rootDir, outputDir);

      if (!existsSync(outDir)) {
        try {
          mkdirSync(outDir, { recursive: true });
        } catch {
          // 디렉터리 생성 실패 무시
        }
      }

      // 소스 디렉터리 내 .java 파일 탐색
      const findProc = spawn(['powershell', '-NoProfile', '-Command', `Get-ChildItem -Path "${targetDir}" -Filter "*.java" -Recurse | Select-Object -ExpandProperty FullName`], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const findOutput = await new Response(findProc.stdout).text();
      await findProc.exited;

      const javaFiles = findOutput
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.endsWith('.java'));

      if (javaFiles.length === 0) {
        return {
          name: 'java',
          title: 'Java 엔터프라이즈 컴파일러 (javac)',
          status: 'skipped',
          durationMs: performance.now() - start,
          details: '검증할 Java 소스 파일(.java)이 존재하지 않습니다.',
        };
      }

      const args = ['javac', '-d', outDir, ...extraArgs, ...javaFiles];
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
          title: 'Java 엔터프라이즈 컴파일러 (javac)',
          status: 'success',
          durationMs,
          details: `Java ${javaFiles.length}개 소스 파일 바이트코드 컴파일 무결성 검증 완료`,
        };
      }

      return {
        name: 'java',
        title: 'Java 엔터프라이즈 컴파일러 (javac)',
        status: 'error',
        durationMs,
        details: stderrText.trim() || 'Java 컴파일 중 오류가 발생했습니다.',
        diagnostics: [
          {
            file: javaFiles[0] || 'Unknown.java',
            line: 1,
            message: stderrText.trim() || 'javac 컴파일 실패',
            severity: 'error',
          },
        ],
      };
    },
  };
}
