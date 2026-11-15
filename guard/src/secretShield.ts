/**
 * 엔트로피 및 시그니처 기반 자격증명 유출 방패 (Secret Shield)
 * - 섀넌 엔트로피(Shannon Entropy) 분석 및 알려진 API 토큰 시그니처 매칭
 * - 코드 및 문서 내 평문 비밀값 노출 0초 탐지 및 마스킹
 */
import { GUARD_DEFAULTS, KNOWN_SECRET_PATTERNS, type GuardConfig } from "./config";
import type { SecurityViolation } from "./types";

interface CompiledSecretPattern {
  readonly name: string;
  readonly regex: RegExp;
  readonly hint: string;
  readonly minLen: number;
}

const COMPILED_SECRET_PATTERNS: readonly CompiledSecretPattern[] = KNOWN_SECRET_PATTERNS.map((def) => {
  const src = def.pattern.source;
  let hint = "";
  let minLen = 0;
  if (src.includes("npm_")) {
    hint = "npm_";
    minLen = 40;
  } else if (src.includes("cfl_")) {
    hint = "cfl_";
    minLen = 36;
  } else if (src.includes("AKIA")) {
    hint = "AKIA";
    minLen = 20;
  } else if (src.includes("-----BEGIN")) {
    hint = "-----BEGIN";
    minLen = 26;
  } else if (src.includes("gh[pousr]_")) {
    hint = "gh";
    minLen = 40;
  } else if (src.includes("{24}\\.") && src.includes("{27}")) {
    hint = ".";
    minLen = 59;
  }
  return {
    name: def.name,
    regex: new RegExp(def.pattern.source, def.pattern.flags),
    hint,
    minLen,
  };
});

const TOKEN_ASSIGN_REGEX = /(?:token|secret|password|api_key|auth_key)\s*[:=]\s*["']([^"']+)["']/i;
const SAFE_CONTEXT_REGEX = /(?:hash|merkle|checksum|commit|uuid|color|palette|example|dummy|sample|placeholder)/i;
const DISCORD_MIN_LEN = 59;

function hasMultiDots(text: string): boolean {
  const first = text.indexOf(".", 24);
  return first !== -1 && first + 34 <= text.length && text.indexOf(".", first + 1) !== -1;
}

function checkAssignBeforeIndex(text: string, idx: number): boolean {
  let p = idx - 1;
  while (p >= 0) {
    const ch = text.charCodeAt(p);
    if (ch === 32 || ch === 9) p--;
    else break;
  }
  if (p < 3) return false;
  const c1 = text.charCodeAt(p) | 32;
  const c2 = text.charCodeAt(p - 1) | 32;
  return (
    (c2 === 101 /* 'e' */ && (c1 === 110 /* 'n' */ || c1 === 116 /* 't' */ || c1 === 121 /* 'y' */)) ||
    (c2 === 114 /* 'r' */ && c1 === 100 /* 'd' */)
  );
}

function hasAssignCandidateFrom(text: string, startOffset = 0): boolean {
  let eqIdx = text.indexOf("=", startOffset);
  while (eqIdx !== -1) {
    if (checkAssignBeforeIndex(text, eqIdx)) return true;
    eqIdx = text.indexOf("=", eqIdx + 1);
  }
  let colIdx = text.indexOf(":", startOffset);
  while (colIdx !== -1) {
    if (checkAssignBeforeIndex(text, colIdx)) return true;
    colIdx = text.indexOf(":", colIdx + 1);
  }
  return false;
}

function hasAssignCandidate(text: string): boolean {
  return hasAssignCandidateFrom(text, 0);
}

function scanPatternMask(text: string): number {
  let mask = 0;
  const len = text.length;
  if (len >= 20) {
    let uIdx = text.indexOf("_", 3);
    while (uIdx !== -1 && uIdx + 32 <= len) {
      let jumped = false;
      const c3 = text.charCodeAt(uIdx - 3);
      if (c3 === 103 /* 'g' */ && text.charCodeAt(uIdx - 2) === 104 /* 'h' */) {
        const tChar = text.charCodeAt(uIdx - 1);
        if (
          tChar === 112 /* 'p' */ ||
          tChar === 111 /* 'o' */ ||
          tChar === 117 /* 'u' */ ||
          tChar === 115 /* 's' */ ||
          tChar === 114 /* 'r' */
        ) {
          mask |= 1 << 2;
          jumped = true;
        }
      } else if (
        c3 === 110 /* 'n' */ &&
        text.charCodeAt(uIdx - 2) === 112 /* 'p' */ &&
        text.charCodeAt(uIdx - 1) === 109 /* 'm' */
      ) {
        mask |= 1 << 1;
        jumped = true;
      } else if (
        c3 === 99 /* 'c' */ &&
        text.charCodeAt(uIdx - 2) === 102 /* 'f' */ &&
        text.charCodeAt(uIdx - 1) === 108 /* 'l' */
      ) {
        mask |= 1 << 4;
        jumped = true;
      }
      uIdx = text.indexOf("_", jumped ? uIdx + 33 : uIdx + 1);
    }
    if (text.includes("AKIA")) mask |= 1 << 5;
    if (len >= 26 && text.includes("-----BEGIN")) mask |= 1 << 3;
    if (len >= DISCORD_MIN_LEN && hasMultiDots(text)) mask |= 1 << 0;
  }
  return mask;
}

function hasPotentialSecret(text: string): boolean {
  if (!text) return false;
  return scanPatternMask(text) !== 0 || hasAssignCandidate(text);
}
const ASCII_FREQ_SCRATCH = new Uint32Array(128);
const MAX_PRECOMPUTED_LEN = 512;
const C_LOG2_C = new Float64Array(MAX_PRECOMPUTED_LEN);
for (let i = 2; i < MAX_PRECOMPUTED_LEN; i++) {
  C_LOG2_C[i] = i * Math.log2(i);
}

export class SecretShield {
  private static readonly EMPTY_VIOLATIONS: SecurityViolation[] = [];
  private readonly entropyThreshold: number;
  private readonly minSecretLength: number;

  constructor(config: GuardConfig = {}) {
    this.entropyThreshold = config.entropyThreshold ?? GUARD_DEFAULTS.ENTROPY_THRESHOLD;
    this.minSecretLength = config.minSecretLength ?? GUARD_DEFAULTS.MIN_SECRET_LENGTH;
  }

  /**
   * 문자열의 섀넌 엔트로피(Shannon Entropy) 계산 (대수 항등식 & 룩업 테이블 O(N) Zero-Alloc)
   */
  public calculateEntropy(str: string): number {
    if (!str || str.length === 0) return 0;

    const len = str.length;
    let isAscii = true;
    ASCII_FREQ_SCRATCH.fill(0);

    for (let i = 0; i < len; i++) {
      const code = str.charCodeAt(i);
      if (code >= 128) {
        isAscii = false;
        break;
      }
      ASCII_FREQ_SCRATCH[code]++;
    }

    let entropy = 0;
    if (isAscii) {
      if (len < MAX_PRECOMPUTED_LEN) {
        let sumCLogC = 0;
        for (let i = 0; i < 128; i++) {
          const count = ASCII_FREQ_SCRATCH[i];
          if (count > 1) {
            sumCLogC += C_LOG2_C[count];
          }
        }
        entropy = Math.log2(len) - sumCLogC / len;
      } else {
        for (let i = 0; i < 128; i++) {
          const count = ASCII_FREQ_SCRATCH[i];
          if (count > 0) {
            const p = count / len;
            entropy -= p * Math.log2(p);
          }
        }
      }
    } else {
      const freqMap = new Map<string, number>();
      for (let i = 0; i < len; i++) {
        const ch = str[i];
        freqMap.set(ch, (freqMap.get(ch) || 0) + 1);
      }
      for (const count of freqMap.values()) {
        const p = count / len;
        entropy -= p * Math.log2(p);
      }
    }

    return Math.round(entropy * 1000) / 1000;
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
   * 알려진 6종 자격증명 시그니처(COMPILED_SECRET_PATTERNS 인덱스 기준) 비트마스크 산출
   */
  public getPatternHintMask(text: string): number {
    return scanPatternMask(text);
  }

  /**
   * 고엔트로피 할당 키워드 존재 여부 1차 판별
   */
  public hasAssignKeyword(text: string): boolean {
    return hasAssignCandidateFrom(text, 0);
  }

  /**
   * 지정 오프셋 이후 고엔트로피 할당 키워드 존재 여부 판별
   */
  public hasAssignKeywordFrom(text: string, startOffset = 0): boolean {
    return hasAssignCandidateFrom(text, startOffset);
  }

  /**
   * 자격증명 후보 포함 여부 1차 리터럴 고속 판별
   */
  public hasCandidate(text: string): boolean {
    return hasPotentialSecret(text);
  }

  /**
   * 단일 라인 자격증명 유출 검사
   * 반환값: 알려진 시크릿 시그니처 매칭 여부
   */
  public scanLine(
    line: string,
    lineNum: number,
    targetName: string,
    violations: SecurityViolation[],
    checkEntropyAssign = true,
    patternHintMask = 0b111111
  ): boolean {
    const lineLen = line.length;
    if (lineLen === 0) return false;

    let foundKnownSecret = false;
    let hintMask = patternHintMask;
    // 0. GitHub 토큰(gh[pousr]_) Zero-RegExp indexOf 고속 경로 (인덱스 2 -> bit 4)
    if ((hintMask & 4) !== 0) {
      if (lineLen >= 40) {
        const ghIdx = line.indexOf("gh");
        if (ghIdx !== -1 && ghIdx + 40 <= lineLen && line.charCodeAt(ghIdx + 3) === 95 /* '_' */) {
          const tChar = line.charCodeAt(ghIdx + 2);
          if (tChar === 112 || tChar === 111 || tChar === 117 || tChar === 115 || tChar === 114) {
            let end = ghIdx + 4;
            while (end < lineLen) {
              const c = line.charCodeAt(end);
              if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95) {
                end++;
              } else {
                break;
              }
            }
            if (end - ghIdx >= 40) {
              foundKnownSecret = true;
              violations.push({
                type: "EXPOSED_SECRET",
                severity: "CRITICAL",
                target: targetName,
                line: lineNum,
                description: "평문 자격증명 유출 탐지: [GitHub Personal Access Token]",
                maskedSnippet:
                  line.slice(0, ghIdx + 4) + "***" + line.slice(end - 3),
              });
              const hasMoreGh = line.indexOf("gh", end) !== -1;
              if (!hasMoreGh && (hintMask & 0b111011) === 0) {
                return true;
              }
              if (!hasMoreGh) {
                hintMask &= ~4;
              }
            }
          }
        } else if (ghIdx === -1) {
          hintMask &= ~4;
        }
      } else {
        hintMask &= ~4;
      }
    }

    // 1. Hyperscan/Teddy 스타일 리터럴 프리필터 + 사전 컴파일된 시그니처 정규식 검사
    if ((hintMask & 0b111111) !== 0) {
      for (let i = 0; i < COMPILED_SECRET_PATTERNS.length; i++) {
        if ((hintMask & (1 << i)) === 0) continue;
        const patternDef = COMPILED_SECRET_PATTERNS[i];
        if (patternDef.hint === "gh" && foundKnownSecret) continue;
        if (lineLen < patternDef.minLen) continue;
        if (patternDef.hint && !line.includes(patternDef.hint)) continue;

        const regex = patternDef.regex;
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(line)) !== null) {
          foundKnownSecret = true;
          const matchedSecret = match[0];
          violations.push({
            type: "EXPOSED_SECRET",
            severity: "CRITICAL",
            target: targetName,
            line: lineNum,
            description: `평문 자격증명 유출 탐지: [${patternDef.name}]`,
            maskedSnippet:
              line.slice(0, match.index) +
              this.maskSecret(matchedSecret) +
              line.slice(match.index + matchedSecret.length),
          });
        }
      }
    }

    if (foundKnownSecret) return true;
    if (!checkEntropyAssign) return false;

    // 2. 고엔트로피 비밀 키워드 변수 검사 ([:=] 직전 접미 2글자 O(1) 판별 시에만 정규식 실행)
    if (!hasAssignCandidate(line)) {
      return false;
    }

    const tokenAssignMatch = TOKEN_ASSIGN_REGEX.exec(line);
    if (tokenAssignMatch) {
      if (SAFE_CONTEXT_REGEX.test(line)) return false;

      const potentialSecret = tokenAssignMatch[1];
      if (potentialSecret.length >= this.minSecretLength) {
        const entropy = this.calculateEntropy(potentialSecret);
        if (entropy >= this.entropyThreshold) {
          violations.push({
            type: "EXPOSED_SECRET",
            severity: "CRITICAL",
            target: targetName,
            line: lineNum,
            description: `고엔트로피 비밀값 할당 탐지 (엔트로피: ${entropy})`,
            maskedSnippet:
              line.slice(0, tokenAssignMatch.index) +
              tokenAssignMatch[0].replace(potentialSecret, this.maskSecret(potentialSecret)) +
              line.slice(tokenAssignMatch.index + tokenAssignMatch[0].length),
          });
        }
      }
    }
    return false;
  }

  /**
   * 텍스트 전체 스캔 및 자격증명 유출 위반 탐지 (리터럴 프리필터 + Zero-Split 라인 스캐너)
   */
  public scanText(text: string, targetName = "source"): SecurityViolation[] {
    if (!hasPotentialSecret(text)) {
      return SecretShield.EMPTY_VIOLATIONS;
    }

    const violations: SecurityViolation[] = [];
    let lineStart = 0;
    let lineNum = 1;
    const len = text.length;

    while (lineStart <= len) {
      const nlIdx = text.indexOf("\n", lineStart);
      if (nlIdx === -1) {
        this.scanLine(text.slice(lineStart), lineNum, targetName, violations);
        break;
      }
      if (nlIdx > lineStart) {
        this.scanLine(text.slice(lineStart, nlIdx), lineNum, targetName, violations);
      }
      lineStart = nlIdx + 1;
      lineNum++;
    }

    return violations;
  }
}
