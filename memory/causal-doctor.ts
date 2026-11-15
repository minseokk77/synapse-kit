/**
 * 시냅스 인과 메모리 CARA 필수성 스코어링 & 장기 수명주기 헬스체크 (Memory Doctor)
 * - arXiv:2610.10860 (CARA: Causally Guided Retrieval Agent)
 * - arXiv:2609.05510 (Memory as Infrastructure: Reliability Engineering)
 */
import type { CausalMemoryDatabase, CausalRelation, CausalRule } from "./causal-store";

export const MEMORY_DOCTOR_CONFIG = {
  /** 규칙 노후화(Staleness) 기준 일수 */
  STALE_DAYS_THRESHOLD: 90,
  /** 키워드 중첩 기반 상충 의심 비율 임계치 */
  CONFLICT_KEYWORD_OVERLAP: 0.6,
  /** 필수성 스코어링 가중치 */
  ESSENTIALITY_WEIGHTS: {
    KEYWORD_MATCH: 0.45,
    INVARIANT_DENSITY: 0.3,
    RELATION_CENTRALITY: 0.25,
  },
} as const;

export interface EssentialityScoreResult {
  readonly ruleId: string;
  readonly essentialityScore: number;
  readonly consequentialDegree: number;
  readonly matchedKeywordCount: number;
}

export interface MemoryDoctorIssue {
  readonly type: "STALE_RULE" | "ORPHAN_RELATION" | "DUPLICATE_ID" | "POTENTIAL_CONFLICT";
  readonly severity: "HIGH" | "MEDIUM" | "LOW";
  readonly targetId: string;
  readonly message: string;
}

export interface MemoryDoctorReport {
  readonly healthy: boolean;
  readonly totalRules: number;
  readonly totalRelations: number;
  readonly staleCount: number;
  readonly orphanRelationsCount: number;
  readonly duplicateIdsCount: number;
  readonly conflictsCount: number;
  readonly issues: readonly MemoryDoctorIssue[];
  readonly durationMs: number;
}

/**
 * CARA 기반 규칙 인과 필수성(Essentiality) & 결과성(Consequentiality) 스코어 산출
 */
export function scoreEssentiality(
  rule: CausalRule,
  queryKeywords: readonly string[],
  relations: readonly CausalRelation[]
): EssentialityScoreResult {
  const normalizedQuery = new Set(queryKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean));
  const ruleKeywords = rule.triggers?.keywords ?? [];
  let matchedKeywordCount = 0;

  for (const kw of ruleKeywords) {
    if (normalizedQuery.has(kw.toLowerCase())) {
      matchedKeywordCount++;
    }
  }

  let consequentialDegree = 0;
  for (const rel of relations) {
    if (rel.from === rule.id || rel.to === rule.id) {
      consequentialDegree++;
    }
  }

  const kwRatio =
    normalizedQuery.size > 0 ? Math.min(1, matchedKeywordCount / normalizedQuery.size) : 0;
  const invDensity = Math.min(1, (rule.invariants?.length ?? 0) / 5);
  const relCentrality = Math.min(1, consequentialDegree / 4);

  const w = MEMORY_DOCTOR_CONFIG.ESSENTIALITY_WEIGHTS;
  const score =
    kwRatio * w.KEYWORD_MATCH +
    invDensity * w.INVARIANT_DENSITY +
    relCentrality * w.RELATION_CENTRALITY;

  return {
    ruleId: rule.id,
    essentialityScore: Number(score.toFixed(4)),
    consequentialDegree,
    matchedKeywordCount,
  };
}

/**
 * 장기 운영 인과 메모리 DB 진단 (노후 규칙, 고아 간선, 중복 ID, 모순 규칙 탐지)
 */
export function diagnoseCausalMemory(
  db: CausalMemoryDatabase,
  nowMs: number = Date.now()
): MemoryDoctorReport {
  const start = performance.now();
  const issues: MemoryDoctorIssue[] = [];
  const ruleIds = new Set<string>();
  const duplicateIds = new Set<string>();
  const staleThresholdMs = MEMORY_DOCTOR_CONFIG.STALE_DAYS_THRESHOLD * 86_400_000;

  let staleCount = 0;
  let orphanRelationsCount = 0;
  let duplicateIdsCount = 0;
  let conflictsCount = 0;

  try {
    for (const rule of db.rules) {
      if (ruleIds.has(rule.id)) {
        if (!duplicateIds.has(rule.id)) {
          duplicateIds.add(rule.id);
          duplicateIdsCount++;
          issues.push({
            type: "DUPLICATE_ID",
            severity: "HIGH",
            targetId: rule.id,
            message: `중복된 규칙 ID('${rule.id}')가 발견되었습니다.`,
          });
        }
      } else {
        ruleIds.add(rule.id);
      }

      const verifiedStr = rule.lastVerified || rule.updatedAt;
      if (verifiedStr) {
        const ts = Date.parse(verifiedStr);
        if (!Number.isNaN(ts) && nowMs - ts > staleThresholdMs) {
          staleCount++;
          issues.push({
            type: "STALE_RULE",
            severity: "LOW",
            targetId: rule.id,
            message: `규칙 '${rule.id}'의 최종 검증일이 ${MEMORY_DOCTOR_CONFIG.STALE_DAYS_THRESHOLD}일을 경과했습니다.`,
          });
        }
      }
    }

    for (const rel of db.relations) {
      if (!ruleIds.has(rel.from) || !ruleIds.has(rel.to)) {
        orphanRelationsCount++;
        issues.push({
          type: "ORPHAN_RELATION",
          severity: "MEDIUM",
          targetId: `${rel.from}->${rel.to}`,
          message: `존재하지 않는 규칙 노드를 참조하는 고아 간선(${rel.from} -> ${rel.to})이 감지되었습니다.`,
        });
      }
    }

    // 동일 도메인 내 반대 지침(금지 vs 필수/권장) 키워드 충돌 휴리스틱 검사
    const byDomain = new Map<string, CausalRule[]>();
    for (const rule of db.rules) {
      const list = byDomain.get(rule.domain) ?? [];
      list.push(rule);
      byDomain.set(rule.domain, list);
    }

    for (const [, domainRules] of byDomain) {
      for (let i = 0; i < domainRules.length; i++) {
        const a = domainRules[i];
        const aWords = new Set((a.triggers?.keywords ?? []).map((k) => k.toLowerCase()));
        if (aWords.size === 0) continue;

        const aText = `${a.title} ${(a.invariants ?? []).join(" ")}`;
        const aForbids = /(?:금지|차단|never|forbid)/i.test(aText);

        for (let j = i + 1; j < domainRules.length; j++) {
          const b = domainRules[j];
          const bWords = (b.triggers?.keywords ?? []).map((k) => k.toLowerCase());
          if (bWords.length === 0) continue;

          let overlap = 0;
          for (const bw of bWords) {
            if (aWords.has(bw)) overlap++;
          }
          const overlapRatio = overlap / Math.max(aWords.size, bWords.length);
          if (overlapRatio < MEMORY_DOCTOR_CONFIG.CONFLICT_KEYWORD_OVERLAP) continue;

          const bText = `${b.title} ${(b.invariants ?? []).join(" ")}`;
          const bForbids = /(?:금지|차단|never|forbid)/i.test(bText);
          if (aForbids !== bForbids) {
            conflictsCount++;
            issues.push({
              type: "POTENTIAL_CONFLICT",
              severity: "HIGH",
              targetId: `${a.id} <-> ${b.id}`,
              message: `동일 도메인('${a.domain}') 내 키워드 중첩 및 상반된 제약('${a.id}' vs '${b.id}')이 의심됩니다.`,
            });
          }
        }
      }
    }
  } catch (err: any) {
    issues.push({
      type: "POTENTIAL_CONFLICT",
      severity: "HIGH",
      targetId: "memory-doctor",
      message: `메모리 진단 중 예외 발생: ${err?.message || err}`,
    });
  }

  return {
    healthy: duplicateIdsCount === 0 && orphanRelationsCount === 0 && conflictsCount === 0,
    totalRules: db.rules.length,
    totalRelations: db.relations.length,
    staleCount,
    orphanRelationsCount,
    duplicateIdsCount,
    conflictsCount,
    issues,
    durationMs: Number((performance.now() - start).toFixed(3)),
  };
}
