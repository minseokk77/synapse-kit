/**
 * Synapse Kit - Causal Release & Deploy 코어 실행기 (synapse release / synapse deploy)
 * 토큰 절약형 초경량 릴리즈 엔진
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateCausalDigest } from '../deploy/summarizer';
import { ZeroTokenPreflightGuard } from '../deploy/guard';
import { executeGitHubRelease } from '../deploy/github';
import { executeBuild } from './engine';
import type { ReleaseOptions, ReleaseResult } from '../deploy/types';
import type { SynapseConfig, SynapseOptions } from '../types';
import { t } from '../i18n';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';

/**
 * 릴리즈 배포 실행 메인 루틴
 */
export async function executeRelease(
  config: SynapseConfig,
  releaseOpts: ReleaseOptions = {},
  options: SynapseOptions = { mode: 'smart', agentMode: false, compactMode: false, watch: false }
): Promise<number> {
  const rootDir = config.rootDir || process.cwd();
  const startTime = performance.now();
  const isCompact = releaseOpts.compact || options.compactMode;
  const isAgent = releaseOpts.agentMode || options.agentMode || isCompact;

  try {
    let effectiveTag = releaseOpts.tag;
    const finalAssets: string[] = [...(releaseOpts.assets || [])];

    // 0-1. 시맨틱 버전 자동 승격 (--bump patch | minor | major)
    if (releaseOpts.bump) {
      const pkgPath = resolve(rootDir, 'package.json');
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          const parts = (pkg.version || '0.1.0').split('.').map((p: string) => parseInt(p, 10) || 0);
          while (parts.length < 3) parts.push(0);

          if (releaseOpts.bump === 'major') {
            parts[0]++; parts[1] = 0; parts[2] = 0;
          } else if (releaseOpts.bump === 'minor') {
            parts[1]++; parts[2] = 0;
          } else {
            parts[2]++; // patch
          }

          const bumpedVersion = parts.join('.');
          if (!releaseOpts.dryRun) {
            pkg.version = bumpedVersion;
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
          }
          if (!effectiveTag) {
            effectiveTag = `v${bumpedVersion}`;
          }
        } catch {
          // 버전 범프 실패 시 기존 태그 유지
        }
      }
    }

    // 0-2. 사전 빌드 트랙 자동 실행 (--build)
    if (releaseOpts.build && config.buildTracks && config.buildTracks.length > 0) {
      if (!isCompact) {
        process.stdout.write(`\n${CYAN}⚡ [Axon Pre-build] 등록된 buildTracks 자동 선행 빌드 실행 중...${RESET}\n`);
      }
      const buildExit = await executeBuild(config, options);
      if (buildExit !== 0) return buildExit;

      for (const track of config.buildTracks) {
        if (track.artifacts) {
          for (const art of track.artifacts) {
            const artPath = resolve(rootDir, art);
            if (existsSync(artPath) && !finalAssets.includes(art)) {
              finalAssets.push(art);
            }
          }
        }
      }
    }

    // 1. 인과율 변경 다이제스트 자동 생성 (Zero-Token Causal Digest)
    const digest = await generateCausalDigest(rootDir);

    const activeReleaseOpts: ReleaseOptions = {
      ...releaseOpts,
      tag: effectiveTag,
      assets: finalAssets,
    };

    // 2. 릴리즈 사전 검증 (SecretShield & 대용량/제한 파일 가드)
    if (!releaseOpts.skipGuard) {
      const guard = new ZeroTokenPreflightGuard();
      const preflightResult = await guard.verifyRelease(
        releaseOpts.notes || digest.markdownNotes,
        finalAssets,
        activeReleaseOpts,
        rootDir
      );

      if (!preflightResult.passed) {
        if (isAgent) {
          process.stdout.write(
            JSON.stringify({
              ok: false,
              stage: 'preflight_guard',
              violations: preflightResult.violations,
              duration_ms: Number((performance.now() - startTime).toFixed(2)),
            }) + '\n'
          );
        } else {
          process.stderr.write(`\n${BOLD}${RED}🚨 [배포 차단] 릴리즈 사전 보안 검사에서 위반 사항이 발견되었습니다:${RESET}\n`);
          for (const v of preflightResult.violations) {
            process.stderr.write(` • [${v.severity}] ${v.target}: ${v.message}\n`);
          }
          process.stderr.write('\n');
        }
        return 1;
      }
    }

    // 3. GitHub CLI (gh release create) 실행
    const result = await executeGitHubRelease(digest, activeReleaseOpts, rootDir);

    const totalDurationMs = Number((performance.now() - startTime).toFixed(2));

    // 4. 결과 출력
    if (isAgent) {
      // AI 에이전트/컴팩트 모드: 단 1줄의 JSON 출력 (약 10~15 토큰)
      process.stdout.write(
        JSON.stringify({
          ok: result.ok,
          tag: result.tag,
          commit: result.commit,
          merkle: result.merkleRoot,
          tokens_saved: result.tokensSaved,
          duration_ms: totalDurationMs,
          dry_run: result.dryRun,
          release_url: result.releaseUrl,
          ...(result.error ? { error: result.error } : {}),
        }) + '\n'
      );
    } else {
      // 일반 CLI 사용자용 상세 리포트
      const line = '━'.repeat(68);
      process.stdout.write(`\n${BOLD}${CYAN}⚡ [Synapse Axon] 초경량 제로-토큰 GitHub 릴리즈 파이프라인${RESET}\n`);
      process.stdout.write(`${GRAY}${line}${RESET}\n`);
      process.stdout.write(` • 버전 태그       : ${BOLD}${result.tag}${RESET}\n`);
      process.stdout.write(` • 최신 커밋       : ${BOLD}${result.commit}${RESET}\n`);
      process.stdout.write(` • Merkle Root     : ${GRAY}${result.merkleRoot}${RESET}\n`);
      process.stdout.write(` • 토큰 절감량     : ${BOLD}${GREEN}+${result.tokensSaved.toLocaleString()} Tokens (${digest.compressionRatio}% 절감)${RESET}\n`);
      process.stdout.write(` • 소요 시간       : ${totalDurationMs}ms\n`);

      if (result.dryRun) {
        process.stdout.write(` • 실행 모드       : ${YELLOW}⚡ DRY-RUN (가상 시뮬레이션 완료, 실제 발행 안 됨)${RESET}\n`);
        process.stdout.write(`\n${BOLD}${CYAN}[생성된 초압축 릴리즈 노트 미리보기]${RESET}\n`);
        process.stdout.write(`${GRAY}${digest.markdownNotes}${RESET}\n\n`);
      } else if (result.ok) {
        process.stdout.write(` • 릴리즈 URL      : ${GREEN}${result.releaseUrl}${RESET}\n`);
        process.stdout.write(`${GRAY}${line}${RESET}\n`);
        process.stdout.write(`${BOLD}${GREEN}✨ GitHub 릴리즈가 성공적으로 발행되었습니다!${RESET}\n\n`);
      } else {
        process.stdout.write(` • 실패 원인       : ${RED}${result.error}${RESET}\n`);
        process.stdout.write(`${GRAY}${line}${RESET}\n`);
        process.stdout.write(`${BOLD}${RED}❌ GitHub 릴리즈 발행 실패${RESET}\n\n`);
      }
    }

    return result.ok ? 0 : 1;
  } catch (error) {
    const totalDurationMs = Number((performance.now() - startTime).toFixed(2));
    if (isAgent) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          duration_ms: totalDurationMs,
        }) + '\n'
      );
    } else {
      process.stderr.write(
        `\n${BOLD}${RED}🚨 [Synapse Release 오류]${RESET} ${error instanceof Error ? error.message : String(error)}\n\n`
      );
    }
    return 1;
  }
}
