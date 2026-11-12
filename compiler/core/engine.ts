import { spawn } from 'bun';
import { existsSync, readdirSync, statSync, watch } from 'node:fs';
import { resolve } from 'node:path';
import type { CheckResult, CheckerPlugin, SynapseConfig, SynapseOptions } from '../types';
import { analyzeCausalGraph } from '../causal-graph';
import {
  loadBuildCache,
  saveBuildCache,
  getGitState,
  shouldSkipBuildTrack,
  shouldSkipSign,
  computeFileHash,
} from '../causal-build';
import { reportResults } from './reporter';
import { t } from '../i18n';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';

/**
 * 플러그인 단위 검사 실행기
 */
async function runPluginChecker(
  plugin: SynapseConfig['plugins'][number],
  isActive: boolean,
  rootDir: string,
  options: SynapseOptions
): Promise<CheckResult> {
  if (!isActive) {
    return {
      name: plugin.name,
      title: plugin.title,
      status: 'skipped',
      durationMs: 0,
      details: t('checkSkipped'),
    };
  }

  try {
    return await plugin.check({ rootDir, options });
  } catch (error) {
    return {
      name: plugin.name,
      title: plugin.title,
      status: 'error',
      durationMs: 0,
      details: `Critical plugin execution failure: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 시냅스 검사 엔진 구동 루틴 (synapse check)
 */
export async function executeChecks(config: SynapseConfig, options: SynapseOptions): Promise<number> {
  const rootDir = config.rootDir || process.cwd();
  const startTime = performance.now();

  // 1. AI 인과율 메모리 분석
  const decision = await analyzeCausalGraph(rootDir, config.plugins, options);

  // 2. 등록된 모든 플러그인 동시 병렬 실행
  const results = await Promise.all(
    config.plugins.map((plugin) =>
      runPluginChecker(plugin, decision.activePluginNames.has(plugin.name), rootDir, options)
    )
  );

  const totalDurationMs = performance.now() - startTime;

  // 3. 결과 리포팅
  reportResults(decision, results, totalDurationMs, options);

  const hasError = results.some((r) => r.status === 'error');

  // 검증 성공 시 Git HEAD 캐시 기록 (Clean Worktree 0.00초 스킵 보장)
  if (!hasError) {
    const cache = loadBuildCache(rootDir);
    const { head } = await getGitState(rootDir);
    if (head && head !== 'unknown') {
      cache.lastVerifiedHead = head;
      saveBuildCache(rootDir, cache);
    }
  }

  // 4. 대화형 인과 핫픽스 루프 (--interactive, -i)
  if (hasError && options.interactive) {
    const failedNames = new Set(results.filter((r) => r.status === 'error').map((r) => r.name));
    const failedPlugins = config.plugins.filter((p) => failedNames.has(p.name));
    return await runInteractiveLoop(failedPlugins, rootDir, options);
  }

  return hasError ? 1 : 0;
}

/**
 * 대화형 인과 핫픽스 감시 루프 (--interactive, -i)
 */
async function runInteractiveLoop(
  failedPlugins: readonly CheckerPlugin[],
  rootDir: string,
  options: SynapseOptions
): Promise<number> {
  const line = '━'.repeat(68);
  process.stdout.write(`\n${BOLD}${CYAN}${t('interactiveTitle')}${RESET}\n`);
  process.stdout.write(`${GRAY}${line}${RESET}\n`);
  process.stdout.write(` • ${t('interactiveTarget')} : ${BOLD}${failedPlugins.map((p) => p.name).join(', ')}${RESET}\n`);
  process.stdout.write(` • ${t('interactiveWatching')}\n`);
  process.stdout.write(` • ${t('interactiveExit')}\n`);
  process.stdout.write(`${GRAY}${line}${RESET}\n\n`);

  return new Promise((resolve) => {
    let isChecking = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const watcher = watch(rootDir, { recursive: true }, async (_eventType, filename) => {
      if (!filename) return;
      const normalized = filename.replace(/\\/g, '/');

      // 빌드 아티팩트 및 임시 파일 무시
      if (
        normalized.includes('target/') ||
        normalized.includes('node_modules/') ||
        normalized.includes('.git/') ||
        normalized.includes('.svelte-kit/') ||
        normalized.includes('dist/') ||
        normalized.includes('.synapse/')
      ) {
        return;
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (isChecking) return;
        isChecking = true;

        const timeStr = new Date().toLocaleTimeString('ko-KR', { hour12: false });
        process.stdout.write(`\n${CYAN}${t('interactiveDetected', timeStr, normalized)}${RESET}\n`);

        const retryStart = performance.now();
        const retryResults = await Promise.all(
          failedPlugins.map((p) => p.check({ rootDir, options }))
        );
        const retryDuration = ((performance.now() - retryStart) / 1000).toFixed(2);

        const stillFailed = retryResults.some((r) => r.status === 'error');
        if (!stillFailed) {
          process.stdout.write(`${BOLD}${GREEN}${t('interactivePassed', retryDuration)}${RESET}\n`);
          process.stdout.write(`${BOLD}${CYAN}${t('interactiveResumed')}${RESET}\n\n`);
          watcher.close();

          // 통과 시 캐시 업데이트
          const cache = loadBuildCache(rootDir);
          const { head } = await getGitState(rootDir);
          if (head && head !== 'unknown') {
            cache.lastVerifiedHead = head;
            saveBuildCache(rootDir, cache);
          }

          resolve(0);
        } else {
          process.stdout.write(`${BOLD}${RED}${t('interactiveFailed')}${RESET}\n`);
          for (const res of retryResults) {
            if (res.status === 'error' && res.details) {
              process.stdout.write(`   └─ ${GRAY}${res.details}${RESET}\n`);
            }
          }
          isChecking = false;
        }
      }, 60);
    });
  });
}

/**
 * 시냅스 인과율 병렬 빌드 엔진 구동 루틴 (synapse build)
 */
export async function executeBuild(
  config: SynapseConfig,
  options: SynapseOptions = { mode: 'smart', agentMode: false, compactMode: false, watch: false }
): Promise<number> {
  const rootDir = config.rootDir || process.cwd();
  const tracks = config.buildTracks || [];

  if (tracks.length === 0) {
    process.stderr.write(`${RED}${t('noBuildTracks')}${RESET}\n`);
    return 1;
  }

  const startTime = performance.now();
  const line = '━'.repeat(68);

  process.stdout.write(`\n${BOLD}${CYAN}${t('buildHeader')} (${tracks.length})${RESET}\n`);
  process.stdout.write(`${GRAY}${line}${RESET}\n`);

  const cache = loadBuildCache(rootDir);
  const { head: currentHead, modifiedFiles, repoRoot } = await getGitState(rootDir);
  const isForce = options.force || options.mode === 'all';

  const taskPromises = tracks.map(async (track) => {
    const { skip, reason } = shouldSkipBuildTrack(track, rootDir, repoRoot, cache, modifiedFiles, isForce);

    if (skip) {
      return {
        name: track.name,
        durationMs: 0,
        exitCode: 0,
        skipped: true,
        reason,
      };
    }

    const trackStart = performance.now();
    const proc = spawn([...track.command], {
      cwd: track.cwd || rootDir,
      stdout: 'inherit',
      stderr: 'inherit',
    });

    const exitCode = await proc.exited;
    const durationMs = performance.now() - trackStart;
    return {
      name: track.name,
      durationMs,
      exitCode,
      skipped: false,
      reason,
    };
  });

  const taskResults = await Promise.all(taskPromises);
  const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);
  const hasFailed = taskResults.some((t) => t.exitCode !== 0);

  process.stdout.write(`${GRAY}${line}${RESET}\n`);
  for (const res of taskResults) {
    if (res.skipped) {
      process.stdout.write(
        ` • ${BOLD}${res.name.padEnd(38, ' ')}${RESET} : ${YELLOW}⚡ ${t('trackSkipped')}${RESET} ${GRAY}(0.00s)${RESET}\n`
      );
    } else {
      const sec = (res.durationMs / 1000).toFixed(2);
      const badge = res.exitCode === 0 ? `${GREEN}✅ ${t('trackComplete')} (${sec}s)${RESET}` : `${RED}❌ ${t('trackFailed')} (${sec}s)${RESET}`;
      process.stdout.write(` • ${BOLD}${res.name.padEnd(38, ' ')}${RESET} : ${badge}\n`);
    }
  }
  process.stdout.write(`${GRAY}${line}${RESET}\n`);

  if (!hasFailed) {
    const now = new Date().toISOString();
    for (const res of taskResults) {
      if (!res.skipped && res.exitCode === 0) {
        cache.tracks[res.name] = {
          lastBuildTime: now,
          gitCommit: currentHead,
          artifactExists: true,
        };
      }
    }
    saveBuildCache(rootDir, cache);

    process.stdout.write(
      `${BOLD}${GREEN}${t('buildSuccessSummary', tracks.length, totalDuration)}${RESET}\n\n`
    );
    return 0;
  } else {
    process.stdout.write(`${BOLD}${RED}${t('buildFailureSummary')}${RESET}\n\n`);
    return 1;
  }
}

/**
 * 시냅스 고속 인스톨러 패키징 엔진 구동 루틴 (synapse package)
 */
export async function executePackage(
  config: SynapseConfig,
  options: SynapseOptions = { mode: 'smart', agentMode: false, compactMode: false, watch: false }
): Promise<number> {
  const rootDir = config.rootDir || process.cwd();
  const startTime = performance.now();
  const line = '━'.repeat(68);

  process.stdout.write(`\n${BOLD}${CYAN}${t('packageHeader')}${RESET}\n`);
  process.stdout.write(`${GRAY}${line}${RESET}\n`);

  // 1. 사전 인과율 빌드 자동 선행
  if (config.buildTracks && config.buildTracks.length > 0) {
    process.stdout.write(`${CYAN}${t('packagingPreBuild')}${RESET}\n`);
    const buildExit = await executeBuild(config, options);
    if (buildExit !== 0) return buildExit;
  }

  // 2. Tauri 설정 자동 진단 및 패키징 실행
  const tauriConfCandidates = [
    resolve(rootDir, 'src-tauri/tauri.conf.json'),
    resolve(rootDir, 'tauri.conf.json'),
  ];
  const tauriConfPath = tauriConfCandidates.find((p) => existsSync(p));

  if (tauriConfPath) {
    try {
      const content = await Bun.file(tauriConfPath).json();
      const targets = content?.bundle?.targets;
      if (targets === 'all') {
        process.stdout.write(`${YELLOW}${t('packagingGuide')}${RESET}\n`);
      }
    } catch {
      // JSON 파싱 실패 무시
    }
  }

  process.stdout.write(`${BOLD}${t('packagingStart')}${RESET}\n`);
  const pkgProc = spawn(['bun', 'x', 'tauri', 'build', '--bundles', 'nsis'], {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await pkgProc.exited;
  const duration = ((performance.now() - startTime) / 1000).toFixed(2);

  process.stdout.write(`${GRAY}${line}${RESET}\n`);
  if (exitCode === 0) {
    process.stdout.write(`${BOLD}${GREEN}${t('packageSuccess', duration)}${RESET}\n\n`);
    return 0;
  } else {
    process.stdout.write(`${BOLD}${RED}${t('packageFailed', duration)}${RESET}\n\n`);
    return exitCode;
  }
}

/**
 * 시냅스 인과율 암호화 서명 엔진 구동 루틴 (synapse sign)
 */
export async function executeSign(
  config: SynapseConfig,
  options: SynapseOptions = { mode: 'smart', agentMode: false, compactMode: false, watch: false }
): Promise<number> {
  const rootDir = config.rootDir || process.cwd();
  const startTime = performance.now();
  const line = '━'.repeat(68);

  process.stdout.write(`\n${BOLD}${CYAN}${t('signHeader')}${RESET}\n`);
  process.stdout.write(`${GRAY}${line}${RESET}\n`);

  const signConfig = config.sign;
  if (!signConfig || !signConfig.privateKeyPath) {
    process.stderr.write(`${RED}${t('signNoConfig')}${RESET}\n`);
    return 1;
  }

  const keyPath = resolve(rootDir, signConfig.privateKeyPath);
  if (!existsSync(keyPath)) {
    process.stderr.write(`${RED}${t('signNoKey', keyPath)}${RESET}\n`);
    return 1;
  }

  // 서명 대상 인스톨러 파일 탐색
  let installerPath = signConfig.targetInstaller ? resolve(rootDir, signConfig.targetInstaller) : '';

  if (!installerPath || !existsSync(installerPath)) {
    const candidates = [
      resolve(rootDir, 'target/release/bundle/nsis'),
      resolve(rootDir, 'src-tauri/target/release/bundle/nsis'),
      resolve(rootDir, '../target/release/bundle/nsis'),
    ];

    for (const dir of candidates) {
      if (existsSync(dir)) {
        const files = readdirSync(dir)
          .filter((f) => f.endsWith('.exe') && !f.endsWith('.sig'))
          .map((f) => ({ name: f, time: statSync(resolve(dir, f)).mtimeMs }))
          .sort((a, b) => b.time - a.time);
        if (files.length > 0) {
          installerPath = resolve(dir, files[0].name);
          break;
        }
      }
    }
  }

  if (!installerPath || !existsSync(installerPath)) {
    process.stderr.write(`${RED}${t('signNoInstaller')}${RESET}\n`);
    return 1;
  }

  const signaturePath = `${installerPath}.sig`;
  const cache = loadBuildCache(rootDir);
  const isForce = options.force || options.mode === 'all';

  // 인과율 스킵 가드 검사
  const { skip, reason, currentHash } = shouldSkipSign(installerPath, signaturePath, cache, isForce);

  if (skip) {
    process.stdout.write(
      ` • ${t('signTarget')} : ${BOLD}${installerPath}${RESET}\n` +
      ` • ${t('signStatus')} : ${YELLOW}⚡ ${t('signCacheHit')}${RESET} ${GRAY}(0.00s)${RESET}\n` +
      ` • ${t('signFile')}   : ${GREEN}✅ ${t('signExistingKeep', signaturePath)}${RESET}\n`
    );
    process.stdout.write(`${GRAY}${line}${RESET}\n`);
    process.stdout.write(`${BOLD}${GREEN}${t('signIntegrityPass')}${RESET}\n\n`);
    return 0;
  }

  process.stdout.write(` • ${t('signTarget')} : ${BOLD}${installerPath}${RESET}\n`);
  process.stdout.write(` • ${t('signReasonLabel')} : ${CYAN}${reason}${RESET}\n`);
  process.stdout.write(` • ${t('signEngineLabel')} : ${BOLD}Bun Native Tauri Signer (Ed25519)${RESET}\n`);

  const passwordEnvName = signConfig.passwordEnv || 'TAURI_KEY_PASSWORD';
  const passwordVal =
    process.env[passwordEnvName] ||
    process.env.TAURI_PRIVATE_KEY_PASSWORD ||
    process.env.TAURI_KEY_PASSWORD ||
    '';

  const signArgs = [
    'bun',
    'x',
    'tauri',
    'signer',
    'sign',
    '--private-key-path',
    keyPath,
  ];
  if (passwordVal) {
    signArgs.push('--password', passwordVal);
  }
  signArgs.push(installerPath);

  const proc = spawn(signArgs, {
    cwd: rootDir,
    env: {
      ...process.env,
      TAURI_PRIVATE_KEY_PASSWORD: passwordVal,
      TAURI_KEY_PASSWORD: passwordVal,
    },
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;
  const duration = ((performance.now() - startTime) / 1000).toFixed(2);

  process.stdout.write(`${GRAY}${line}${RESET}\n`);
  if (exitCode === 0) {
    cache.sign = {
      lastSignTime: new Date().toISOString(),
      installerHash: currentHash || computeFileHash(installerPath),
      signaturePath,
    };
    saveBuildCache(rootDir, cache);

    process.stdout.write(
      `${BOLD}${GREEN}${t('signSuccess', duration)}${RESET}\n` +
      ` • ${t('signFile')}: ${BOLD}${signaturePath}${RESET}\n\n`
    );
    return 0;
  } else {
    process.stdout.write(`${BOLD}${RED}${t('signFailed', duration)}${RESET}\n\n`);
    return exitCode;
  }
}
