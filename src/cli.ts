#!/usr/bin/env bun
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { loadSynapseConfig } from './core/config';
import { executeChecks, executeBuild } from './core/engine';
import type { SynapseOptions } from './types';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';

/**
 * 기본 synapse.config.ts 템플릿 생성기 (synapse init)
 */
async function handleInit(targetDir: string = process.cwd()): Promise<number> {
  const configPath = resolve(targetDir, 'synapse.config.ts');
  if (existsSync(configPath)) {
    process.stderr.write(`${RED}❌ 이미 ${configPath} 파일이 존재합니다.${RESET}\n`);
    return 1;
  }

  const template = `import { defineConfig, rustChecker, svelteChecker, schemaChecker, nativeChecker, nsisChecker } from 'synapse-kit';

export default defineConfig({
  aiMemory: {
    enabled: true,
    smartSkipping: true,
  },
  plugins: [
    rustChecker({ workspaceDir: './src-tauri' }),
    svelteChecker({ tsconfig: './tsconfig.json' }),
    schemaChecker({
      targets: [
        { path: './src-tauri/tauri.conf.json' },
      ],
    }),
    nativeChecker({
      targets: [
        { path: './src-tauri/resources/vesper_apo.dll', expectedArchitecture: 'x64' },
      ],
    }),
    nsisChecker({
      templatePath: './installer-template.nsi',
    }),
  ],
  buildTracks: [
    { name: 'APO DLL 빌드', command: ['bun', 'tooling/build-apo.mjs'] },
    { name: 'Svelte UI 빌드', command: ['bun', 'run', 'build'] },
  ],
});
`;

  await writeFile(configPath, template, 'utf8');
  process.stdout.write(`${BOLD}${GREEN}✅ synapse.config.ts 파일이 성공적으로 생성되었습니다!${RESET}\n`);
  return 0;
}

/**
 * CLI 도움말 출력
 */
function printHelp(): void {
  process.stdout.write(`
${BOLD}${CYAN}🧠 Synapse Kit - AI-Native Unified Compiler & Verification Framework${RESET}

${BOLD}사용법:${RESET}
  synapse <command> [options]

${BOLD}명령어:${RESET}
  check          등록된 플러그인 무결성 검증 실행 (기본: AI 인과율 스마트 검사)
  build          등록된 buildTracks 동시 병렬 빌드 실행
  init           현재 디렉터리에 기본 synapse.config.ts 생성

${BOLD}옵션:${RESET}
  --all          인과율 스킵을 끄고 모든 플러그인 전방위 강제 검사
  --agent        AI 에이전트(Claude Code, Antigravity 등) 연동용 구조화된 JSON 출력
  --watch        파일 변경 감지 백그라운드 모드 (준비 중)
  --help, -h     도움말 표시
  --version, -v  버전 정보 표시
\n`);
}

/**
 * CLI 메인 진입점
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'check';

  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    process.exit(0);
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`synapse-kit v0.1.0\n`);
    process.exit(0);
  }

  if (command === 'init') {
    const code = await handleInit();
    process.exit(code);
  }

  const options: SynapseOptions = {
    mode: args.includes('--all') ? 'all' : 'smart',
    agentMode: args.includes('--agent') || args.includes('--compact'),
    compactMode: args.includes('--compact'),
    watch: args.includes('--watch'),
  };

  try {
    const { config } = await loadSynapseConfig();

    if (command === 'check') {
      const code = await executeChecks(config, options);
      process.exit(code);
    } else if (command === 'build') {
      const code = await executeBuild(config);
      process.exit(code);
    } else {
      process.stderr.write(`${RED}❌ 알 수 없는 명령어: '${command}'${RESET}\n`);
      printHelp();
      process.exit(1);
    }
  } catch (error) {
    if (options.agentMode) {
      process.stdout.write(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }) + '\n'
      );
    } else {
      process.stderr.write(`${RED}🚨 오류:${RESET} ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  }
}

main();
