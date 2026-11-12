/**
 * 엔트로피 및 시그니처 기반 자격증명 유출 방패 (Secret Shield)
 * - 섀넌 엔트로피(Shannon Entropy) 분석 및 알려진 API 토큰 시그니처 매칭
 * - 코드 및 문서 내 평문 비밀값 노출 0초 탐지 및 마스킹
 */
import { GUARD_DEFAULTS, KNOWN_SECRET_PATTERNS, type GuardConfig } from "./config";
import type { SecurityViolation } from "./types";

export class SecretShield {
  private readonly entropyThreshold: number;
  private readonly minSecretLength: number;

  constructor(config: GuardConfig = {}) {
    this.entropyThreshold = config.entropyThreshold ?? GUARD_DEFAULTS.ENTROPY_THRESHOLD;
    this.minSecretLength = config.minSecretLength ?? GUARD_DEFAULTS.MIN_SECRET_LENGTH;
  }

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
   * 텍스트 내 비밀값 마스킹 처리
   */
  public maskSecret(secret: string): string {
    if (secret.length <= 8) return "***";
    const prefix = secret.slice(0, 4);
    const suffix = secret.slice(-3);
    return `${prefix}***${suffix}`;
  }

  /**
   * 텍스트 전체 스캔 및 자격증명 유출 위반 탐지
   */
  public scanText(text: string, targetName = "source"): SecurityViolation[] {
    const violations: SecurityViolation[] = [];
    const lines = text.split("\n");

    // 1. 알려진 시그니처 정규식 검사
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      for (const patternDef of KNOWN_SECRET_PATTERNS) {
        const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
        let match: RegExpExecArray | null;

        while ((match = regex.exec(line)) !== null) {
          const matchedSecret = match[0];
          violations.push({
            type: "EXPOSED_SECRET",
            severity: "CRITICAL",
            target: targetName,
            line: lineIdx + 1,
            description: `평문 자격증명 유출 탐지: [${patternDef.name}]`,
            maskedSnippet: line.replace(matchedSecret, this.maskSecret(matchedSecret)),
          });
        }
      }

      // 2. 고엔트로피 비밀 키워드 변수 검사 (예: secret = "...", token: "...")
      const tokenAssignMatch = line.match(/(?:token|secret|password|api_key|auth_key)\s*[:=]\s*["']([^"']+)["']/i);
      if (tokenAssignMatch) {
        // 안전한 해시, 커밋, 예시 키워드 문맥인 경우 오탐 방지 스킵
        const isSafeContext = /(?:hash|merkle|checksum|commit|uuid|color|palette|example|dummy|sample|placeholder)/i.test(line);
        if (isSafeContext) continue;

        const potentialSecret = tokenAssignMatch[1];
        if (potentialSecret.length >= this.minSecretLength) {
          const entropy = this.calculateEntropy(potentialSecret);
          if (entropy >= this.entropyThreshold) {
            violations.push({
              type: "EXPOSED_SECRET",
              severity: "CRITICAL",
              target: targetName,
              line: lineIdx + 1,
              description: `고엔트로피 비밀값 할당 탐지 (엔트로피: ${entropy})`,
              maskedSnippet: line.replace(potentialSecret, this.maskSecret(potentialSecret)),
            });
          }
        }
      }
    }

    return violations;
  }
}
