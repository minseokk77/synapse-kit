import { spawn } from 'bun';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { BuildTrack } from '../types';

export interface TrackCacheRecord {
  lastBuildTime: string;
  gitCommit: string;
  artifactExists: boolean;
}

export interface SignCacheRecord {
  lastSignTime: string;
  installerHash: string;
  signaturePath: string;
}

export interface BuildCacheData {
  tracks: Record<string, TrackCacheRecord>;
  sign?: SignCacheRecord;
}

/**
 * 인과율 빌드 캐시 로더
 */
export function loadBuildCache(rootDir: string): BuildCacheData {
  const cacheFile = resolve(rootDir, '.synapse/build-cache.json');
  try {
    if (existsSync(cacheFile)) {
      const content = readFileSync(cacheFile, 'utf-8');
      const parsed = JSON.parse(content);
      return {
        tracks: parsed.tracks || {},
        sign: parsed.sign,
      };
    }
  } catch {
    // 캐시 로드 실패 시 기본 빈 캐시 반환
  }
  return { tracks: {} };
}

/**
 * 인과율 빌드 캐시 저장
 */
export function saveBuildCache(rootDir: string, cache: BuildCacheData): void {
  const cacheDir = resolve(rootDir, '.synapse');
  const cacheFile = resolve(cacheDir, 'build-cache.json');
  try {
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    // 캐시 저장 실패가 메인 파이프라인을 중단하지 않도록 보호
  }
}

/**
 * Git 작업 트리의 변경 파일 목록과 최신 HEAD 해시 조회
 */
export async function getGitState(rootDir: string): Promise<{ head: string; modifiedFiles: string[] }> {
  try {
    const headProc = spawn(['git', 'rev-parse', 'HEAD'], { cwd: rootDir, stdout: 'pipe' });
    const head = (await new Response(headProc.stdout).text()).trim();
    await headProc.exited;

    const statusProc = spawn(['git', 'status', '--porcelain', '-uall'], { cwd: rootDir, stdout: 'pipe' });
    const statusText = await new Response(statusProc.stdout).text();
    await statusProc.exited;

    const modifiedFiles = statusText
      .split('\n')
      .map((line) => line.slice(3).trim().replaceAll('\\', '/'))
      .filter((line) => line.length > 0);

    return { head, modifiedFiles };
  } catch {
    return { head: 'unknown', modifiedFiles: [] };
  }
}

/**
 * 특정 빌드 트랙의 인과율 스킵 여부 판단
 */
export function shouldSkipBuildTrack(
  track: BuildTrack,
  rootDir: string,
  cache: BuildCacheData,
  modifiedFiles: string[],
  isForce: boolean
): { skip: boolean; reason: string } {
  if (isForce) {
    return { skip: false, reason: '강제 빌드 모드(--force)' };
  }

  // 1. 산출물 아티팩트 존재 여부 검사
  const artifacts = track.artifacts || [];
  if (artifacts.length > 0) {
    for (const art of artifacts) {
      const fullPath = resolve(track.cwd || rootDir, art);
      if (!existsSync(fullPath)) {
        return { skip: false, reason: `산출물 누락: ${art}` };
      }
    }
  }

  // 2. 소스 코드 변경 감지
  const sources = track.sources || [];
  if (sources.length > 0) {
    const hasModifiedSource = modifiedFiles.some((file) =>
      sources.some((src) => file.includes(src.replaceAll('\\', '/')))
    );

    if (hasModifiedSource) {
      return { skip: false, reason: '소스 코드 변경 감지' };
    }
  }

  // 3. 이전 빌드 기록 검사
  const record = cache.tracks[track.name];
  if (!record) {
    return { skip: false, reason: '초기 빌드 기록 없음' };
  }

  return { skip: true, reason: '인과율 메모리 일치 (소스 변경 없음)' };
}

/**
 * 파일의 SHA-256 해시 계산
 */
export function computeFileHash(filePath: string): string {
  try {
    const buffer = readFileSync(filePath);
    return createHash('sha256').update(buffer).digest('hex');
  } catch {
    return '';
  }
}

/**
 * 인스톨러 암호화 서명 스킵 여부 판단
 */
export function shouldSkipSign(
  installerPath: string,
  signaturePath: string,
  cache: BuildCacheData,
  isForce: boolean
): { skip: boolean; reason: string; currentHash: string } {
  if (isForce) {
    return { skip: false, reason: '강제 서명 모드(--force)', currentHash: '' };
  }

  if (!existsSync(installerPath)) {
    return { skip: false, reason: '서명 대상 인스톨러 미존재', currentHash: '' };
  }

  if (!existsSync(signaturePath)) {
    return { skip: false, reason: '기존 서명(.sig) 파일 미존재', currentHash: '' };
  }

  const currentHash = computeFileHash(installerPath);
  if (!currentHash) {
    return { skip: false, reason: '인스톨러 해시 계산 불가', currentHash: '' };
  }

  const record = cache.sign;
  if (record && record.installerHash === currentHash && record.signaturePath === signaturePath) {
    return { skip: true, reason: '인스톨러 바이너리 불변 (서명 캐시 적중)', currentHash };
  }

  return { skip: false, reason: '인스톨러 바이너리 변경 감지', currentHash };
}
