import { spawn } from 'bun';
import { CAUSAL_MEMORY_CONFIG } from './causal-config';
import { CausalMemoryStore, type CausalQueryOptions, type CausalResonanceResult } from './causal-store';

/**
 * Git 작업 트리의 변경 파일 목록 자동 추출
 */
export async function detectModifiedFiles(cwd: string = process.cwd()): Promise<string[]> {
  try {
    const gitProc = spawn(['git', 'status', '--porcelain', '-uall'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(gitProc.stdout).text();
    await gitProc.exited;

    return output
      .split('\n')
      .map((line) => line.slice(3).trim().replaceAll('\\', '/'))
      .filter((line) => line.length > 0 && !line.startsWith('.synapse/') && !line.includes('/.synapse/'));
  } catch {
    return [];
  }
}

/**
 * 인과율 공명 쿼리 실행기
 */
export async function runCausalQuery(
  rawOptions: {
    files?: string[];
    keywords?: string[];
    command?: string;
    domain?: string;
    autoGit?: boolean;
    cwd?: string;
    propagateRelations?: boolean;
  },
  storeCustomPath?: string
): Promise<CausalResonanceResult> {
  const store = new CausalMemoryStore(storeCustomPath);

  let targetFiles = rawOptions.files ? [...rawOptions.files] : [];

  if (rawOptions.autoGit || targetFiles.length === 0) {
    const gitFiles = await detectModifiedFiles(rawOptions.cwd || process.cwd());
    if (gitFiles.length > 0) {
      targetFiles = Array.from(new Set([...targetFiles, ...gitFiles]));
    }
  }

  const queryOptions: CausalQueryOptions = {
    files: targetFiles,
    keywords: rawOptions.keywords,
    command: rawOptions.command,
    domain: rawOptions.domain,
    propagateRelations: rawOptions.propagateRelations,
  };

  return store.queryResonance(queryOptions);
}

/**
 * AI 에이전트 주입용 초경량 마크다운/텍스트 포맷터
 */
export function formatResonanceForAgent(result: CausalResonanceResult, compact: boolean = false): string {
  if (result.matchedCount === 0) {
    return `[Causal-Memory] 공명 규칙 0건 (토큰 절감률: ${result.tokenDietSavingsRatio}, 소요: ${result.queryDurationMs}ms)`;
  }

  if (compact) {
    return JSON.stringify({
      ok: true,
      durationMs: result.queryDurationMs,
      matchedCount: result.matchedCount,
      totalDatabaseRules: result.totalDatabaseRules,
      savings: result.tokenDietSavingsRatio,
      rules: result.resonanceRules.map((r) => ({
        id: r.id,
        domain: r.domain,
        title: r.title,
        invariants: r.invariants,
        actions: r.actions,
      })),
      relations: result.activeRelations,
    });
  }

  const lines: string[] = [
    `### 🧠 인과율 메모리 공명 주입 (${result.matchedCount}/${result.totalDatabaseRules}개 규칙 활성화, 절감률: ${result.tokenDietSavingsRatio}, ${result.queryDurationMs}ms)`,
  ];

  for (const rule of result.resonanceRules) {
    lines.push(`\n**[${rule.domain}] ${rule.title}**`);
    if (rule.invariants.length > 0) {
      lines.push('  - **불변 규칙(Invariants)**:');
      for (const inv of rule.invariants) {
        lines.push(`    • ${inv}`);
      }
    }
    if (rule.actions.length > 0) {
      lines.push('  - **실행 절차(Actions)**:');
      for (const act of rule.actions) {
        lines.push(`    • ${act}`);
      }
    }
    if (rule.context.length > 0) {
      lines.push('  - **핵심 맥락(Context)**:');
      for (const ctx of rule.context.slice(0, CAUSAL_MEMORY_CONFIG.MAX_CONTEXT_PREVIEW_LINES)) {
        lines.push(`    • ${ctx}`);
      }
    }
  }

  if (result.activeRelations.length > 0) {
    lines.push('\n### 🔗 활성 인과 간선 (Active Causal Relations)');
    for (const rel of result.activeRelations) {
      lines.push(`  • \`${rel.from}\` ──[${rel.relationType}]──▶ \`${rel.to}\``);
    }
  }

  return lines.join('\n');
}
