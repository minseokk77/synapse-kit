import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { CAUSAL_MEMORY_CONFIG } from './causal-config';

/**
 * 실패 가설 및 함정(Trap) 레코드 규격 (Negative Knowledge)
 */
export interface FailureHypothesis {
  readonly id: string;
  readonly title: string;
  readonly failedApproach: string;
  readonly errorSignature?: string;
  readonly rootCause: string;
  readonly counterMeasure: string;
  readonly triggerKeywords: readonly string[];
  readonly triggerFiles?: readonly string[];
  readonly environment?: string; // 예: windows, npm, powershell, bun
  readonly hitCount?: number;
  readonly createdAt: string;
  readonly lastEncounteredAt?: string;
  // 하위 호환 필드
  readonly trapPattern?: string;
  readonly domain?: string;
  readonly severity?: string;
  readonly reason?: string;
  readonly safeAlternative?: string;
  readonly avoidFiles?: readonly string[];
}

/**
 * 지뢰(Trap) 사전 탐지 결과 규격
 */
export interface TrapWarning {
  readonly trapId: string;
  readonly title: string;
  readonly riskLevel: 'CRITICAL' | 'WARNING' | 'NOTICE';
  readonly matchedBy: 'keyword' | 'file' | 'error_signature';
  readonly matchedPattern: string;
  readonly whyItFails: string;
  readonly recommendedFix: string;
}

export type TrapScanResult = TrapWarning[] & {
  readonly trapped: boolean;
  readonly triggeredTraps: readonly TrapWarning[];
  readonly highestSeverity: 'CRITICAL' | 'WARNING' | 'NOTICE' | 'NONE';
};

/**
 * 실패 가설 묘지 데이터베이스 규격
 */
export interface GraveyardDatabase {
  readonly version: string;
  readonly updatedAt: string;
  readonly totalTraps: number;
  readonly traps: readonly FailureHypothesis[];
}

/**
 * 실패 가설 묘지(Negative Memory) 관리 및 지뢰 사전 탐지 엔진 클래스 (SRP 준수)
 */
export class CausalGraveyardStore {
  private readonly dbPath: string;
  private database: GraveyardDatabase;
  private lastMtimeMs: number = 0;

  constructor(customPathOrMemoryStore?: string | unknown) {
    const customPath =
      typeof customPathOrMemoryStore === 'string' ? customPathOrMemoryStore : undefined;

    this.dbPath =
      customPath ||
      process.env.SYNAPSE_GRAVEYARD_PATH ||
      resolve(homedir(), '.gemini', 'antigravity', 'causal_graveyard.json');
    this.database = this.loadDatabase();
  }

  private loadDatabase(): GraveyardDatabase {
    try {
      if (existsSync(this.dbPath)) {
        const stat = statSync(this.dbPath);
        this.lastMtimeMs = stat.mtimeMs;
        const raw = readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw) as GraveyardDatabase;
        if (parsed && Array.isArray(parsed.traps)) {
          return parsed;
        }
      }
    } catch {
      // 무시
    }

    return {
      version: CAUSAL_MEMORY_CONFIG.SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      totalTraps: 0,
      traps: [],
    };
  }

  public reloadIfNeeded(): void {
    try {
      if (existsSync(this.dbPath)) {
        const stat = statSync(this.dbPath);
        if (stat.mtimeMs > this.lastMtimeMs) {
          this.database = this.loadDatabase();
        }
      }
    } catch {
      // 무시
    }
  }

  private saveDatabase(): void {
    try {
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const serialized = JSON.stringify(this.database, null, 2);
      const tempPath = `${this.dbPath}.tmp.${process.pid}.${Date.now()}`;
      writeFileSync(tempPath, serialized, 'utf-8');
      renameSync(tempPath, this.dbPath);

      try {
        this.lastMtimeMs = statSync(this.dbPath).mtimeMs;
      } catch {
        // 무시
      }
    } catch (error) {
      throw new Error(
        `실패 가설 묘지 저장 실패: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 신규 실패 가설(Trap) 등록 또는 갱신
   */
  public assertTrap(input: any): FailureHypothesis {
    this.reloadIfNeeded();

    const nowIso = new Date().toISOString();
    const id =
      input.id ||
      `trap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const title = input.title || input.trapPattern || '알 수 없는 함정 패턴';
    const failedApproach = input.failedApproach || input.trapPattern || title;
    const rootCause = input.rootCause || input.reason || '사유 미기재';
    const counterMeasure = input.counterMeasure || input.safeAlternative || '안전한 대안 미기재';
    const triggerKeywords = Array.isArray(input.triggerKeywords)
      ? input.triggerKeywords
      : Array.isArray(input.keywords)
      ? input.keywords
      : title.split(/\s+/).filter(Boolean);
    const triggerFiles = Array.isArray(input.triggerFiles)
      ? input.triggerFiles
      : Array.isArray(input.avoidFiles)
      ? input.avoidFiles
      : Array.isArray(input.files)
      ? input.files
      : undefined;

    const trap: FailureHypothesis = {
      id,
      title,
      failedApproach,
      rootCause,
      counterMeasure,
      triggerKeywords,
      triggerFiles,
      errorSignature: input.errorSignature,
      environment: input.environment || input.domain || 'general',
      hitCount: (input.hitCount ?? 0) + 1,
      createdAt: input.createdAt || nowIso,
      lastEncounteredAt: nowIso,
      // 하위 호환 필드 설정
      trapPattern: failedApproach,
      domain: input.domain || input.environment || 'general',
      severity: input.severity || (input.errorSignature ? 'CRITICAL' : 'WARNING'),
      reason: rootCause,
      safeAlternative: counterMeasure,
      avoidFiles: triggerFiles,
    };

    const filtered = this.database.traps.filter((t) => t.id !== trap.id);
    const updated = [trap, ...filtered];

    this.database = {
      version: CAUSAL_MEMORY_CONFIG.SCHEMA_VERSION,
      updatedAt: nowIso,
      totalTraps: updated.length,
      traps: updated,
    };

    this.saveDatabase();
    return trap;
  }

  /**
   * 작업 컨텍스트(코드, 명령어, 파일, 텍스트)에서 이미 실패했던 지뢰(Trap)가 있는지 사전 스캔
   */
  public scanTraps(query: {
    text?: string;
    code?: string;
    files?: readonly string[];
    keywords?: readonly string[];
  }): TrapScanResult {
    this.reloadIfNeeded();

    const warnings: TrapWarning[] = [];
    const fullText = [
      query.text || '',
      query.code || '',
      ...(query.keywords || []),
    ]
      .join(' ')
      .toLowerCase();

    const files = (query.files || []).map((f) => f.replaceAll('\\', '/').toLowerCase());

    for (const trap of this.database.traps) {
      let matched = false;
      let matchedBy: 'keyword' | 'file' | 'error_signature' = 'keyword';
      let matchedPattern = '';

      // 1. 에러 시그니처 매칭 (스택 또는 에러 텍스트 검출)
      if (trap.errorSignature && trap.errorSignature.length >= 3) {
        const sigLower = trap.errorSignature.toLowerCase();
        if (fullText.includes(sigLower)) {
          matched = true;
          matchedBy = 'error_signature';
          matchedPattern = trap.errorSignature;
        }
      }

      // 2. 파일 트리거 매칭
      const targetFiles = trap.triggerFiles || trap.avoidFiles || [];
      if (!matched && targetFiles.length > 0) {
        for (const tf of targetFiles) {
          const tfLower = tf.replaceAll('\\', '/').toLowerCase();
          if (files.some((f) => f.includes(tfLower) || tfLower.includes(f))) {
            matched = true;
            matchedBy = 'file';
            matchedPattern = tf;
            break;
          }
        }
      }

      // 3. 키워드 트리거 매칭
      const targetKeywords = trap.triggerKeywords || [];
      if (!matched && targetKeywords.length > 0) {
        for (const kw of targetKeywords) {
          const kwLower = kw.toLowerCase();
          if (kwLower.length >= 2 && fullText.includes(kwLower)) {
            matched = true;
            matchedBy = 'keyword';
            matchedPattern = kw;
            break;
          }
        }
      }

      if (matched) {
        warnings.push({
          trapId: trap.id,
          title: trap.title,
          riskLevel: (trap.severity === 'CRITICAL' || trap.errorSignature) ? 'CRITICAL' : 'WARNING',
          matchedBy,
          matchedPattern,
          whyItFails: trap.rootCause,
          recommendedFix: trap.counterMeasure,
        });
      }
    }

    const hasCritical = warnings.some((w) => w.riskLevel === 'CRITICAL');
    const highestSeverity = warnings.length === 0 ? 'NONE' : hasCritical ? 'CRITICAL' : 'WARNING';

    const result = warnings as TrapScanResult;
    Object.assign(result, {
      trapped: warnings.length > 0,
      triggeredTraps: warnings,
      highestSeverity,
    });

    return result;
  }

  /**
   * 저장된 모든 실패 가설 목록 조회
   */
  public listTraps(): FailureHypothesis[] {
    this.reloadIfNeeded();
    return [...this.database.traps];
  }

  /**
   * 하위 호환 alias
   */
  public getAllTraps(): FailureHypothesis[] {
    return this.listTraps();
  }

  /**
   * 특정 실패 가설 삭제
   */
  public deleteTrap(id: string): boolean {
    this.reloadIfNeeded();
    const before = this.database.traps.length;
    const remaining = this.database.traps.filter((t) => t.id !== id);
    if (remaining.length === before) return false;

    this.database = {
      version: CAUSAL_MEMORY_CONFIG.SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      totalTraps: remaining.length,
      traps: remaining,
    };
    this.saveDatabase();
    return true;
  }

  /**
   * 지뢰 경고 프롬프트 포맷터
   */
  public static formatWarningsForAgent(warnings: readonly TrapWarning[]): string {
    if (!warnings || warnings.length === 0) return '';

    const lines: string[] = [
      `### 💀 [실패 가설 묘지 경고 (Graveyard Trap Detected)] 이미 실패했던 안티패턴 ${warnings.length}건 감지!`,
    ];

    for (const w of warnings) {
      lines.push(`\n🚨 **[${w.riskLevel}] ${w.title}** (감지: \`${w.matchedPattern}\` by ${w.matchedBy})`);
      lines.push(`  - ❌ **실패 원인**: ${w.whyItFails}`);
      lines.push(`  - 💡 **검증된 대안**: ${w.recommendedFix}`);
    }

    return lines.join('\n');
  }

  /**
   * 하위 호환 alias
   */
  public static formatTrapWarnings(warnings: any): string {
    if (!warnings) return '';
    if (Array.isArray(warnings)) return CausalGraveyardStore.formatWarningsForAgent(warnings);
    if (warnings && Array.isArray(warnings.triggeredTraps)) {
      return CausalGraveyardStore.formatWarningsForAgent(warnings.triggeredTraps);
    }
    return '';
  }
}
