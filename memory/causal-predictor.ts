import { CausalMemoryStore, type CausalRule, type CausalRelation } from './causal-store';
import { ContextCheckpointStore } from './causal-context';

/**
 * 연쇄 파급 영향 노드 규격
 */
export interface AffectedNode {
  readonly name: string;
  readonly domain: string;
  readonly hopLevel: number;
  readonly relationType: string;
  readonly riskScore: number; // 0 ~ 100
  readonly riskReason: string;
  readonly requiredInvariants: readonly string[];
}

/**
 * 인과 연쇄 폭발 반경(Blast Radius) 분석 보고서 규격
 */
export interface BlastRadiusReport {
  readonly triggerFiles: readonly string[];
  readonly overallRisk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly maxRiskScore: number;
  readonly affectedNodes: readonly AffectedNode[];
  readonly prefetchedInvariants: readonly string[];
  readonly suggestedTargetFiles: readonly string[];
  readonly durationMs: number;
}

/**
 * 인과 연쇄 파급 예측 및 Blast Radius 분석 엔진 클래스 (SRP 준수)
 */
export class CausalPredictorEngine {
  private readonly memoryStore: CausalMemoryStore;
  private readonly contextStore: ContextCheckpointStore;

  constructor(memoryStore?: CausalMemoryStore, contextStore?: ContextCheckpointStore) {
    this.memoryStore = memoryStore || new CausalMemoryStore();
    this.contextStore = contextStore || new ContextCheckpointStore();
  }

  /**
   * 파일 수정 시 2~3단계 뒤에 발생할 연쇄 파급 반경 계산
   */
  public analyzeBlastRadius(files: readonly string[], maxHops: number = 3): BlastRadiusReport {
    const startTime = performance.now();
    this.memoryStore.reloadIfNeeded();
    this.contextStore.reloadIfNeeded();

    const normalizedFiles = files.map((f) => f.replaceAll('\\', '/').toLowerCase());

    // 1. 직접 매칭되는 1차 인과 규칙 식별
    const resonance = this.memoryStore.queryResonance({
      files: normalizedFiles,
      propagateRelations: false,
    });

    const directRules = resonance.resonanceRules;
    const rawDb = this.memoryStore.getRawDatabase();

    // 간선 맵(From ➔ Relations) 구성
    const outgoingMap = new Map<string, CausalRelation[]>();
    const incomingMap = new Map<string, CausalRelation[]>();

    for (const rel of rawDb.relations) {
      const fromLower = rel.from.toLowerCase();
      const toLower = rel.to.toLowerCase();

      if (!outgoingMap.has(fromLower)) outgoingMap.set(fromLower, []);
      outgoingMap.get(fromLower)!.push(rel);

      if (!incomingMap.has(toLower)) incomingMap.set(toLower, []);
      incomingMap.get(toLower)!.push(rel);
    }

    const titleToRule = new Map<string, CausalRule>();
    for (const rule of rawDb.rules) {
      titleToRule.set(rule.title.toLowerCase(), rule);
      titleToRule.set(rule.id.toLowerCase(), rule);
    }

    // 2. 다중 홉(Multi-Hop) 인과 파급 BFS 탐색
    const visited = new Set<string>();
    const affectedNodes: AffectedNode[] = [];
    const prefetchedInvariantsSet = new Set<string>();
    const suggestedFilesSet = new Set<string>();

    // 1차 직접 매칭 규칙의 불변식 사전 페치 등록
    for (const direct of directRules) {
      if (direct.invariants && Array.isArray(direct.invariants)) {
        for (const inv of direct.invariants) {
          prefetchedInvariantsSet.add(inv);
        }
      }
    }

    let currentLevel = directRules.map((r) => r.title.toLowerCase());
    for (const t of currentLevel) visited.add(t);

    for (let hop = 1; hop <= maxHops; hop++) {
      const nextLevel: string[] = [];
      const hopWeight = Math.pow(0.7, hop - 1); // 홉이 멀어질수록 감쇠

      for (const currentTitle of currentLevel) {
        const outRels = outgoingMap.get(currentTitle) || [];
        const inRels = incomingMap.get(currentTitle) || [];
        const allRels = [...outRels, ...inRels];

        for (const rel of allRels) {
          const neighbor =
            rel.from.toLowerCase() === currentTitle ? rel.to.toLowerCase() : rel.from.toLowerCase();

          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          nextLevel.push(neighbor);

          const neighborRule = titleToRule.get(neighbor);
          if (neighborRule) {
            let baseScore = 60;
            const relKind = (rel.relation || (rel as any).relationType || 'requires');
            const rType = relKind.toLowerCase();

            if (rType.includes('trigger') || rType.includes('govern')) baseScore = 90;
            else if (rType.includes('verify') || rType.includes('produce')) baseScore = 75;

            const riskScore = Math.round(baseScore * hopWeight);

            for (const inv of (neighborRule.invariants || [])) {
              prefetchedInvariantsSet.add(inv);
            }

            if (neighborRule.triggers && Array.isArray(neighborRule.triggers.files)) {
              for (const f of neighborRule.triggers.files) {
                suggestedFilesSet.add(f);
              }
            }

            affectedNodes.push({
              name: neighborRule.title || (neighborRule as any).name || neighborRule.id,
              domain: neighborRule.domain,
              hopLevel: hop,
              relationType: relKind,
              riskReason: `${hop}단계 인과 연결 (\`${rel.from}\` ──[${relKind}]──▶ \`${rel.to}\`)`,
              riskScore,
              requiredInvariants: neighborRule.invariants || [],
            });
          }
        }
      }

      if (nextLevel.length === 0) break;
      currentLevel = nextLevel;
    }

    // 3. 과거 체크포인트의 동시 수정 파일 빈도 기반 연관 파일 보강
    const recentCheckpoints = this.contextStore.listCheckpoints({ limit: 15 });
    for (const cp of recentCheckpoints) {
      const hasInputFile = cp.modifiedFiles.some((mf) =>
        normalizedFiles.some((nf) => mf.toLowerCase().includes(nf) || nf.includes(mf.toLowerCase()))
      );
      if (hasInputFile) {
        for (const f of cp.modifiedFiles) {
          if (!normalizedFiles.includes(f.toLowerCase())) {
            suggestedFilesSet.add(f);
          }
        }
      }
    }

    // 위험도 정렬
    affectedNodes.sort((a, b) => b.riskScore - a.riskScore);

    const maxRiskScore = affectedNodes.length > 0 ? affectedNodes[0].riskScore : 0;
    let overallRisk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    if (maxRiskScore >= 80) overallRisk = 'CRITICAL';
    else if (maxRiskScore >= 60) overallRisk = 'HIGH';
    else if (maxRiskScore >= 40) overallRisk = 'MEDIUM';

    const durationMs = Number((performance.now() - startTime).toFixed(2));

    return {
      triggerFiles: files,
      overallRisk,
      maxRiskScore,
      affectedNodes,
      prefetchedInvariants: Array.from(prefetchedInvariantsSet),
      suggestedTargetFiles: Array.from(suggestedFilesSet).slice(0, 10),
      durationMs,
    };
  }

  /**
   * 예측 보고서 마크다운 포맷터
   */
  public static formatPredictReport(report: BlastRadiusReport): string {
    const lines: string[] = [
      `### 🔮 [인과 연쇄 파급 예측 분석] 위험도: **${report.overallRisk}** (최고 위험 점수: ${report.maxRiskScore}/100, 소요: ${report.durationMs}ms)`,
      `- **수정 대상 파일**: ${report.triggerFiles.map((f) => `\`${f}\``).join(', ')}`,
    ];

    if (report.affectedNodes.length > 0) {
      lines.push('\n#### 💥 연쇄 파급 영향 노드 (Blast Radius Nodes)');
      for (const node of report.affectedNodes) {
        lines.push(
          `  - **[${node.riskScore}점 | ${node.hopLevel}차]** \`${node.name}\` (${node.domain}) ➔ ${node.riskReason}`
        );
      }
    }

    if (report.suggestedTargetFiles.length > 0) {
      lines.push('\n#### 🎯 함께 검증/수정해야 할 추천 타깃 파일 (Prefetched Targets)');
      for (const tf of report.suggestedTargetFiles) {
        lines.push(`  - \`${tf}\``);
      }
    }

    if (report.prefetchedInvariants.length > 0) {
      lines.push('\n#### 🛡️ 사전 로드된 파급 불변 규칙 (Prefetched Invariants)');
      for (const inv of report.prefetchedInvariants.slice(0, 8)) {
        lines.push(`  - ${inv}`);
      }
    }

    return lines.join('\n');
  }
}
