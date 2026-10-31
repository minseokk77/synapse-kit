import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { SynapseConfig } from '../types';

/**
 * 프레임워크 설정 헬퍼 (타입 추론 지원)
 */
export function defineConfig(config: SynapseConfig): SynapseConfig {
  return config;
}

const CONFIG_FILENAMES = [
  'synapse.config.ts',
  'synapse.config.js',
  'synapse.config.mjs',
] as const;

/**
 * 프로젝트 내의 synapse.config 설정 파일을 탐색하고 로드합니다.
 */
export async function loadSynapseConfig(targetDir: string = process.cwd()): Promise<{ config: SynapseConfig; configPath: string }> {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = resolve(targetDir, filename);
    if (existsSync(candidate)) {
      try {
        const imported = await import(candidate);
        const config: SynapseConfig = imported.default || imported;
        return {
          config: {
            ...config,
            rootDir: config.rootDir ? resolve(targetDir, config.rootDir) : targetDir,
          },
          configPath: candidate,
        };
      } catch (error) {
        throw new Error(`설정 파일(${candidate}) 로딩 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  throw new Error(
    `프로젝트 루트(${targetDir})에서 synapse.config.ts 파일을 찾을 수 없습니다.\n` +
    `'synapse init' 명령어를 실행하여 기본 설정 파일을 생성해 주세요.`
  );
}
