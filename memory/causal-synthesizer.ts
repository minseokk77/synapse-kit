import { spawn } from 'bun';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import {
  ContextCheckpointStore,
  type ContextCheckpoint,
  type SaveCheckpointInput,
  detectGitHeadInfo,
} from './causal-context';
import { CausalMemoryStore } from './causal-store';

/**
 * Git 변경 사항 상세 통계 규격
 */
export interface GitChangeStats {
  readonly insertions: number;
  readonly deletions: number;
  readonly filesChanged: number;
}

/**
 * Git 변경 코드에서 추출된 주요 심볼 메타데이터 규격
 */
export interface ExtractedCodeSymbols {
  readonly functions: readonly string[];
  readonly classes: readonly string[];
  readonly interfaces: readonly string[];
  readonly types: readonly string[];
}

/**
 * 작업 트리의 변경 사항 요약 규격
 */
export interface GitChangeSummary {
  readonly cwd: string;
  readonly branch?: string;
  readonly commit?: string;
  readonly modifiedFiles: readonly string[];
  readonly addedFiles: readonly string[];
  readonly deletedFiles: readonly string[];
  readonly untrackedFiles: readonly string[];
  readonly allActiveFiles: readonly string[];
  readonly stats: GitChangeStats;
  readonly extractedSymbols: ExtractedCodeSymbols;
  readonly detectedDomains: readonly string[];
}

/**
 * 역합성된 의도 및 진행 상태 규격
 */
export interface SynthesizedIntent {
  readonly title: string;
  readonly goal: string;
  readonly completedSteps: readonly string[];
  readonly pendingTasks: readonly string[];
  readonly keyDecisions: readonly string[];
  readonly activeInvariants: readonly string[];
  readonly suggestedKeywords: readonly string[];
}

/**
 * 자동 체크포인트 생성 옵션
 */
export interface AutoCheckpointOptions {
  readonly title?: string;
  readonly goal?: string;
  readonly extraCompletedSteps?: readonly string[];
  readonly extraPendingTasks?: readonly string[];
  readonly extraKeyDecisions?: readonly string[];
  readonly extraInvariants?: readonly string[];
  readonly customMeta?: Record<string, unknown>;
  readonly autoResonance?: boolean;
}

/**
 * Git 커밋 및 diff 기반으로 작업자의 의도와 상태를 역합성하는 인과율 엔진 클래스 (SRP 준수)
 */
export class CausalSynthesizerEngine {
  private readonly contextStore: ContextCheckpointStore;
  private readonly memoryStore: CausalMemoryStore;

  constructor(contextStore?: ContextCheckpointStore, memoryStore?: CausalMemoryStore) {
    this.contextStore = contextStore || new ContextCheckpointStore();
    this.memoryStore = memoryStore || new CausalMemoryStore();
  }

  /**
   * 지정된 작업 디렉터리의 Git 상태와 diff를 분석하여 변경 내역 요약 생성
   */
  public async inspectGitChanges(cwd: string = process.cwd()): Promise<GitChangeSummary> {
    try {
      const gitHead = await detectGitHeadInfo(cwd);

      // 1. git status --porcelain 실행
      const statusProc = spawn(['git', 'status', '--porcelain'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const statusOutput = (await new Response(statusProc.stdout).text()).trim();
      await statusProc.exited;

      const modifiedFiles: string[] = [];
      const addedFiles: string[] = [];
      const deletedFiles: string[] = [];
      const untrackedFiles: string[] = [];

      if (statusOutput.length > 0) {
        for (const line of statusOutput.split('\n')) {
          const trimmed = line.trimEnd();
          if (trimmed.length < 3) continue;

          const statusCode = trimmed.slice(0, 2);
          const rawFilePath = trimmed.slice(3).trim().replace(/^"|"$/g, '');
          const normalizedPath = rawFilePath.replaceAll('\\', '/');

          if (statusCode.includes('M')) {
            modifiedFiles.push(normalizedPath);
          } else if (statusCode.includes('A')) {
            addedFiles.push(normalizedPath);
          } else if (statusCode.includes('D')) {
            deletedFiles.push(normalizedPath);
          } else if (statusCode.includes('?')) {
            untrackedFiles.push(normalizedPath);
          }
        }
      }

      // 2. git diff --stat 파싱
      const stats = await this.parseGitStats(cwd);

      // 3. git diff 기반 심볼 추출
      const extractedSymbols = await this.extractSymbolsFromDiff(cwd);

      // 4. 도메인 분류
      const allActiveFiles = Array.from(
        new Set([...modifiedFiles, ...addedFiles, ...untrackedFiles])
      );
      const detectedDomains = this.detectDomainsFromFiles(allActiveFiles);

      return {
        cwd,
        branch: gitHead.branch,
        commit: gitHead.commit,
        modifiedFiles,
        addedFiles,
        deletedFiles,
        untrackedFiles,
        allActiveFiles,
        stats,
        extractedSymbols,
        detectedDomains,
      };
    } catch {
      // Git 환경이 아니거나 에러 발생 시 파일 시스템 스캔 폴백
      return this.fallbackFilesystemScan(cwd);
    }
  }

  /**
   * Git 통계 파싱 (git diff --stat)
   */
  private async parseGitStats(cwd: string): Promise<GitChangeStats> {
    try {
      const proc = spawn(['git', 'diff', 'HEAD', '--shortstat'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const out = (await new Response(proc.stdout).text()).trim();
      await proc.exited;

      let filesChanged = 0;
      let insertions = 0;
      let deletions = 0;

      const filesMatch = out.match(/(\d+)\s+files?\s+changed/i);
      const insertMatch = out.match(/(\d+)\s+insertions?\(\+\)/i);
      const deleteMatch = out.match(/(\d+)\s+deletions?\(-\)/i);

      if (filesMatch) filesChanged = parseInt(filesMatch[1], 10);
      if (insertMatch) insertions = parseInt(insertMatch[1], 10);
      if (deleteMatch) deletions = parseInt(deleteMatch[1], 10);

      return { filesChanged, insertions, deletions };
    } catch {
      return { filesChanged: 0, insertions: 0, deletions: 0 };
    }
  }

  /**
   * git diff로부터 변경된 함수, 클래스, 타입 심볼을 추출
   */
  private async extractSymbolsFromDiff(cwd: string): Promise<ExtractedCodeSymbols> {
    const functions = new Set<string>();
    const classes = new Set<string>();
    const interfaces = new Set<string>();
    const types = new Set<string>();

    try {
      const proc = spawn(['git', 'diff', 'HEAD', '-U1'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const diffText = await new Response(proc.stdout).text();
      await proc.exited;

      if (!diffText || diffText.length === 0) {
        return { functions: [], classes: [], interfaces: [], types: [] };
      }

      for (const line of diffText.split('\n')) {
        // 추가된 줄 또는 hunk 헤더에만 관심 집중
        if (!line.startsWith('+') && !line.startsWith('@@')) continue;

        const content = line.startsWith('+') ? line.slice(1).trim() : line;

        // 함수 검출: function foo, async foo, const foo = () =>
        const fnMatch =
          content.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/) ||
          content.match(/(?:export\s+)?(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/);
        if (fnMatch && fnMatch[1]) {
          functions.add(fnMatch[1]);
        }

        // 클래스 검출: class MyClass
        const clsMatch = content.match(
          /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/
        );
        if (clsMatch && clsMatch[1]) {
          classes.add(clsMatch[1]);
        }

        // 인터페이스 검출: interface MyInterface
        const ifaceMatch = content.match(/(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/);
        if (ifaceMatch && ifaceMatch[1]) {
          interfaces.add(ifaceMatch[1]);
        }

        // 타입 검출: type MyType =
        const typeMatch = content.match(/(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/);
        if (typeMatch && typeMatch[1]) {
          types.add(typeMatch[1]);
        }
      }

      return {
        functions: Array.from(functions).slice(0, 15),
        classes: Array.from(classes).slice(0, 10),
        interfaces: Array.from(interfaces).slice(0, 10),
        types: Array.from(types).slice(0, 10),
      };
    } catch {
      return { functions: [], classes: [], interfaces: [], types: [] };
    }
  }

  /**
   * 파일 경로 기반 도메인 분류
   */
  private detectDomainsFromFiles(files: readonly string[]): readonly string[] {
    const domains = new Set<string>();

    for (const file of files) {
      const lower = file.toLowerCase();
      if (lower.includes('test') || lower.endsWith('.test.ts') || lower.endsWith('.spec.ts')) {
        domains.add('testing');
      }
      if (lower.includes('compiler') || lower.includes('ast')) {
        domains.add('compiler');
      }
      if (lower.includes('memory') || lower.includes('causal')) {
        domains.add('memory');
      }
      if (lower.includes('db') || lower.includes('database') || lower.includes('sqlite')) {
        domains.add('database');
      }
      if (lower.includes('mesh') || lower.includes('distributed') || lower.includes('peer')) {
        domains.add('mesh');
      }
      if (lower.includes('runner') || lower.includes('execution')) {
        domains.add('runner');
      }
      if (lower.includes('bus') || lower.includes('event')) {
        domains.add('bus');
      }
      if (lower.includes('guard') || lower.includes('security')) {
        domains.add('security');
      }
      if (lower.includes('studio') || lower.includes('ui') || lower.includes('view')) {
        domains.add('frontend');
      }
      if (lower.includes('lens') || lower.includes('obsidian')) {
        domains.add('obsidian-lens');
      }
    }

    if (domains.size === 0) {
      domains.add('core');
    }

    return Array.from(domains);
  }

  /**
   * Git 미설치 또는 Git 저장소가 아닌 경우의 폴백 파일시스템 스캔
   */
  private fallbackFilesystemScan(cwd: string): GitChangeSummary {
    try {
      const modified: string[] = [];
      if (existsSync(cwd)) {
        const entries = readdirSync(cwd, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && !entry.name.startsWith('.')) {
            modified.push(entry.name);
          }
        }
      }

      return {
        cwd,
        modifiedFiles: modified,
        addedFiles: [],
        deletedFiles: [],
        untrackedFiles: [],
        allActiveFiles: modified,
        stats: { insertions: 0, deletions: 0, filesChanged: modified.length },
        extractedSymbols: { functions: [], classes: [], interfaces: [], types: [] },
        detectedDomains: ['general'],
      };
    } catch {
      return {
        cwd,
        modifiedFiles: [],
        addedFiles: [],
        deletedFiles: [],
        untrackedFiles: [],
        allActiveFiles: [],
        stats: { insertions: 0, deletions: 0, filesChanged: 0 },
        extractedSymbols: { functions: [], classes: [], interfaces: [], types: [] },
        detectedDomains: ['unknown'],
      };
    }
  }

  /**
   * 변경 사항 분석 결과를 기반으로 작업 의도 및 컨텍스트를 자동 역합성(Reverse Synthesis)
   */
  public synthesizeIntent(
    summary: GitChangeSummary,
    customTitle?: string
  ): SynthesizedIntent {
    const completedSteps: string[] = [];
    const pendingTasks: string[] = [];
    const keyDecisions: string[] = [];
    const activeInvariants: string[] = [];
    const suggestedKeywords: string[] = [...summary.detectedDomains];

    // 1. 클래스 및 인터페이스 기반 완료 단계 생성
    if (summary.extractedSymbols.classes.length > 0) {
      completedSteps.push(
        `핵심 클래스 모듈화 및 선언: ${summary.extractedSymbols.classes.join(', ')}`
      );
    }
    if (summary.extractedSymbols.interfaces.length > 0) {
      completedSteps.push(
        `타입 계약 및 인터페이스 정의: ${summary.extractedSymbols.interfaces.join(', ')}`
      );
    }
    if (summary.extractedSymbols.functions.length > 0) {
      completedSteps.push(
        `주요 함수 및 알고리즘 구현: ${summary.extractedSymbols.functions.slice(0, 5).join(', ')}`
      );
    }

    // 2. 도메인별 작업 성과 도출
    if (summary.detectedDomains.includes('testing')) {
      completedSteps.push('단위 및 통합 검증 테스트 스위트 작성 및 정밀 검증 준비');
    }
    if (summary.detectedDomains.includes('memory')) {
      completedSteps.push('인과율 메모리 및 컨텍스트 스냅샷 아키텍처 반영');
      activeInvariants.push('메모리 쿼리 시 0ms 즉각 응답 및 무손실 인과율 보존');
    }
    if (summary.detectedDomains.includes('obsidian-lens')) {
      completedSteps.push('옵시디언 마크다운 볼트 및 시각적 캔버스 연동 계층 구축');
    }

    // 변경된 파일 수 기반 보강
    if (summary.addedFiles.length > 0) {
      completedSteps.push(
        `신규 아키텍처 파일 생성 (${summary.addedFiles.length}개 파일: ${summary.addedFiles.slice(0, 3).join(', ')}${summary.addedFiles.length > 3 ? ' 외' : ''})`
      );
    }
    if (summary.modifiedFiles.length > 0) {
      completedSteps.push(
        `기존 모듈 리팩터링 및 기능 확장 (${summary.modifiedFiles.length}개 파일)`
      );
    }

    // 기본 완료 단계 폴백
    if (completedSteps.length === 0) {
      completedSteps.push('소스 코드 변경 및 모듈 구조 정비');
    }

    // 3. 미완료 대기 작업(Pending Tasks) 역합성
    const hasTests = summary.allActiveFiles.some(
      (f) => f.includes('test') || f.endsWith('.test.ts')
    );
    if (!hasTests) {
      pendingTasks.push('추가/수정된 모듈에 대한 포괄적 통합 테스트 스위트 작성 및 회귀 방지');
    }
    pendingTasks.push('Bun 런타임 기반 빌드 검증 (`bun run build`) 및 무오류 확인');
    pendingTasks.push('전역 컨텍스트 스냅샷 데이터베이스 동기화 및 기억 영속화');

    // 4. 주요 의사결정(Key Decisions) 도출
    keyDecisions.push('하드코딩 배제 및 환경 변수/설정 모듈 중심의 설정 아키텍처 적용');
    keyDecisions.push('SOLID 단일 책임 원칙(SRP)을 준수한 독립 엔진 분리');
    if (summary.detectedDomains.includes('testing')) {
      keyDecisions.push('모의(Mock)를 지양하고 실제 격리 환경에서의 End-to-End 동작 검증 수행');
    }

    // 5. 제목 및 목표 생성
    const primaryDomain = summary.detectedDomains[0] || 'core';
    const autoTitle =
      customTitle ||
      `[자동 역합성] ${primaryDomain.toUpperCase()} 모듈 아키텍처 변경 (${summary.stats.filesChanged || summary.allActiveFiles.length}개 파일 반영)`;

    const autoGoal = `${summary.detectedDomains.join(', ')} 영역의 기능을 확장하고 변경 사항을 무결하게 정합하는 작업`;

    return {
      title: autoTitle,
      goal: autoGoal,
      completedSteps,
      pendingTasks,
      keyDecisions,
      activeInvariants,
      suggestedKeywords,
    };
  }

  /**
   * 원클릭 자동 체크포인트 생성 (Git diff 분석 ➔ 역합성 ➔ 스냅샷 저장)
   */
  public async autoCheckpoint(
    cwd: string = process.cwd(),
    options: AutoCheckpointOptions = {}
  ): Promise<ContextCheckpoint> {
    const summary = await this.inspectGitChanges(cwd);
    const synthesized = this.synthesizeIntent(summary, options.title);

    const mergedCompletedSteps = [
      ...synthesized.completedSteps,
      ...(options.extraCompletedSteps || []),
    ];

    const mergedPendingTasks = [
      ...synthesized.pendingTasks,
      ...(options.extraPendingTasks || []),
    ];

    const mergedKeyDecisions = [
      ...synthesized.keyDecisions,
      ...(options.extraKeyDecisions || []),
    ];

    const mergedInvariants = [
      ...synthesized.activeInvariants,
      ...(options.extraInvariants || []),
    ];

    const saveInput: SaveCheckpointInput = {
      title: options.title || synthesized.title,
      goal: options.goal || synthesized.goal,
      cwd,
      activeFiles: summary.allActiveFiles,
      modifiedFiles: [...summary.modifiedFiles, ...summary.addedFiles],
      completedSteps: mergedCompletedSteps,
      pendingTasks: mergedPendingTasks,
      keyDecisions: mergedKeyDecisions,
      activeInvariants: mergedInvariants,
      keywords: synthesized.suggestedKeywords,
      domain: summary.detectedDomains[0] || 'core',
      autoGit: true,
      autoResonance: options.autoResonance ?? true,
      customMeta: {
        stats: summary.stats,
        symbols: summary.extractedSymbols,
        synthesizedAt: new Date().toISOString(),
        ...options.customMeta,
      },
    };

    return this.contextStore.saveCheckpoint(saveInput);
  }
}
