/**
 * Synapse Kit - Zero-Token Preflight Guard
 * 릴리즈 배포 전 비밀값 누출, 대용량 아티팩트(100MB+), 민감 파일(.env 등)을 0.00초 사전 검사
 */

import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { AXON_DEFAULTS, AXON_KNOWN_SECRET_PATTERNS, AXON_RESTRICTED_PATTERNS } from './config';
import type { PreflightCheckResult, PreflightViolation, ReleaseOptions } from './types';

export class ZeroTokenPreflightGuard {
  /**
   * 문자열의 섀넌 엔트로피(Shannon Entropy) 계산
   */
  public calculateEntropy(str: string): number {
    if (!str || str.length === 0) return 0;
    const freqMap = new Map<string, number>();
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      freqMap.set(ch, (freqMap.get(ch) || 0) + 1);
    }
    let entropy = 0;
    const len = str.length;
    for (const count of freqMap.values()) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }
    return Number(entropy.toFixed(3));
  }

  /**
   * 텍스트 내 자격증명 노출 여부 스캔
   */
  public scanSecrets(text: string, targetName = 'source'): PreflightViolation[] {
    const violations: PreflightViolation[] = [];
    const lines = text.split(/\r?\n/);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      // 1. 알려진 시그니처 정규식 검사
      for (const patternDef of AXON_KNOWN_SECRET_PATTERNS) {
        const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
        let match: RegExpExecArray | null;

        while ((match = regex.exec(line)) !== null) {
          violations.push({
            type: 'SECRET_EXPOSED',
            target: targetName,
            message: `평문 자격증명 유출 탐지: [${patternDef.name}] (라인 ${lineIdx + 1})`,
            severity: 'CRITICAL',
          });
        }
      }

      // 2. 고엔트로피 비밀 키워드 변수 검사 (예: token = "...", secret: "...")
      const tokenAssignMatch = line.match(/(?:token|secret|password|api_key|auth_key)\s*[:=]\s*["']([^"']+)["']/i);
      if (tokenAssignMatch) {
        // 안전한 해시, 커밋, 예시 키워드 문맥인 경우 오탐 방지 스킵
        const isSafeContext = /(?:hash|merkle|checksum|commit|uuid|color|palette|example|dummy|sample|placeholder)/i.test(line);
        if (isSafeContext) continue;

        const val = tokenAssignMatch[1];
        if (
          val.length >= AXON_DEFAULTS.MIN_SECRET_LENGTH &&
          this.calculateEntropy(val) >= AXON_DEFAULTS.ENTROPY_THRESHOLD
        ) {
          violations.push({
            type: 'SECRET_EXPOSED',
            target: targetName,
            message: `고엔트로피 비밀값 유출 의심 (엔트로피: ${this.calculateEntropy(val)}, 라인 ${lineIdx + 1})`,
            severity: 'CRITICAL',
          });
        }
      }
    }

    return violations;
  }

  /**
   * 릴리즈 사전 검증 실행 (SecretShield + 파일 제약 조건)
   */
  public async verifyRelease(
    notes: string,
    assets: readonly string[] = [],
    options: ReleaseOptions = {},
    rootDir: string = process.cwd()
  ): Promise<PreflightCheckResult> {
    const startTime = performance.now();
    const violations: PreflightViolation[] = [];
    let scannedFilesCount = 0;

    // 1. 릴리즈 노트 내 비밀값 스캔 (토큰, 비밀번호 누출 방지)
    const noteViolations = this.scanSecrets(notes, 'release_notes.md');
    violations.push(...noteViolations);

    // 2. 첨부 에셋 파일 검사
    for (const assetPath of assets) {
      scannedFilesCount++;
      const absPath = resolve(rootDir, assetPath);
      const relPath = relative(rootDir, absPath);

      // (0) 경로 조작(Path Traversal) 방어: 프로젝트 루트 외부 경로 즉시 차단
      if (relPath.startsWith('..') || isAbsolute(relPath)) {
        violations.push({
          type: 'RESTRICTED_FILE',
          target: assetPath,
          message: '경로 조작(Path Traversal) 시도 차단: 프로젝트 루트 외부 파일은 릴리즈에 첨부할 수 없습니다',
          severity: 'CRITICAL',
        });
        continue;
      }

      // (1) 에셋 존재 여부 확인
      if (!existsSync(absPath)) {
        violations.push({
          type: 'MISSING_ASSET',
          target: assetPath,
          message: `에셋 파일을 찾을 수 없습니다: ${assetPath}`,
          severity: 'CRITICAL',
        });
        continue;
      }

      // (2) 금지된 파일 패턴 검사
      const filename = assetPath.replace(/\\/g, '/').split('/').pop() || '';
      for (const pattern of AXON_RESTRICTED_PATTERNS) {
        if (pattern.test(filename)) {
          violations.push({
            type: 'RESTRICTED_FILE',
            target: assetPath,
            message: `보안상 위험하거나 배포가 금지된 파일입니다: ${filename}`,
            severity: 'CRITICAL',
          });
          break;
        }
      }

      // (3) 파일 크기 검사 (100MB 초과 금지)
      try {
        const stats = statSync(absPath);
        if (stats.size > AXON_DEFAULTS.MAX_GITHUB_ASSET_SIZE_BYTES) {
          const mb = (stats.size / (1024 * 1024)).toFixed(1);
          violations.push({
            type: 'FILE_TOO_LARGE',
            target: assetPath,
            message: `파일 크기(${mb}MB)가 GitHub 업로드 한도(100MB)를 초과합니다: ${filename}`,
            severity: 'CRITICAL',
          });
        }

        // (4) 텍스트 파일인 경우 에셋 내용 내 시크릿 검사 (1MB 미만 파일만)
        if (
          stats.size < AXON_DEFAULTS.MAX_TEXT_SCAN_SIZE_BYTES &&
          (filename.endsWith('.json') || filename.endsWith('.txt') || filename.endsWith('.yml') || filename.endsWith('.yaml'))
        ) {
          const content = readFileSync(absPath, 'utf-8');
          const fileViolations = this.scanSecrets(content, filename);
          violations.push(...fileViolations);
        }
      } catch (err) {
        violations.push({
          type: 'MISSING_ASSET',
          target: assetPath,
          message: `에셋 파일 정보 조회 실패: ${err instanceof Error ? err.message : String(err)}`,
          severity: 'CRITICAL',
        });
      }
    }

    const durationMs = Number((performance.now() - startTime).toFixed(2));
    const passed = violations.length === 0;

    return {
      passed,
      violations,
      scannedFilesCount,
      durationMs,
    };
  }
}
