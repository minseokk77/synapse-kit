import { test, expect, describe } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defineConfig,
  createCheckerPlugin,
  setLocale,
  getLocale,
  t,
  rustChecker,
  svelteChecker,
  javaChecker,
  cppChecker,
  csharpChecker,
  goChecker,
  pythonChecker,
  schemaChecker,
  nativeChecker,
  nsisChecker,
  CausalMemoryStore,
  formatResonanceForAgent,
} from '../index';

describe('Synapse Kit v0.2.1 Full Verification Suite', () => {
  test('1. 7 Standard Language Checkers + 3 System Checkers Registration & Dynamic i18n Titles', () => {
    const plugins = [
      rustChecker(),
      svelteChecker(),
      javaChecker(),
      cppChecker(),
      csharpChecker(),
      goChecker(),
      pythonChecker(),
      schemaChecker({ targets: [{ path: './package.json' }] }),
      nativeChecker({ targets: [{ path: './test.dll', expectedArchitecture: 'x64' }] }),
      nsisChecker({ templatePath: './installer.nsi' }),
    ];

    expect(plugins.length).toBe(10);
    const names = plugins.map((p) => p.name);
    expect(names).toEqual([
      'rust',
      'svelte',
      'java',
      'cpp',
      'csharp',
      'go',
      'python',
      'schema',
      'native',
      'nsis',
    ]);

    // 한국어 로케일 전환 시 동적 getter로 즉시 한국어 타이틀 반환 검증
    setLocale('ko');
    expect(getLocale()).toBe('ko');
    expect(plugins[0].title).toContain('Rust 백엔드');
    expect(plugins[3].title).toContain('C/C++ 네이티브');
    expect(plugins[6].title).toContain('Python 바이트코드');

    // 영어 로케일 전환 시 동일한 플러그인 인스턴스가 즉시 영어 타이틀 반환 검증 (한글 잔재 0건)
    setLocale('en');
    expect(getLocale()).toBe('en');
    for (const plugin of plugins) {
      expect(/[가-힣]/.test(plugin.title)).toBe(false);
    }
    expect(plugins[0].title).toContain('Rust Backend');
    expect(plugins[3].title).toContain('C/C++ Native');
    expect(plugins[6].title).toContain('Python Bytecode');
  });

  test('2. createCheckerPlugin & defineConfig Helpers', () => {
    const custom = createCheckerPlugin({
      name: 'custom-lint',
      title: 'Custom Linter',
      triggers: ['.custom'],
      check: async () => ({
        name: 'custom-lint',
        title: 'Custom Linter',
        status: 'success',
        durationMs: 1,
        details: 'Custom check passed',
      }),
    });

    const cfg = defineConfig({
      plugins: [custom],
    });

    expect(cfg.plugins.length).toBe(1);
    expect(cfg.plugins[0].name).toBe('custom-lint');
  });

  test('3. schemaChecker, nativeChecker (PE x64 Header), and nsisChecker Real File Verification', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'synapse-checkers-test-'));
    setLocale('ko');

    try {
      // A. Schema 파일 생성 및 검증
      writeFileSync(join(tempDir, 'valid.json'), JSON.stringify({ productName: 'Vesper', version: '1.0.0' }));
      const schemaPlugin = schemaChecker({
        targets: [
          {
            path: 'valid.json',
            validator: (data: any) => (data.productName === 'Vesper' ? null : 'Invalid productName'),
          },
        ],
      });

      const schemaRes = await schemaPlugin.check({
        rootDir: tempDir,
        options: { mode: 'all', agentMode: false, compactMode: false, watch: false },
      });
      expect(schemaRes.status).toBe('success');

      // B. Native Win32 PE x64 헤더 바이너리 모의 생성 및 검증
      const peBuffer = Buffer.alloc(256);
      peBuffer.writeUInt16LE(0x5a4d, 0); // 'MZ' DOS signature
      peBuffer.writeUInt32LE(0x80, 0x3c); // PE signature offset = 0x80
      peBuffer.writeUInt32LE(0x00004550, 0x80); // 'PE\0\0' signature
      peBuffer.writeUInt16LE(0x8664, 0x84); // Machine = x64 (0x8664)
      writeFileSync(join(tempDir, 'valid_x64.dll'), peBuffer);

      const nativePlugin = nativeChecker({
        targets: [{ path: 'valid_x64.dll', expectedArchitecture: 'x64' }],
      });
      const nativeRes = await nativePlugin.check({
        rootDir: tempDir,
        options: { mode: 'all', agentMode: false, compactMode: false, watch: false },
      });
      expect(nativeRes.status).toBe('success');

      // 아키텍처 불일치(x86 0x014c) 탐지 검증
      peBuffer.writeUInt16LE(0x014c, 0x84);
      writeFileSync(join(tempDir, 'invalid_x86.dll'), peBuffer);
      const nativeFailPlugin = nativeChecker({
        targets: [{ path: 'invalid_x86.dll', expectedArchitecture: 'x64' }],
      });
      const nativeFailRes = await nativeFailPlugin.check({
        rootDir: tempDir,
        options: { mode: 'all', agentMode: false, compactMode: false, watch: false },
      });
      expect(nativeFailRes.status).toBe('error');

      // C. NSIS 템플릿 검증
      const validNsis = `!include "MUI2.nsh"\nName "Vesper Installer"\nSection "MainSection" SEC01\nSectionEnd\n`;
      writeFileSync(join(tempDir, 'installer.nsi'), validNsis);
      const nsisPlugin = nsisChecker({ templatePath: 'installer.nsi' });
      const nsisRes = await nsisPlugin.check({
        rootDir: tempDir,
        options: { mode: 'all', agentMode: false, compactMode: false, watch: false },
      });
      expect(nsisRes.status).toBe('success');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('4. CausalMemoryStore Resonance Query & Audit Integrity', () => {
    const store = new CausalMemoryStore();
    const audit = store.audit();
    expect(audit.ok).toBe(true);
    expect(audit.totalRules).toBeGreaterThan(0);

    const resonance = store.queryResonance({
      files: ['src-tauri/src/main.rs'],
      keywords: ['tauri'],
    });
    expect(resonance.queryDurationMs).toBeLessThan(50);
    expect(resonance.matchedCount).toBeGreaterThanOrEqual(1);

    const compactStr = formatResonanceForAgent(resonance, true);
    const parsed = JSON.parse(compactStr);
    expect(parsed.ok).toBe(true);
  });
});
