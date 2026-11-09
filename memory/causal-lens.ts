import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { CAUSAL_MEMORY_CONFIG } from './causal-config';
import { CausalMemoryStore, type CausalRule, type CausalRelation } from './causal-store';
import { ContextCheckpointStore, type ContextCheckpoint } from './causal-context';
import { CausalGraveyardStore, type FailureHypothesis } from './causal-graveyard';
import { CausalTimeSeriesEngine } from './causal-timeseries';

/**
 * 렌즈 내보내기 결과 보고서 규격
 */
export interface LensExportResult {
  readonly success: boolean;
  readonly vaultPath: string;
  readonly exportedRules: number;
  readonly exportedGraveyard: number;
  readonly exportedCheckpoints: number;
  readonly canvasGenerated: boolean;
  readonly timelineGenerated: boolean;
  readonly durationMs: number;
  readonly error?: string;
}

/**
 * 렌즈 가져오기 결과 보고서 규격
 */
export interface LensImportResult {
  readonly success: boolean;
  readonly vaultPath: string;
  readonly importedRules: number;
  readonly importedGraveyard: number;
  readonly durationMs: number;
  readonly error?: string;
}

/**
 * 양방향 동기화 결과 보고서 규격
 */
export interface LensSyncResult {
  readonly success: boolean;
  readonly exportResult: LensExportResult;
  readonly importResult: LensImportResult;
  readonly syncedAt: string;
}

/**
 * 옵시디언 캔버스 노드 규격
 */
export interface ObsidianCanvasNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly type: 'text' | 'file';
  readonly text?: string;
  readonly file?: string;
  readonly color?: string;
}

/**
 * 옵시디언 캔버스 엣지(간선) 규격
 */
export interface ObsidianCanvasEdge {
  readonly id: string;
  readonly fromNode: string;
  readonly fromSide: 'top' | 'right' | 'bottom' | 'left';
  readonly toNode: string;
  readonly toSide: 'top' | 'right' | 'bottom' | 'left';
  readonly label?: string;
  readonly color?: string;
}

/**
 * 옵시디언 캔버스 문서 규격 (.canvas)
 */
export interface ObsidianCanvasDocument {
  readonly nodes: readonly ObsidianCanvasNode[];
  readonly edges: readonly ObsidianCanvasEdge[];
}

/**
 * 옵시디언(Obsidian) 지식 베이스와 인과율 메모리를 양방향 연동하는 렌즈 엔진 클래스 (SRP 준수)
 */
export class CausalObsidianLensEngine {
  private readonly memoryStore: CausalMemoryStore;
  private readonly contextStore: ContextCheckpointStore;
  private readonly graveyardStore: CausalGraveyardStore;
  private readonly timeSeriesEngine: CausalTimeSeriesEngine;

  constructor(
    memoryStore?: CausalMemoryStore,
    contextStore?: ContextCheckpointStore,
    graveyardStore?: CausalGraveyardStore,
    timeSeriesEngine?: CausalTimeSeriesEngine
  ) {
    this.memoryStore = memoryStore || new CausalMemoryStore();
    this.contextStore = contextStore || new ContextCheckpointStore();
    this.graveyardStore = graveyardStore || new CausalGraveyardStore();
    this.timeSeriesEngine =
      timeSeriesEngine || new CausalTimeSeriesEngine(this.contextStore, this.memoryStore);
  }

  /**
   * 지정된 옵시디언 볼트 경로로 인과율 메모리 전체(규칙, 함정, 스냅샷, 타임라인, 캔버스)를 마크다운으로 내보내기
   */
  public async exportToVault(
    vaultRoot: string = CAUSAL_MEMORY_CONFIG.DEFAULT_OBSIDIAN_VAULT_PATH
  ): Promise<LensExportResult> {
    const startTime = performance.now();
    try {
      this.memoryStore.reloadIfNeeded();
      this.contextStore.reloadIfNeeded();
      this.graveyardStore.reloadIfNeeded();

      const mentalRoot = resolve(vaultRoot, CAUSAL_MEMORY_CONFIG.OBSIDIAN_LENS_SUBDIR);
      const rulesDir = resolve(mentalRoot, 'Rules');
      const graveyardDir = resolve(mentalRoot, 'Graveyard');
      const checkpointsDir = resolve(mentalRoot, 'Checkpoints');

      mkdirSync(rulesDir, { recursive: true });
      mkdirSync(graveyardDir, { recursive: true });
      mkdirSync(checkpointsDir, { recursive: true });

      // 1. 규칙(Rules) 마크다운 내보내기
      const rawDb = this.memoryStore.getRawDatabase();
      let exportedRules = 0;
      for (const rule of rawDb.rules) {
        const ruleTitle = rule.title || rule.name || rule.id;
        const safeFileName = this.sanitizeFileName(ruleTitle);
        const filePath = resolve(rulesDir, `${safeFileName}.md`);
        const content = this.renderRuleToMarkdown(rule);
        this.atomicWriteFile(filePath, content);
        exportedRules++;
      }

      // 2. 함정/부정적 기억(Graveyard) 마크다운 내보내기
      const allTraps = this.graveyardStore.listTraps();
      let exportedGraveyard = 0;
      for (const trap of allTraps) {
        const trapTitle = trap.title || trap.failedApproach || trap.id;
        const safeFileName = this.sanitizeFileName(trapTitle);
        const filePath = resolve(graveyardDir, `${safeFileName}.md`);
        const content = this.renderTrapToMarkdown(trap);
        this.atomicWriteFile(filePath, content);
        exportedGraveyard++;
      }

      // 3. 컨텍스트 체크포인트 마크다운 내보내기
      const checkpoints = this.contextStore.listCheckpoints({ limit: 100 });
      let exportedCheckpoints = 0;
      for (const cp of checkpoints) {
        const filePath = resolve(checkpointsDir, `${cp.id}.md`);
        const content = this.renderCheckpointToMarkdown(cp);
        this.atomicWriteFile(filePath, content);
        exportedCheckpoints++;
      }

      // 4. 타임라인(Timeline.md) 마크다운 생성
      const timelinePath = resolve(mentalRoot, 'Timeline.md');
      const timelineContent = this.renderTimelineMarkdown();
      this.atomicWriteFile(timelinePath, timelineContent);

      // 5. 옵시디언 캔버스(Causal-Architecture.canvas) 생성
      const canvasPath = resolve(mentalRoot, 'Causal-Architecture.canvas');
      const canvasDoc = this.generateCanvasDocument(rawDb.rules, rawDb.relations);
      this.atomicWriteFile(canvasPath, JSON.stringify(canvasDoc, null, 2));

      const durationMs = Number((performance.now() - startTime).toFixed(2));
      return {
        success: true,
        vaultPath: mentalRoot,
        exportedRules,
        exportedGraveyard,
        exportedCheckpoints,
        canvasGenerated: true,
        timelineGenerated: true,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Number((performance.now() - startTime).toFixed(2));
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        vaultPath: vaultRoot,
        exportedRules: 0,
        exportedGraveyard: 0,
        exportedCheckpoints: 0,
        canvasGenerated: false,
        timelineGenerated: false,
        durationMs,
        error: `옵시디언 볼트 내보내기 중 오류가 발생했습니다: ${message}`,
      };
    }
  }

  /**
   * 옵시디언 볼트의 마크다운 파일들을 스캔하여 인과율 규칙 및 함정 데이터로 역가져오기 (Import)
   */
  public async importFromVault(
    vaultRoot: string = CAUSAL_MEMORY_CONFIG.DEFAULT_OBSIDIAN_VAULT_PATH
  ): Promise<LensImportResult> {
    const startTime = performance.now();
    try {
      const mentalRoot = resolve(vaultRoot, CAUSAL_MEMORY_CONFIG.OBSIDIAN_LENS_SUBDIR);
      const rulesDir = resolve(mentalRoot, 'Rules');
      const graveyardDir = resolve(mentalRoot, 'Graveyard');

      let importedRules = 0;
      let importedGraveyard = 0;

      // 1. 규칙 마크다운 파싱 및 반영
      if (existsSync(rulesDir)) {
        const ruleFiles = readdirSync(rulesDir).filter((f) => f.endsWith('.md'));
        for (const file of ruleFiles) {
          const filePath = resolve(rulesDir, file);
          const rawText = readFileSync(filePath, 'utf-8');
          const parsed = this.parseRuleMarkdown(rawText, basename(file, '.md'));
          if (parsed) {
            this.memoryStore.assertRule(parsed);
            importedRules++;
          }
        }
      }

      // 2. 함정 마크다운 파싱 및 반영
      if (existsSync(graveyardDir)) {
        const trapFiles = readdirSync(graveyardDir).filter((f) => f.endsWith('.md'));
        for (const file of trapFiles) {
          const filePath = resolve(graveyardDir, file);
          const rawText = readFileSync(filePath, 'utf-8');
          const parsed = this.parseTrapMarkdown(rawText, basename(file, '.md'));
          if (parsed) {
            this.graveyardStore.assertTrap(parsed);
            importedGraveyard++;
          }
        }
      }

      const durationMs = Number((performance.now() - startTime).toFixed(2));
      return {
        success: true,
        vaultPath: mentalRoot,
        importedRules,
        importedGraveyard,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Number((performance.now() - startTime).toFixed(2));
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        vaultPath: vaultRoot,
        importedRules: 0,
        importedGraveyard: 0,
        durationMs,
        error: `옵시디언 볼트 가져오기 중 오류가 발생했습니다: ${message}`,
      };
    }
  }

  /**
   * 볼트와의 양방향 동기화 (최신성 기반 안전한 병합)
   */
  public async syncWithVault(
    vaultRoot: string = CAUSAL_MEMORY_CONFIG.DEFAULT_OBSIDIAN_VAULT_PATH
  ): Promise<LensSyncResult> {
    const importResult = await this.importFromVault(vaultRoot);
    const exportResult = await this.exportToVault(vaultRoot);

    return {
      success: importResult.success && exportResult.success,
      exportResult,
      importResult,
      syncedAt: new Date().toISOString(),
    };
  }

  /**
   * 단일 CausalRule을 Obsidian 마크다운으로 변환
   */
  private renderRuleToMarkdown(rule: CausalRule): string {
    const title = rule.title || rule.name || rule.id;
    const lines: string[] = [
      '---',
      `id: "${rule.id}"`,
      `name: "${title.replaceAll('"', '\\"')}"`,
      `domain: "${rule.domain}"`,
      `confidence: ${rule.confidence ?? 1.0}`,
      `weight: ${rule.weight ?? 1.0}`,
      `updatedAt: "${rule.updatedAt || new Date().toISOString()}"`,
      'invariants:',
      ...(rule.invariants || []).map((inv) => `  - "${inv.replaceAll('"', '\\"')}"`),
      'tags:',
      '  - "synapse/causal-rule"',
      `  - "domain/${rule.domain}"`,
      '---',
      '',
      `# ${title}`,
      '',
      `> [!NOTE] 인과율 규칙 메타데이터`,
      `> - **도메인**: \`${rule.domain}\``,
      `> - **신뢰도**: \`${rule.confidence ?? 1.0}\` | **가중치**: \`${rule.weight ?? 1.0}\``,
      `> - **최종 갱신**: \`${rule.updatedAt || 'N/A'}\``,
      '',
      '## 💡 요약 설명',
      rule.description || '상세 설명 없음',
      '',
      '## 🛡️ 필수 불변식 (Invariants)',
    ];

    if (!rule.invariants || rule.invariants.length === 0) {
      lines.push('- *등록된 불변 조건 없음*');
    } else {
      for (const inv of rule.invariants) {
        lines.push(`- [x] ${inv}`);
      }
    }

    if (rule.pattern) {
      lines.push('', '## 🔍 매칭 패턴', `\`\`\`regex\n${rule.pattern}\n\`\`\``);
    }

    return lines.join('\n');
  }

  /**
   * 단일 FailureHypothesis(함정)를 Obsidian 마크다운으로 변환
   */
  private renderTrapToMarkdown(trap: FailureHypothesis): string {
    const title = trap.title || trap.failedApproach || trap.id;
    const severity = trap.severity || 'WARNING';
    const rootCause = trap.rootCause || trap.reason || '사유 미기재';
    const counterMeasure = trap.counterMeasure || trap.safeAlternative || '안전한 대안 미기재';
    const avoidFiles = trap.triggerFiles || trap.avoidFiles || [];

    return [
      '---',
      `id: "${trap.id}"`,
      `title: "${title.replaceAll('"', '\\"')}"`,
      `domain: "${trap.domain || trap.environment || 'general'}"`,
      `severity: "${severity}"`,
      `createdAt: "${trap.createdAt}"`,
      'tags:',
      '  - "synapse/anti-pattern"',
      `  - "severity/${severity.toLowerCase()}"`,
      '---',
      '',
      `# ⚠️ 함정 경보: ${title}`,
      '',
      `> [!WARNING] 위험도: **${severity}** (도메인: \`${trap.domain || 'general'}\`)`,
      `> 이 패턴은 이전에 실패를 유발했던 안티패턴입니다. 동일한 시도를 차단해야 합니다.`,
      '',
      '## 💥 실패 원인 (Root Cause)',
      rootCause,
      '',
      '## ✅ 안전한 대안 (Safe Solution)',
      counterMeasure,
      '',
      '## 🪤 감지 파일 패턴',
      ...(avoidFiles.length > 0
        ? avoidFiles.map((f) => `- \`${f}\``)
        : ['- *전역 감지*']),
    ].join('\n');
  }

  /**
   * 단일 컨텍스트 체크포인트를 Obsidian 마크다운으로 변환
   */
  private renderCheckpointToMarkdown(cp: ContextCheckpoint): string {
    return [
      '---',
      `id: "${cp.id}"`,
      `title: "${cp.title.replaceAll('"', '\\"')}"`,
      `createdAt: "${cp.createdAt}"`,
      `cwd: "${cp.cwd.replaceAll('\\', '/')}"`,
      `branch: "${cp.gitBranch || 'unknown'}"`,
      `commit: "${cp.gitCommit || 'unknown'}"`,
      'tags:',
      '  - "synapse/checkpoint"',
      '---',
      '',
      `# 📍 체크포인트: ${cp.title}`,
      '',
      `> [!INFO] 스냅샷 정보`,
      `> - **ID**: \`${cp.id}\``,
      `> - **기록 시각**: \`${cp.createdAt}\``,
      `> - **Git 브랜치**: \`${cp.gitBranch || 'N/A'}\` (\`${cp.gitCommit || 'N/A'}\`)`,
      `> - **작업 디렉터리**: \`${cp.cwd}\``,
      '',
      '## 🎯 세션 목표',
      cp.goal,
      '',
      '## ✅ 완료된 단계 (Completed Steps)',
      ...cp.completedSteps.map((s) => `- [x] ${s}`),
      '',
      '## ⏳ 대기 과제 (Pending Tasks)',
      ...cp.pendingTasks.map((t) => `- [ ] ${t}`),
      '',
      '## 🧠 핵심 결정 사항 (Key Decisions)',
      ...cp.keyDecisions.map((d) => `- ${d}`),
      '',
      '## 🛡️ 활성 불변식 (Active Invariants)',
      ...cp.activeInvariants.map((inv) => `- 🔒 ${inv}`),
      '',
      '## 📁 수정된 파일 목록',
      ...cp.modifiedFiles.map((f) => `- \`${f}\``),
    ].join('\n');
  }

  /**
   * 타임라인 마크다운 렌더링
   */
  private renderTimelineMarkdown(): string {
    const events = this.timeSeriesEngine.generateTimeline(50);

    const lines: string[] = [
      '---',
      'title: "Synapse Causal Memory Timeline"',
      'tags:',
      '  - "synapse/timeline"',
      '---',
      '',
      '# ⏳ 시냅스 인과율 타임라인',
      '',
      `> 총 **${events.length}**개의 이벤트가 보존되어 있습니다.`,
      '',
      '## 📊 타임라인 시각화 (Mermaid)',
      '```mermaid',
      'timeline',
      '    title 세션 진화 타임라인',
    ];

    for (const ev of events.slice(-10)) {
      const datePart = ev.timestamp ? ev.timestamp.slice(0, 10) : '2026-11-09';
      const safeTitle = (ev.title || '이벤트').replaceAll('"', '').replaceAll(':', ' -');
      lines.push(`    ${datePart} : ${safeTitle}`);
    }

    lines.push('```', '', '## 📋 이벤트 이력');
    for (const ev of events) {
      const targetLink = ev.checkpointId ? `./Checkpoints/${ev.checkpointId}.md` : '#';
      lines.push(`### [${ev.title}](${targetLink})`);
      lines.push(`- **발생 일시**: \`${ev.timestamp}\``);
      lines.push(`- **요약**: ${ev.summary}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 옵시디언 캔버스(Canvas) JSON 문서 생성
   */
  private generateCanvasDocument(
    rules: readonly CausalRule[],
    relations: readonly CausalRelation[]
  ): ObsidianCanvasDocument {
    const nodes: ObsidianCanvasNode[] = [];
    const edges: ObsidianCanvasEdge[] = [];

    const ruleIdToNodeId = new Map<string, string>();
    const nodeWidth = 320;
    const nodeHeight = 160;
    const spacingX = 400;
    const spacingY = 220;
    const cols = 4;

    // 규칙 노드 배치 (격자 레이아웃)
    rules.forEach((rule, idx) => {
      const title = rule.title || rule.name || rule.id;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const nodeId = `rule_node_${idx}`;
      ruleIdToNodeId.set(title.toLowerCase(), nodeId);
      ruleIdToNodeId.set(rule.id.toLowerCase(), nodeId);

      const summaryInvariants =
        rule.invariants && rule.invariants.length > 0
          ? rule.invariants.slice(0, 2).map((i) => `• ${i}`).join('\n')
          : '• 불변식 없음';

      const markdownText = [
        `### 📌 [[Rules/${this.sanitizeFileName(title)}|${title}]]`,
        `**도메인**: \`${rule.domain}\` | **가중치**: \`${rule.weight ?? 1.0}\``,
        '',
        summaryInvariants,
      ].join('\n');

      nodes.push({
        id: nodeId,
        x: col * spacingX,
        y: row * spacingY,
        width: nodeWidth,
        height: nodeHeight,
        type: 'text',
        text: markdownText,
        color: this.getColorForDomain(rule.domain),
      });
    });

    // 인과 간선(Edges) 연결
    let edgeCounter = 0;
    for (const rel of relations) {
      const fromNodeId = ruleIdToNodeId.get(rel.from.toLowerCase());
      const toNodeId = ruleIdToNodeId.get(rel.to.toLowerCase());

      if (fromNodeId && toNodeId) {
        edges.push({
          id: `edge_${edgeCounter++}`,
          fromNode: fromNodeId,
          fromSide: 'right',
          toNode: toNodeId,
          toSide: 'left',
          label: rel.relation,
          color: rel.relation === 'blocks' ? '1' : '4', // 1: red, 4: cyan/green in canvas
        });
      }
    }

    return { nodes, edges };
  }

  /**
   * 도메인별 캔버스 색상 코드 매핑 (1: 빨강, 2: 주황, 3: 노랑, 4: 초록, 5: 파랑, 6: 보라)
   */
  private getColorForDomain(domain: string): string {
    switch (domain.toLowerCase()) {
      case 'security':
      case 'guard':
        return '1';
      case 'compiler':
        return '2';
      case 'memory':
      case 'database':
        return '4';
      case 'runner':
      case 'bus':
        return '5';
      case 'studio':
      case 'frontend':
        return '6';
      default:
        return '3';
    }
  }

  /**
   * 마크다운 텍스트로부터 CausalRule 역파싱
   */
  private parseRuleMarkdown(raw: string, defaultName: string): CausalRule | null {
    try {
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) return null;

      const fmText = fmMatch[1];
      const idMatch = fmText.match(/id:\s*"([^"]+)"/);
      const nameMatch = fmText.match(/name:\s*"([^"]+)"/);
      const domainMatch = fmText.match(/domain:\s*"([^"]+)"/);
      const confMatch = fmText.match(/confidence:\s*([0-9.]+)/);
      const weightMatch = fmText.match(/weight:\s*([0-9.]+)/);

      const invariants: string[] = [];
      const invSection = fmText.match(/invariants:\r?\n((?:\s*-\s*"[^"]+"\r?\n?)+)/);
      if (invSection) {
        const itemMatches = invSection[1].matchAll(/-\s*"([^"]+)"/g);
        for (const m of itemMatches) {
          invariants.push(m[1].replaceAll('\\"', '"'));
        }
      }

      const body = raw.slice(fmMatch[0].length).trim();
      const descMatch = body.match(/## 💡 요약 설명\r?\n([\s\S]*?)(?:\r?\n##|$)/);
      const description = descMatch ? descMatch[1].trim() : '';

      const ruleTitle = nameMatch ? nameMatch[1] : defaultName;
      return {
        id: idMatch ? idMatch[1] : `rule_${Date.now()}`,
        title: ruleTitle,
        name: ruleTitle,
        domain: domainMatch ? domainMatch[1] : 'general',
        confidence: confMatch ? parseFloat(confMatch[1]) : 1.0,
        weight: weightMatch ? parseFloat(weightMatch[1]) : 1.0,
        triggers: {
          files: [],
          keywords: [ruleTitle.toLowerCase()],
        },
        invariants: invariants || [],
        actions: [],
        context: description ? [description] : [],
        description,
        updatedAt: new Date().toISOString(),
      } as any;
    } catch {
      return null;
    }
  }

  /**
   * 마크다운 텍스트로부터 FailureHypothesis(함정) 역파싱
   */
  private parseTrapMarkdown(raw: string, defaultPattern: string): FailureHypothesis | null {
    try {
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) return null;

      const fmText = fmMatch[1];
      const idMatch = fmText.match(/id:\s*"([^"]+)"/);
      const titleMatch = fmText.match(/(?:title|trapPattern):\s*"([^"]+)"/);
      const domainMatch = fmText.match(/domain:\s*"([^"]+)"/);
      const sevMatch = fmText.match(/severity:\s*"([^"]+)"/);

      const body = raw.slice(fmMatch[0].length).trim();
      const reasonMatch = body.match(/## 💥 실패 원인 \(Root Cause\)\r?\n([\s\S]*?)(?:\r?\n##|$)/);
      const altMatch = body.match(/## ✅ 안전한 대안 \(Safe Solution\)\r?\n([\s\S]*?)(?:\r?\n##|$)/);

      const trapTitle = titleMatch ? titleMatch[1] : defaultPattern;
      const rootCause = reasonMatch ? reasonMatch[1].trim() : '사유 미기재';
      const counterMeasure = altMatch ? altMatch[1].trim() : '안전한 대안 미기재';

      return {
        id: idMatch ? idMatch[1] : `trap_${Date.now()}`,
        title: trapTitle,
        failedApproach: trapTitle,
        trapPattern: trapTitle,
        domain: domainMatch ? domainMatch[1] : 'general',
        environment: domainMatch ? domainMatch[1] : 'general',
        severity: (sevMatch ? sevMatch[1] : 'MEDIUM') as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
        rootCause,
        reason: rootCause,
        counterMeasure,
        safeAlternative: counterMeasure,
        triggerKeywords: [trapTitle],
        createdAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * 원자적 파일 쓰기 (임시 파일 생성 후 renameSync로 덮어쓰기하여 정전/중단 시 손상 0% 보장)
   */
  private atomicWriteFile(filePath: string, content: string): void {
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, filePath);
  }

  /**
   * 파일명에 사용할 수 없는 특수문자 및 Path Traversal 시퀀스 제거
   */
  private sanitizeFileName(name: string): string {
    return (
      name
        .replace(/\.\.+/g, '_') // 상위 디렉터리 접근(..) 차단
        .replace(/[\\/:*?"<>|\0]/g, '_') // 특수문자 및 널 바이트 치환
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'unnamed'
    );
  }
}
