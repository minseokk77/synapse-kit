import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'bun';
import { analyzeCausalGraph } from '../compiler/causal-graph';
import { rustChecker } from '../compiler/plugins/rust';
import { svelteChecker } from '../compiler/plugins/svelte';
import { saveBuildCache, loadBuildCache, getGitState } from '../compiler/causal-build';
import type { SynapseOptions } from '../compiler/types';

test('Clean Working Tree 0.00s Causal Skip Lifecycle', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'synapse-clean-test-'));

  try {
    // 1. Git 저장소 초기화 및 첫 커밋
    const initProc = spawn(['git', 'init'], { cwd: tempDir, stdout: 'pipe', stderr: 'pipe' });
    await initProc.exited;

    writeFileSync(join(tempDir, 'README.md'), '# Test Project');
    const addProc = spawn(['git', 'add', 'README.md'], { cwd: tempDir, stdout: 'pipe', stderr: 'pipe' });
    await addProc.exited;

    const commitProc = spawn(['git', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'Initial commit'], {
      cwd: tempDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await commitProc.exited;

    const plugins = [
      rustChecker({ workspaceDir: './' }),
      svelteChecker({ tsconfig: './tsconfig.json' }),
    ];

    const options: SynapseOptions = {
      mode: 'smart',
      agentMode: false,
      compactMode: false,
      watch: false,
    };

    // 2. 1회차: 캐시가 없으므로 베이스라인 실행 판정 (runAll: true)
    const decision1 = await analyzeCausalGraph(tempDir, plugins, options);
    expect(decision1.runAll).toBe(true);

    // 3. 검증 통과 후 캐시에 HEAD 커밋 저장
    const { head } = await getGitState(tempDir);
    expect(head.length).toBeGreaterThan(0);

    const cache = loadBuildCache(tempDir);
    cache.lastVerifiedHead = head;
    saveBuildCache(tempDir, cache);

    // 4. 2회차: Clean Working Tree + HEAD 일치 ➜ 0.00초 스킵 (runAll: false, 0 plugins)
    const decision2 = await analyzeCausalGraph(tempDir, plugins, options);
    expect(decision2.runAll).toBe(false);
    expect(decision2.activePluginNames.size).toBe(0);
    expect(decision2.reason).toContain('0.00');

    // 5. 파일 변경 시 ➜ 해당 플러그인만 선별 실행
    writeFileSync(join(tempDir, 'main.rs'), 'fn main() {}');
    const decision3 = await analyzeCausalGraph(tempDir, plugins, options);
    expect(decision3.runAll).toBe(false);
    expect(decision3.activePluginNames.has('rust')).toBe(true);
    expect(decision3.activePluginNames.has('svelte')).toBe(false);
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
