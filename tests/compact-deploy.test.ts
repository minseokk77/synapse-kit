/**
 * Synapse Kit - Causal Compact Release & Deploy 통합 검증 테스트
 * 토큰 절약형 초경량 릴리즈 파이프라인, 사전 보안 가드, gh CLI 연동 및 1줄 컴팩트 출력 검증
 */

import { describe, expect, it } from 'bun:test';
import { spawn } from 'bun';
import { resolve } from 'node:path';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import {
  generateCausalDigest,
  estimateTokens,
  ZeroTokenPreflightGuard,
  resolveReleaseTag,
  executeGitHubRelease,
  checkGitHubCliAvailable,
} from '../compiler/deploy';

const ROOT_DIR = resolve(__dirname, '..');

describe('⚡ [Synapse Deploy] 1. Causal Change Summarizer (초압축 릴리즈 다이제스트)', () => {
  it('Git 상태 기반 Merkle Root 및 결정론적 인과 다이제스트를 올바르게 생성해야 한다', async () => {
    const digest = await generateCausalDigest(ROOT_DIR);

    expect(digest.commitHash).toBeDefined();
    expect(digest.commitHash.length).toBeGreaterThanOrEqual(7);
    expect(digest.merkleRoot).toBeDefined();
    expect(digest.merkleRoot.length).toBe(16);
    expect(digest.markdownNotes).toContain('시냅스 엑손 (Synapse Axon) 인과율 릴리즈 다이제스트');
    expect(digest.markdownNotes).toContain(digest.commitHash);
    expect(digest.markdownNotes).toContain(digest.merkleRoot);
  });

  it('git status --porcelain 첫 줄 파일명의 첫 글자가 잘리지 않고 모듈 요약에 반영되어야 한다', async () => {
    const digest = await generateCausalDigest(ROOT_DIR);
    for (const summary of digest.moduleSummaries) {
      for (const sample of summary.sampleFiles) {
        expect(sample.startsWith('ompiler/')).toBe(false);
        expect(sample.startsWith('uard/')).toBe(false);
        expect(sample.startsWith('emory/')).toBe(false);
        expect(sample.startsWith('unner/')).toBe(false);
      }
    }
  });

  it('토큰 절감량 및 압축 비율이 정량적으로 산출되어야 한다 (80% 이상 절감)', async () => {
    const digest = await generateCausalDigest(ROOT_DIR);

    expect(digest.estimatedRawTokens).toBeGreaterThan(0);
    expect(digest.digestTokens).toBeGreaterThan(0);
    expect(digest.tokensSaved).toBeGreaterThan(0);
    expect(digest.compressionRatio).toBeGreaterThanOrEqual(80);

    // 다이제스트의 토큰 수는 원본 diff 토큰 수의 극히 일부여야 함
    expect(digest.digestTokens).toBeLessThan(digest.estimatedRawTokens);
  });

  it('토큰 추정기 (estimateTokens)가 텍스트 길이에 따라 비례적으로 작동해야 한다', () => {
    const shortText = '{"ok":true,"tag":"v0.3.1"}';
    const longText = 'x'.repeat(1000);

    const shortTokens = estimateTokens(shortText);
    const longTokens = estimateTokens(longText);

    expect(shortTokens).toBeGreaterThan(0);
    expect(shortTokens).toBeLessThan(20); // 1줄 JSON은 20토큰 미만이어야 함
    expect(longTokens).toBeGreaterThan(shortTokens);
  });
});

describe('🔒 [Synapse Deploy] 2. Zero-Token Preflight Guard (사전 보안 및 크기 가드)', () => {
  const guard = new ZeroTokenPreflightGuard();

  it('정상적인 릴리즈 노트와 에셋은 가드를 통과해야 한다', async () => {
    const safeNotes = '### Safe Release\nNo secrets here.';
    const result = await guard.verifyRelease(safeNotes, ['package.json'], {}, ROOT_DIR);

    expect(result.passed).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it('릴리즈 노트에 API 키 또는 시크릿이 포함되면 즉시 차단(CRITICAL)해야 한다', async () => {
    const leakedNotes = '### Release\nHere is our secret token: ghp_1234567890abcdefghijklmnopqrstuvwxyzAB';
    const result = await guard.verifyRelease(leakedNotes, [], {}, ROOT_DIR);

    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.type === 'SECRET_EXPOSED')).toBe(true);
  });

  it('금지된 파일 (.env, .key) 또는 누락된 에셋은 즉각 차단해야 한다', async () => {
    const tempEnvFile = resolve(ROOT_DIR, '.env.deploy_test_dummy');
    writeFileSync(tempEnvFile, 'SECRET=dummy', 'utf-8');

    try {
      const result = await guard.verifyRelease('Safe notes', ['.env.deploy_test_dummy', 'non_existent_file.tmp'], {}, ROOT_DIR);

      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.type === 'RESTRICTED_FILE')).toBe(true);
      expect(result.violations.some((v) => v.type === 'MISSING_ASSET')).toBe(true);
    } finally {
      if (existsSync(tempEnvFile)) {
        unlinkSync(tempEnvFile);
      }
    }
  });

  it('Path Traversal (../outside.txt) 에셋 첨부 시 RESTRICTED_FILE로 차단해야 한다', async () => {
    const result = await guard.verifyRelease('안전한 릴리즈 노트', ['../outside.txt'], {}, ROOT_DIR);
    expect(result.passed).toBe(false);
    const violation = result.violations.find((v) => v.type === 'RESTRICTED_FILE' && v.target === '../outside.txt');
    expect(violation).toBeDefined();
    expect(violation?.message).toContain('경로 조작(Path Traversal) 시도 차단');
  });
});

describe('🚀 [Synapse Deploy] 3. GitHub CLI 연동 및 Dry-Run', () => {
  it('package.json 버전으로부터 태그를 정상 추론해야 한다', () => {
    const tag = resolveReleaseTag(undefined, ROOT_DIR);
    expect(tag).toMatch(/^v\d+\.\d+\.\d+/);

    const customTag = resolveReleaseTag('1.5.0', ROOT_DIR);
    expect(customTag).toBe('v1.5.0');
  });

  it('불법 태그 인젝션 (--malicious-flag 또는 v1.0.0; echo hack) 시 resolveReleaseTag가 에러를 던져 차단해야 한다', () => {
    expect(() => resolveReleaseTag('--malicious-flag', ROOT_DIR)).toThrow('유효하지 않은 릴리즈 태그 형식입니다');
    expect(() => resolveReleaseTag('v1.0.0; echo hack', ROOT_DIR)).toThrow('유효하지 않은 릴리즈 태그 형식입니다');
    expect(() => resolveReleaseTag('-v1.0.0', ROOT_DIR)).toThrow('유효하지 않은 릴리즈 태그 형식입니다');
    expect(() => resolveReleaseTag('v1.0.0 && rm -rf /', ROOT_DIR)).toThrow('유효하지 않은 릴리즈 태그 형식입니다');
  });

  it('GitHub CLI 가용성 점검 함수가 오류 없이 결과를 반환해야 한다', async () => {
    const check = await checkGitHubCliAvailable();
    expect(typeof check.available).toBe('boolean');
  });

  it('--dry-run 모드에서는 실제 GitHub 호출 없이 즉시 성공 결과를 반환해야 한다', async () => {
    const digest = await generateCausalDigest(ROOT_DIR);
    const result = await executeGitHubRelease(digest, { dryRun: true }, ROOT_DIR);

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.tag).toBeDefined();
    expect(result.merkleRoot).toBe(digest.merkleRoot);
    expect(result.tokensSaved).toBe(digest.tokensSaved);
  });
});

describe('🎯 [Synapse Deploy] 4. CLI --compact 단일 라인 초경량 JSON 출력 검증', () => {
  it('synapse release --dry-run --compact 실행 시 단 1줄의 JSON (15토큰 내외)만 출력해야 한다', async () => {
    const proc = spawn(['bun', 'compiler/cli.ts', 'release', '--dry-run', '--compact'], {
      cwd: ROOT_DIR,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdoutText, stderrText] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderrText.trim()).toBe('');

    const lines = stdoutText.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
    // AI 에이전트용 compact 모드는 정확히 1줄의 JSON이어야 함
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.ok).toBe(true);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.tag).toMatch(/^v\d+/);
    expect(parsed.tokens_saved).toBeGreaterThan(0);
    expect(parsed.merkle).toBeDefined();

    // 토큰 소모량 실측 검증: 50토큰 미만이어야 함 (기존 10,000+ 토큰 대비 99.5% 이상 절감)
    const tokenCount = estimateTokens(lines[0]);
    expect(tokenCount).toBeLessThan(50);
  });

  it('synapse axon --dry-run --compact 명령어도 동일하게 1줄 초경량 JSON으로 수렴해야 한다', async () => {
    const proc = spawn(['bun', 'compiler/cli.ts', 'axon', '--dry-run', '--compact'], {
      cwd: ROOT_DIR,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdoutText, stderrText] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderrText.trim()).toBe('');

    const lines = stdoutText.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.ok).toBe(true);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.tag).toMatch(/^v\d+/);
    expect(parsed.tokens_saved).toBeGreaterThan(0);
  });
});
