import { spawn } from 'bun';
import { resolve } from 'node:path';
import type { CheckerPlugin, CheckResult } from '../types';
import { t } from '../i18n';

export interface PythonPluginOptions {
  /** Python 인터프리터 경로 (기본값: 'python') */
  readonly pythonBin?: string;
  /** Python 소스 루트 디렉터리 (기본값: '.') */
  readonly sourceDir?: string;
  /** 검증할 특정 파이썬 파일 목록 (미지정 시 자동 탐색) */
  readonly targetFiles?: readonly string[];
  /**
   * 검증 모드 (기본값: 'fast')
   * - 'fast': -S(site.py 초기화 생략), -B(디스크 쓰기 방지), compile() 인메모리 컴파일로 30ms대 초고속 AST/구문 무결성 검증
   * - 'py_compile': 표준 py_compile 모듈 기반 컴파일
   */
  readonly mode?: 'fast' | 'py_compile';
  /** 추가 파이썬 컴파일 플래그 */
  readonly extraArgs?: readonly string[];
}

/**
 * Python 바이트코드 구문 및 AST 무결성 검증 플러그인 (@synapse/plugin-python)
 */
export function pythonChecker(options: PythonPluginOptions = {}): CheckerPlugin {
  const pythonBin = options.pythonBin || 'python';
  const sourceDir = options.sourceDir || '.';
  const mode = options.mode || 'fast';

  return {
    name: 'python',
    get title() {
      return t('pluginPythonTitle');
    },
    triggers: [
      '.py',
      'pyproject.toml',
      'requirements.txt',
      'setup.py',
    ],
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      const targetPath = resolve(ctx.rootDir, sourceDir);

      let targetFiles = options.targetFiles ? [...options.targetFiles] : [];

      if (targetFiles.length === 0) {
        try {
          const glob = new Bun.Glob('**/*.py');
          const scanned = Array.from(glob.scanSync({ cwd: targetPath, absolute: true }));
          targetFiles = scanned
            .filter((f) => !f.includes('__pycache__') && !f.includes('.venv') && !f.includes('site-packages'))
            .slice(0, 50);
        } catch {
          targetFiles = [];
        }
      }

      if (targetFiles.length === 0) {
        return {
          name: 'python',
          title: t('pluginPythonTitle'),
          status: 'skipped',
          durationMs: performance.now() - start,
          details: t('pluginPythonNoFiles'),
        };
      }

      let args: string[];
      if (mode === 'fast') {
        // -S: site.py 임포트 생략으로 인터프리터 구동 시간 대폭 단축 (~20-30ms)
        // -B: .pyc 바이트코드 디스크 쓰기 방지 (I/O 병목 제거)
        // compile(): C 레벨 내장 함수로 py_compile 모듈 오버헤드 없이 인메모리 구문 검증
        const fastScript = "import sys\nfor f in sys.argv[1:]:\n compile(open(f, 'rb').read(), f, 'exec')";
        args = [
          pythonBin,
          '-S',
          '-B',
          ...(options.extraArgs || []),
          '-c',
          fastScript,
          ...targetFiles,
        ];
      } else {
        args = [
          pythonBin,
          '-B',
          '-m',
          'py_compile',
          ...(options.extraArgs || []),
          ...targetFiles,
        ];
      }

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
            name: 'python',
            title: t('pluginPythonTitle'),
            status: 'error',
            durationMs,
            details: t('pluginPythonError'),
            diagnostics: [{ message: outputText.slice(-1500), severity: 'error' }],
          };
        }

        return {
          name: 'python',
          title: t('pluginPythonTitle'),
          status: 'success',
          durationMs,
          details: t('pluginPythonSuccess', targetFiles.length),
        };
      } catch (error) {
        return {
          name: 'python',
          title: t('pluginPythonTitle'),
          status: 'error',
          durationMs: performance.now() - start,
          details: `${pythonBin} execution failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
