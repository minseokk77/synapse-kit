import { stat, readFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';

/**
 * 언어 플러그인 파일 읽기 기본 최대 크기 (10MB)
 */
export const PLUGIN_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * 대상 경로가 기준 루트 디렉터리(rootDir) 내부에 있는지 검증합니다 (Path Traversal 차단).
 */
export function resolvePathInsideRoot(
  rootDir: string,
  targetPath: string,
  label: string
): string {
  if (!targetPath || targetPath.includes('\0')) {
    throw new Error(`[Plugin Security] 유효하지 않은 ${label} 경로입니다.`);
  }
  const resolvedRoot = resolve(rootDir);
  const resolvedTarget = resolve(resolvedRoot, targetPath);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `[Plugin Security] ${label} 경로가 작업 루트(${resolvedRoot})를 벗어났습니다: ${targetPath}`
    );
  }
  return resolvedTarget;
}

/**
 * 컴파일러/인터프리터 실행 바이너리가 허용된 도구 이름인지 검증합니다.
 */
export function assertAllowedBinary(
  bin: string,
  allowedNames: readonly string[],
  label: string
): string {
  const trimmed = bin.trim();
  if (!trimmed || trimmed.includes('\0') || /[\r\n;&|`$<>]/.test(trimmed)) {
    throw new Error(`[Plugin Security] 유효하지 않은 ${label} 바이너리 지정입니다: ${bin}`);
  }
  const normalizedBase = basename(trimmed).replace(/\.exe$/i, '').toLowerCase();
  if (!allowedNames.includes(normalizedBase)) {
    throw new Error(
      `[Plugin Security] 허용되지 않은 ${label} 바이너리입니다: ${trimmed} (허용: ${allowedNames.join(', ')})`
    );
  }
  return trimmed;
}

/**
 * 추가 CLI 인자(extraArgs)에서 위험한 플래그 및 응답 파일(@file) 인젝션을 차단합니다.
 */
export function sanitizeCompilerArgs(
  extraArgs: readonly string[] | undefined,
  blockedPrefixes: readonly string[],
  label: string
): string[] {
  if (!extraArgs || extraArgs.length === 0) return [];
  const sanitized: string[] = [];

  for (const rawArg of extraArgs) {
    if (typeof rawArg !== 'string' || rawArg.includes('\0') || /[\r\n]/.test(rawArg)) {
      throw new Error(`[Plugin Security] ${label} 인자에 허용되지 않은 제어 문자가 포함되어 있습니다.`);
    }
    const arg = rawArg.trim();
    if (!arg) continue;

    if (arg.startsWith('@')) {
      throw new Error(`[Plugin Security] ${label} 응답 파일(@file) 인자는 보안상 차단됩니다: ${arg}`);
    }

    for (const prefix of blockedPrefixes) {
      if (arg === prefix || arg.startsWith(`${prefix}=`) || arg.startsWith(prefix)) {
        throw new Error(`[Plugin Security] ${label}에서 보안상 차단된 플래그입니다: ${arg}`);
      }
    }

    sanitized.push(arg);
  }

  return sanitized;
}

/**
 * 대상 소스 파일 목록에서 플래그 인젝션(-, @) 및 루트 외부 경로를 차단합니다.
 */
export function sanitizeTargetFiles(
  rootDir: string,
  files: readonly string[],
  label: string
): string[] {
  return files.map((file) => {
    if (!file || file.includes('\0')) {
      throw new Error(`[Plugin Security] 유효하지 않은 ${label} 파일 경로입니다.`);
    }
    const trimmed = file.trim();
    if (trimmed.startsWith('-') || trimmed.startsWith('@')) {
      throw new Error(`[Plugin Security] ${label} 파일 경로에 플래그 인젝션이 감지되었습니다: ${file}`);
    }
    return resolvePathInsideRoot(rootDir, trimmed, `${label} 파일`);
  });
}

/**
 * 파일 크기 상한(maxBytes)을 검증한 뒤 UTF-8 텍스트를 안전하게 읽습니다 (OOM DoS 방어).
 */
export async function readFileWithSizeLimit(
  filePath: string,
  maxBytes: number = PLUGIN_MAX_FILE_BYTES,
  label: string = '파일'
): Promise<string> {
  const info = await stat(filePath);
  if (info.size > maxBytes) {
    throw new Error(
      `[Plugin Security] ${label} 크기(${info.size}B)가 허용 상한(${maxBytes}B)을 초과했습니다.`
    );
  }
  return await readFile(filePath, 'utf8');
}
