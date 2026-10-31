import { spawn } from 'bun';
import type { CausalDecision, CheckerPlugin, SynapseOptions } from '../types';

/**
 * 프로젝트 시냅스(Project Synapse) 범용 AI 인과율 메모리 분석 엔진
 * Git 변경 이력과 각 플러그인의 트리거 패턴을 교차 분석하여 불필요한 연산을 지능적으로 스킵합니다.
 */
export async function analyzeCausalGraph(
  rootDir: string,
  plugins: readonly CheckerPlugin[],
  options: SynapseOptions
): Promise<CausalDecision> {
  const allPluginNames = new Set(plugins.map((p) => p.name));

  if (options.mode === 'all') {
    return {
      runAll: true,
      activePluginNames: allPluginNames,
      reason: '전체 검사 모드(--all) 요청: 모든 플러그인 검사기를 실행합니다.',
      modifiedFiles: [],
    };
  }

  try {
    // 🛡️ 핵심 결함 패치: -uall (--untracked-files=all) 플래그를 필수 적용하여
    // 새 디렉터리 내의 미추적 파일이 디렉터리 한 줄(dir/)로 축약되지 않고 개별 파일 단위로 나열되도록 강제합니다.
    const gitProc = spawn(['git', 'status', '--porcelain', '-uall'], {
      cwd: rootDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(gitProc.stdout).text();
    await gitProc.exited;

    const lines = output.split('\n').filter((l) => l.trim().length > 0);
    const modifiedFiles = lines.map((l) => l.slice(3).trim().replaceAll('\\', '/'));

    if (modifiedFiles.length === 0) {
      return {
        runAll: true,
        activePluginNames: allPluginNames,
        reason: '작업 트리에 변경된 파일이 없어 전체 베이스라인 검증을 수행합니다.',
        modifiedFiles: [],
      };
    }

    const activePluginNames = new Set<string>();

    for (const plugin of plugins) {
      const isTriggered = plugin.triggers.some((pattern) => {
        const cleanPattern = pattern.replaceAll('\\', '/').replace(/^\.\//, '');
        const isExtension = cleanPattern.startsWith('.');

        return modifiedFiles.some((file) => {
          // 1. 확장자 기반 매칭 (예: .rs, .svelte, .ts)
          if (isExtension) {
            return file.endsWith(cleanPattern);
          }
          // 2. 경로/디렉터리 기반 매칭 (예: src-tauri/, Cargo.toml)
          return file.includes(cleanPattern);
        });
      });

      if (isTriggered) {
        activePluginNames.add(plugin.name);
      }
    }

    // 트리거된 플러그인이 전혀 없을 경우(예: 주석, markdown, ignore 파일 등만 수정된 경우)
    if (activePluginNames.size === 0) {
      return {
        runAll: false,
        activePluginNames: new Set(),
        reason: `변경된 ${modifiedFiles.length}개 파일이 등록된 검사 플러그인의 영향 범위에 속하지 않아 전체 검사를 스킵합니다.`,
        modifiedFiles,
      };
    }

    return {
      runAll: false,
      activePluginNames,
      reason: `변경된 ${modifiedFiles.length}개 파일 인과 분석 완료: [${Array.from(activePluginNames).join(', ')}] 플러그인만 선별 실행합니다.`,
      modifiedFiles,
    };
  } catch {
    // Git 상태 확인 실패 시 안전을 위해 전체 실행
    return {
      runAll: true,
      activePluginNames: allPluginNames,
      reason: 'Git 변경 추적 불가로 안전 모드(전체 검사)를 실행합니다.',
      modifiedFiles: [],
    };
  }
}
