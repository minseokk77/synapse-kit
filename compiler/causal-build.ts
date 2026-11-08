import { spawn } from 'bun';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { BuildTrack } from './types';

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
  lastVerifiedHead?: string;
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
        lastVerifiedHead: parsed.lastVerifiedHead,
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
 * Git 작업 트리의 변경 파일 목록, 최신 HEAD 해시 및 Git 저장소 루트 디렉터리 조회
 */
export async function getGitState(rootDir: string): Promise<{ head: string; modifiedFiles: string[]; repoRoot: string }> {
  try {
    const rootProc = spawn(['git', 'rev-parse', '--show-toplevel'], { cwd: rootDir, stdout: 'pipe' });
    const repoRoot = (await new Response(rootProc.stdout).text()).trim().replaceAll('\\', '/');
    await rootProc.exited;

    const headProc = spawn(['git', 'rev-parse', 'HEAD'], { cwd: rootDir, stdout: 'pipe' });
    const head = (await new Response(headProc.stdout).text()).trim();
    await headProc.exited;

    const statusProc = spawn(['git', 'status', '--porcelain', '-uall'], { cwd: rootDir, stdout: 'pipe' });
    const statusText = await new Response(statusProc.stdout).text();
    await statusProc.exited;

    const modifiedFiles = statusText
      .split(/\r?\n/)
      .flatMap((rawLine) => {
        if (rawLine.trim().length < 4) return [];
        const rawPath = rawLine.slice(3).trim();
        if (rawPath.includes(' -> ')) {
          return rawPath.split(' -> ').map((part) => part.trim().replace(/^"(.*)"$/, '$1').replaceAll('\\', '/'));
        }
        return [rawPath.replace(/^"(.*)"$/, '$1').replaceAll('\\', '/')];
      })
      .filter((line) => line.length > 0 && !line.startsWith('.synapse/') && !line.includes('/.synapse/'));

    return { head, modifiedFiles, repoRoot: repoRoot || rootDir };
  } catch {
    return { head: 'unknown', modifiedFiles: [], repoRoot: rootDir };
  }
}

/**
 * 특정 빌드 트랙의 인과율 스킵 여부 판단
 */
export function shouldSkipBuildTrack(
  track: BuildTrack,
  rootDir: string,
  repoRoot: string,
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

  // 2. 이전 빌드 기록 검사
  const record = cache.tracks[track.name];
  if (!record) {
    return { skip: false, reason: '초기 빌드 기록 없음' };
  }

  // 3. 소스 코드 변경 감지 (마지막 빌드 이후 수정된 파일이 있는지 mtime과 교차 검증)
  const sources = track.sources || [];
  if (sources.length > 0) {
    const lastBuildEpoch = new Date(record.lastBuildTime).getTime();
    const hasModifiedSource = modifiedFiles.some((file) => {
      const isMatch = sources.some((src) => {
        const cleanSrc = src.replaceAll('\\', '/').replace(/^\.\//, '');
        return file.includes(cleanSrc);
      });
      if (!isMatch) return false;

      // Git repoRoot 기준 절대 경로로 실제 mtime 조회
      const fullPath = resolve(repoRoot, file);
      if (existsSync(fullPath)) {
        try {
          const stat = statSync(fullPath);
          return stat.mtimeMs > lastBuildEpoch;
        } catch {
          return true;
        }
      }
      return true;
    });

    if (hasModifiedSource) {
      return { skip: false, reason: '마지막 빌드 이후 소스 코드 변경 감지' };
    }
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
