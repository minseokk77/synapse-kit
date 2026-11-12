#!/usr/bin/env bun
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import pkg from '../package.json';
import { loadSynapseConfig } from './core/config';
import { executeChecks, executeBuild, executePackage, executeSign } from './core/engine';
import { executeRelease } from './core/release';
import { detectLocale, t } from './i18n';
import type { SynapseOptions, SynapseConfig } from './types';
import type { ReleaseOptions } from './deploy/types';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
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
  optic          AI-Native 초경량 브라우저 엔진 (Synapse Optic)
  axon           ${t('cmdRelease')}
  release        ${t('cmdRelease')}
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
    try {
      // @ts-ignore
      const { handleMemoryCommand } = await import('../../memory/cli');
      const code = await handleMemoryCommand(args, options);
      process.exit(code);
    } catch {
      process.stderr.write(`${RED}❌ Causal Memory 모듈이 설치되지 않았습니다. '@synapse-kit/memory' 패키지를 설치하거나 'synapse-memory' 명령어를 사용하세요.${RESET}\n`);
      process.exit(1);
    }
  }

  if (command === 'optic') {
    try {
      let OpticMod: any;
      try {
        // @ts-ignore
        OpticMod = await import('../optic');
      } catch {
        // @ts-ignore
        OpticMod = await import('../../optic');
      }
      const { SynapseOptic } = OpticMod;
      const optic = new SynapseOptic();
      const sub = args[args.indexOf('optic') + 1] || 'status';
      const targetArg = args[args.indexOf('optic') + 2];

      if (sub === 'open' || sub === 'goto' || sub === 'nav') {
        if (!targetArg) {
          process.stderr.write(`${RED}❌ URL이 지정되지 않았습니다. 사용법: synapse optic open <URL>${RESET}\n`);
          process.exit(1);
        }
        const snap = await optic.goto(targetArg);
        if (options.compactMode) {
          process.stdout.write(JSON.stringify({ ok: true, url: targetArg, totalNodes: snap.totalNodes, generation: snap.generation, durationMs: snap.durationMs }) + '\n');
        } else {
          process.stdout.write(snap.formattedPrompt + '\n');
        }
        process.exit(0);
      } else if (sub === 'click') {
        if (!targetArg) {
          process.stderr.write(`${RED}❌ 클릭 대상이 지정되지 않았습니다. 사용법: synapse optic click <@target|selector>${RESET}\n`);
          process.exit(1);
        }
        const res = await optic.click(targetArg);
        if (options.compactMode) {
          process.stdout.write(JSON.stringify(res) + '\n');
        } else {
          process.stdout.write(res.ok ? `${GREEN}✔ [성공] 요소 클릭 완료: ${targetArg}${RESET}\n` : `${RED}❌ [실패] ${res.error}${RESET}\n`);
        }
        process.exit(res.ok ? 0 : 1);
      } else if (sub === 'press') {
        if (!targetArg) {
          process.stderr.write(`${RED}❌ 키가 지정되지 않았습니다. 사용법: synapse optic press <Enter|Tab|Escape|...>${RESET}\n`);
          process.exit(1);
        }
        const res = await optic.press(targetArg);
        if (options.compactMode) {
          process.stdout.write(JSON.stringify(res) + '\n');
        } else {
          process.stdout.write(res.ok ? `${GREEN}✔ [성공] 키 타건 완료: ${targetArg}${RESET}\n` : `${RED}❌ [실패] ${res.error}${RESET}\n`);
        }
        process.exit(res.ok ? 0 : 1);
      } else {
        const status = optic.getStatus();
        if (options.compactMode) {
          process.stdout.write(JSON.stringify(status) + '\n');
        } else {
          process.stdout.write(`${CYAN}👁️ [Synapse Optic] AI-Native 브라우저 엔진\n  • 상태: ${status.connected ? GREEN + '연결됨 (Prometheus Driver)' : YELLOW + '대기 중'}${RESET}\n  • 엔드포인트: ${status.endpoint}\n  • 사용법:\n      synapse optic open <URL>\n      synapse optic click <@1|selector>\n      synapse optic press <Enter|Tab|...>\n      synapse optic shot [screenshot.png]\n`);
        }
        process.exit(0);
      }
    } catch (err: any) {
      process.stderr.write(`${RED}❌ Optic 실행 오류: ${err?.message || err}${RESET}\n`);
      process.exit(1);
    }
  }

  try {
    let config: SynapseConfig;
    try {
      const loaded = await loadSynapseConfig();
      config = loaded.config;
    } catch (err) {
      if (command === 'release' || command === 'deploy' || command === 'axon' || command === 'survey') {
        config = { plugins: [], rootDir: process.cwd() };
      } else {
        throw err;
      }
    }

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
    } else if (command === 'release' || command === 'deploy' || command === 'axon') {
      // 릴리즈 옵션 파싱
      let releaseTag: string | undefined;
      let releaseTitle: string | undefined;
      let releaseNotes: string | undefined;
      const releaseAssets: string[] = [];

      // 커맨드 이후의 인자 순회
      let releaseBump: 'patch' | 'minor' | 'major' | undefined;
      const cmdIndex = args.indexOf(command);
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (i > cmdIndex && !arg.startsWith('-') && !releaseTag) {
          releaseTag = arg;
        } else if (arg === '--tag' && args[i + 1]) {
          releaseTag = args[++i];
        } else if (arg === '--title' && args[i + 1]) {
          releaseTitle = args[++i];
        } else if (arg === '--notes' && args[i + 1]) {
          releaseNotes = args[++i];
        } else if ((arg === '--asset' || arg === '--assets') && args[i + 1]) {
          const raw = args[++i];
          const items = raw.includes(',') ? raw.split(',') : [raw];
          for (const item of items) {
            if (item.trim()) releaseAssets.push(item.trim());
          }
        } else if (arg === '--bump') {
          const next = args[i + 1];
          if (next && ['patch', 'minor', 'major'].includes(next)) {
            releaseBump = next as any;
            i++;
          } else {
            releaseBump = 'patch';
          }
        }
      }

      const releaseOpts: ReleaseOptions = {
        tag: releaseTag,
        title: releaseTitle,
        notes: releaseNotes,
        assets: releaseAssets,
        dryRun: args.includes('--dry-run'),
        compact: options.compactMode,
        agentMode: options.agentMode,
        skipGuard: args.includes('--skip-guard'),
        isDraft: args.includes('--draft'),
        isPrerelease: args.includes('--prerelease'),
        build: args.includes('--build'),
        bump: releaseBump,
      };

      const code = await executeRelease(config, releaseOpts, options);
      process.exit(code);
    } else if (command === 'survey') {
      const opticModPath = '../optic/src/surveyPipeline';
      const { runAcceleratedSurveyPipeline } = await import(opticModPath);
      let targetCount = 8;
      const countIdx = args.indexOf('--count');
      if (countIdx !== -1 && args[countIdx + 1]) {
        targetCount = parseInt(args[countIdx + 1], 10) || 8;
      }
      const result = await runAcceleratedSurveyPipeline({ targetCount });
      if (options.compactMode || options.agentMode) {
        process.stdout.write(JSON.stringify(result) + '\n');
      } else {
        process.stdout.write(`${GREEN}⚡ ${result.summary}${RESET}\n`);
        process.stdout.write(`${CYAN}  - 대상 논문: ${result.totalPapers}편 (2024~2026 최신 AI 브라우저 에이전트)${RESET}\n`);
        process.stdout.write(`${CYAN}  - 인과 공명 평균 지연: ${result.resonanceAverageMs}ms (O(1) Connectome)${RESET}\n`);
        process.stdout.write(`${CYAN}  - 파이프라인 총 완결 시간: ${result.pipelineDurationMs}ms${RESET}\n`);
      }
      process.exit(0);
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
