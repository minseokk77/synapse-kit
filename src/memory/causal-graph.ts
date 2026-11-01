import type { CausalDecision, CheckerPlugin, SynapseOptions } from '../types';
import { getGitState, loadBuildCache } from './causal-build';
import { t } from '../i18n';

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
      reason: t('causalAll'),
      modifiedFiles: [],
    };
  }

  try {
    const { head, modifiedFiles } = await getGitState(rootDir);

    // 변경된 파일이 없는 경우 (Clean Working Tree)
    if (modifiedFiles.length === 0) {
      const cache = loadBuildCache(rootDir);

      // 이전 검증 통과 커밋과 현재 HEAD가 일치하면 즉시 0.00초 스킵!
      if (cache.lastVerifiedHead && cache.lastVerifiedHead === head && head !== 'unknown') {
        return {
          runAll: false,
          activePluginNames: new Set(),
          reason: t('causalCleanCacheHit'),
          modifiedFiles: [],
        };
      }

      // 첫 실행이거나 HEAD가 바뀐 경우 베이스라인 검사 수행
      return {
        runAll: true,
        activePluginNames: allPluginNames,
        reason: t('causalBaseline'),
        modifiedFiles: [],
      };
    }

    const activePluginNames = new Set<string>();

    for (const plugin of plugins) {
      const isTriggered = plugin.triggers.some((pattern) => {
        const cleanPattern = pattern.replaceAll('\\', '/').replace(/^\.\//, '');
        const isExtension = cleanPattern.startsWith('.');

        return modifiedFiles.some((file) => {
          // 1. 확장자 기반 매칭 (예: .rs, .svelte, .ts, .cpp 등)
          if (isExtension) {
            return file.endsWith(cleanPattern);
          }
          // 2. 경로/디렉터리 기반 매칭 (예: src-tauri/, Cargo.toml 등)
          return file.includes(cleanPattern);
        });
      });

      if (isTriggered) {
        activePluginNames.add(plugin.name);
      }
    }

    // 트리거된 플러그인이 전혀 없을 경우 (예: 주석, markdown, ignore 파일 등만 수정된 경우)
    if (activePluginNames.size === 0) {
      return {
        runAll: false,
        activePluginNames: new Set(),
        reason: t('causalUnrelated', modifiedFiles.length),
        modifiedFiles,
      };
    }

    return {
      runAll: false,
      activePluginNames,
      reason: t('causalDirty', modifiedFiles.length, Array.from(activePluginNames).join(', ')),
      modifiedFiles,
    };
  } catch {
    // Git 상태 확인 실패 시 안전을 위해 전체 실행
    return {
      runAll: true,
      activePluginNames: allPluginNames,
      reason: t('causalGitFail'),
      modifiedFiles: [],
    };
  }
}
