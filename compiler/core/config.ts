import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { CheckerPlugin, SynapseConfig } from '../types';
import { rustChecker } from '../plugins/rust';
import { typescriptChecker } from '../plugins/typescript';
import { svelteChecker } from '../plugins/svelte';
import { pythonChecker } from '../plugins/python';
import { goChecker } from '../plugins/go';
import { schemaChecker } from '../plugins/schema';

/**
 * 프레임워크 설정 헬퍼 (타입 추론 지원)
 */
export function defineConfig(config: SynapseConfig): SynapseConfig {
  return config;
}

/**
 * 커스텀 체커 플러그인 생성 헬퍼 (타입 추론 지원)
 */
export function createCheckerPlugin(plugin: CheckerPlugin): CheckerPlugin {
  return plugin;
}

const CONFIG_FILENAMES = [
  'synapse.config.ts',
  'synapse.config.js',
  'synapse.config.mjs',
] as const;

/**
 * 프로젝트 루트 파일들을 감지하여 자동으로 플러그인을 구성하는 Zero-Config 추론 엔진
 */
export function inferZeroConfig(targetDir: string = process.cwd()): SynapseConfig | null {
  const plugins: CheckerPlugin[] = [];

  // 1. Rust 프로젝트 감지
  if (existsSync(resolve(targetDir, 'Cargo.toml')) || existsSync(resolve(targetDir, 'src-tauri/Cargo.toml'))) {
    const ws = existsSync(resolve(targetDir, 'src-tauri/Cargo.toml')) ? './src-tauri' : './';
    plugins.push(rustChecker({ workspaceDir: ws }));
  }

  // 2. Svelte & TypeScript 감지
  const tsconfigPath = resolve(targetDir, 'tsconfig.json');
  const hasTsConfig = existsSync(tsconfigPath);
  const pkgPath = resolve(targetDir, 'package.json');
  let hasSvelteDep = false;

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      hasSvelteDep = Boolean(deps['svelte'] || deps['@sveltejs/kit']);
    } catch {
      // 파싱 실패 무시
    }
  }

  if (hasSvelteDep && hasTsConfig) {
    plugins.push(svelteChecker({ tsconfig: './tsconfig.json' }));
  } else if (hasTsConfig) {
    plugins.push(typescriptChecker({ tsconfig: './tsconfig.json' }));
  }

  // 3. Python 프로젝트 감지
  if (
    existsSync(resolve(targetDir, 'pyproject.toml')) ||
    existsSync(resolve(targetDir, 'requirements.txt')) ||
    existsSync(resolve(targetDir, 'setup.py'))
  ) {
    plugins.push(pythonChecker());
  }

  // 4. Go 프로젝트 감지
  if (existsSync(resolve(targetDir, 'go.mod'))) {
    plugins.push(goChecker());
  }

  // 5. Tauri Schema 감지
  const tauriConfCandidates = [
    resolve(targetDir, 'src-tauri/tauri.conf.json'),
    resolve(targetDir, 'tauri.conf.json'),
  ];
  const foundTauriConf = tauriConfCandidates.find((p) => existsSync(p));
  if (foundTauriConf) {
    const rel = foundTauriConf.includes('src-tauri') ? './src-tauri/tauri.conf.json' : './tauri.conf.json';
    plugins.push(schemaChecker({ targets: [{ path: rel }] }));
  }

  if (plugins.length === 0) {
    return null;
  }

  return {
    rootDir: targetDir,
    aiMemory: {
      enabled: true,
      smartSkipping: true,
    },
    plugins,
  };
}

/**
 * 프로젝트 내의 synapse.config 설정 파일을 탐색하고 로드합니다.
 * 설정 파일이 없을 경우 Zero-Config 자동 추론을 시도합니다.
 */
export async function loadSynapseConfig(
  targetDir: string = process.cwd()
): Promise<{ config: SynapseConfig; configPath: string }> {
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
        throw new Error(
          `설정 파일(${candidate}) 로딩 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // synapse.config.ts 가 없을 때 Zero-Config 자동 추론
  const autoConfig = inferZeroConfig(targetDir);
  if (autoConfig) {
    return {
      config: autoConfig,
      configPath: 'auto-inferred (Zero-Config)',
    };
  }

  throw new Error(
    `프로젝트 루트(${targetDir})에서 synapse.config.ts 파일을 찾을 수 없으며 자동 감지 가능한 프로젝트(Rust, TS, Svelte, Go, Python 등)가 아닙니다.\n` +
    `'synapse init' 명령어를 실행하여 기본 설정 파일을 생성해 주세요.`
  );
}
