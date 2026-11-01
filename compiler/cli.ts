#!/usr/bin/env bun
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import pkg from '../package.json';
import { loadSynapseConfig } from './core/config';
import { executeChecks, executeBuild, executePackage, executeSign } from './core/engine';
import { handleMemoryCommand } from '../memory/cli';
import { detectLocale, t } from './i18n';
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
    process.stderr.write(`${RED}❌ ${t('configExists')} ${configPath}${RESET}\n`);
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
    {
      name: 'APO DLL 빌드',
      command: ['bun', 'tooling/build-apo.mjs'],
      sources: ['vesper-apo/'],
      artifacts: ['src-tauri/resources/vesper_apo.dll'],
    },
    {
      name: 'Taskbar 위젯 빌드',
      command: ['bun', 'tooling/build-taskbar.mjs'],
      sources: ['windhawk/', 'standalone/'],
      artifacts: ['src-tauri/resources/taskbar/VesperTaskbar.dll'],
    },
    {
      name: 'Svelte UI 빌드',
      command: ['bun', 'run', 'build'],
      sources: ['src/', 'static/'],
      artifacts: ['build/index.html'],
    },
  ],
  package: {
    framework: 'tauri',
    targets: ['nsis'],
    compression: 'zlib',
  },
  sign: {
    privateKeyPath: 'src-tauri/keys/updater',
    passwordEnv: 'TAURI_KEY_PASSWORD',
  },
});
`;

  await writeFile(configPath, template, 'utf8');
  process.stdout.write(`${BOLD}${GREEN}✅ ${t('configCreated')}${RESET}\n`);
  return 0;
}

/**
 * CLI 도움말 출력
 */
function printHelp(): void {
  process.stdout.write(`
${BOLD}${CYAN}${t('cliTitle')}${RESET}

${BOLD}${t('cliUsage')}${RESET}
  synapse <command> [options]

${BOLD}${t('cliCommands')}${RESET}
  check          ${t('cmdCheck')}
  build          ${t('cmdBuild')}
  package        ${t('cmdPackage')}
  sign           ${t('cmdSign')}
  init           ${t('cmdInit')}
  memory         ${t('cmdMemory')}

${BOLD}${t('cliOptions')}${RESET}
  --all              ${t('optAll')}
  -f, --force        ${t('optForce')}
  --agent            ${t('optAgent')}
  --compact          ${t('optCompact')}
  -i, --interactive  ${t('optInteractive')}
  --watch            ${t('optWatch')}
  --lang <ko|en>     ${t('optLang')}
  --help, -h         ${t('optHelp')}
  --version, -v      ${t('optVersion')}
\n`);
}

/**
 * CLI 메인 진입점
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // 로케일 파싱 (--lang=ko, --lang=en, --lang ko, --lang en)
  let explicitLang: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--lang=')) {
      explicitLang = args[i].split('=')[1];
    } else if (args[i] === '--lang' && args[i + 1]) {
      explicitLang = args[i + 1];
    }
  }
  detectLocale(explicitLang);

  if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    printHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v') || args[0] === 'version') {
    process.stdout.write(`synapse-kit v${pkg.version}\n`);
    process.exit(0);
  }

  // 플래그가 아닌 첫 번째 비-옵션 인자를 명령어로 인식 (기본값: 'check')
  const command = args.find((a) => !a.startsWith('-')) || 'check';

  if (command === 'init') {
    const code = await handleInit();
    process.exit(code);
  }

  const isInteractive = args.includes('--interactive') || args.includes('-i');
  const isForce = args.includes('--force') || args.includes('-f');

  const options: SynapseOptions = {
    mode: args.includes('--all') ? 'all' : 'smart',
    agentMode: args.includes('--agent') || args.includes('--compact'),
    compactMode: args.includes('--compact'),
    watch: args.includes('--watch'),
    interactive: isInteractive,
    force: isForce,
  };

  if (command === 'memory') {
    const code = await handleMemoryCommand(args, options);
    process.exit(code);
  }

  try {
    const { config } = await loadSynapseConfig();

    if (command === 'check') {
      const code = await executeChecks(config, options);
      process.exit(code);
    } else if (command === 'build') {
      const code = await executeBuild(config, options);
      process.exit(code);
    } else if (command === 'package') {
      const code = await executePackage(config, options);
      process.exit(code);
    } else if (command === 'sign') {
      const code = await executeSign(config, options);
      process.exit(code);
    } else {
      process.stderr.write(`${RED}❌ ${t('unknownCmd')} '${command}'${RESET}\n`);
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
      process.stderr.write(`${RED}${t('errPrefix')}${RESET} ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  }
}

main();
