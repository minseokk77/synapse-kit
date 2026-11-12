/**
 * Synapse Kit - GitHub Release Engine
 * 사용자 전역 규칙 준수: GitHub 릴리즈 배포 시 반드시 GitHub CLI (gh release create) 사용 의무화
 */

import { spawn } from 'bun';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { AXON_DEFAULTS, SAFE_TAG_PATTERN } from './config';
import type { CausalDigest, ReleaseOptions, ReleaseResult } from './types';

/**
 * 시스템 내 GitHub CLI (gh) 바이너리 가용성 점검
 */
export async function checkGitHubCliAvailable(): Promise<{ available: boolean; version?: string }> {
  try {
    const proc = spawn(['gh', '--version'], { stdout: 'pipe', stderr: 'pipe' });
    const output = (await new Response(proc.stdout).text()).trim();
    const exitCode = await proc.exited;

    if (exitCode === 0 && output) {
      const match = output.match(/gh version ([^\s]+)/);
      return { available: true, version: match ? match[1] : 'unknown' };
    }
  } catch {
    // gh 명령어가 PATH에 없는 경우
  }

  return { available: false };
}

/**
 * package.json 등에서 기본 릴리즈 버전 태그 추출
 * 태그 인젝션 및 불법 CLI 플래그 삽입 공격을 철저히 차단
 */
export function resolveReleaseTag(explicitTag?: string, rootDir: string = process.cwd()): string {
  if (explicitTag !== undefined && explicitTag !== null) {
    const trimmed = explicitTag.trim();
    if (trimmed.length > 0) {
      if (trimmed.startsWith('-') || !SAFE_TAG_PATTERN.test(trimmed)) {
        throw new Error(`유효하지 않은 릴리즈 태그 형식입니다: ${explicitTag}`);
      }
      return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
    }
  }

  // package.json 확인
  const pkgPath = resolve(rootDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.version) {
        const pkgTag = `v${pkg.version}`;
        if (SAFE_TAG_PATTERN.test(pkgTag)) {
          return pkgTag;
        }
      }
    } catch {
      // 파싱 실패 시 fallback
    }
  }

  return AXON_DEFAULTS.FALLBACK_TAG;
}

/**
 * GitHub CLI (gh release create)를 통한 초경량 릴리즈 생성
 */
export async function executeGitHubRelease(
  digest: CausalDigest,
  options: ReleaseOptions = {},
  rootDir: string = process.cwd()
): Promise<ReleaseResult> {
  const startTime = performance.now();
  const tag = resolveReleaseTag(options.tag, rootDir);
  const title = options.title || `${tag} - 시냅스 엑손 (Synapse Axon) 인과율 릴리즈`;
  const notes = options.notes || digest.markdownNotes;
  const assets = options.assets || [];

  // Dry-run 모드인 경우 실제 gh 호출을 건너뛰고 가상 성공 결과 반환
  if (options.dryRun) {
    const durationMs = Number((performance.now() - startTime).toFixed(2));
    return {
      ok: true,
      tag,
      commit: digest.commitHash,
      merkleRoot: digest.merkleRoot,
      releaseUrl: `https://github.com/dry-run/releases/tag/${tag}`,
      tokensSaved: digest.tokensSaved,
      durationMs,
      dryRun: true,
    };
  }

  // 1. GitHub CLI 가용성 검증
  const cliCheck = await checkGitHubCliAvailable();
  if (!cliCheck.available) {
    const durationMs = Number((performance.now() - startTime).toFixed(2));
    return {
      ok: false,
      tag,
      commit: digest.commitHash,
      merkleRoot: digest.merkleRoot,
      tokensSaved: digest.tokensSaved,
      durationMs,
      dryRun: false,
      error: 'GitHub CLI (gh)가 설치되어 있지 않거나 PATH에 없습니다. 전역 규칙에 따라 gh CLI가 필수적입니다.',
    };
  }

  // 2. gh release create 명령어 인자 구성
  const ghArgs = [
    'gh',
    'release',
    'create',
    tag,
    '--title',
    title,
    '--notes',
    notes,
  ];

  if (options.isDraft) {
    ghArgs.push('--draft');
  }
  if (options.isPrerelease) {
    ghArgs.push('--prerelease');
  }

  // 에셋 추가
  for (const asset of assets) {
    ghArgs.push(resolve(rootDir, asset));
  }

  try {
    const proc = spawn(ghArgs, {
      cwd: rootDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdoutText, stderrText] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    const durationMs = Number((performance.now() - startTime).toFixed(2));

    if (exitCode === 0) {
      const releaseUrl = stdoutText.trim() || `https://github.com/releases/tag/${tag}`;
      return {
        ok: true,
        tag,
        commit: digest.commitHash,
        merkleRoot: digest.merkleRoot,
        releaseUrl,
        tokensSaved: digest.tokensSaved,
        durationMs,
        dryRun: false,
      };
    } else {
      return {
        ok: false,
        tag,
        commit: digest.commitHash,
        merkleRoot: digest.merkleRoot,
        tokensSaved: digest.tokensSaved,
        durationMs,
        dryRun: false,
        error: stderrText.trim() || stdoutText.trim() || `gh 명령 실패 (종료 코드: ${exitCode})`,
      };
    }
  } catch (err) {
    const durationMs = Number((performance.now() - startTime).toFixed(2));
    return {
      ok: false,
      tag,
      commit: digest.commitHash,
      merkleRoot: digest.merkleRoot,
      tokensSaved: digest.tokensSaved,
      durationMs,
      dryRun: false,
      error: `GitHub CLI 실행 중 예외 발생: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
