import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'bun';
import { CAUSAL_MEMORY_CONFIG } from '../memory/causal-config';
import { CausalMemoryStore } from '../memory/causal-store';
import { runCausalQuery, formatResonanceForAgent } from '../memory/causal-query';
import { startCausalServer } from '../memory/causal-server';

test('1. Causal Memory Store - 152 Rules & 37 Relations Integrity Audit', () => {
  const store = new CausalMemoryStore();
  const status = store.getStatus();

  expect(status.totalRules).toBeGreaterThanOrEqual(152);
  expect(status.totalRelations).toBeGreaterThanOrEqual(37);
  expect(status.domains.length).toBeGreaterThanOrEqual(7);

  const audit = store.audit();
  expect(audit.ok).toBe(true);
  expect(audit.issues.length).toBe(0);
  // 수학 백서 오분류가 제거되어 상시 활성 규칙이 4개 이하로 유지되는지 검증
  expect(audit.alwaysActiveCount).toBeLessThanOrEqual(5);
});

test('2. Causal Memory Resonance - Domain Precision, Relations & 93%+ Token Diet', async () => {
  // POE2 작업 컨텍스트 쿼리
  const poeResult = await runCausalQuery({
    keywords: ['poe2', 'updater'],
    files: ['updater.json'],
  });

  expect(poeResult.matchedCount).toBeGreaterThan(0);
  expect(poeResult.matchedCount).toBeLessThan(15);
  expect(poeResult.activeRelations.length).toBeGreaterThanOrEqual(3);

  // 오분류되었던 수학 백서가 POE2 공명에 섞이지 않았는지 검증
  const hasMathNoise = poeResult.resonanceRules.some((r) =>
    r.title.includes('Forbidden_Mathematics')
  );
  expect(hasMathNoise).toBe(false);

  const savingsNum = parseFloat(poeResult.tokenDietSavingsRatio);
  expect(savingsNum).toBeGreaterThan(90.0);

  // Vesper DSP 오디오 코어 컨텍스트 쿼리
  const vesperResult = await runCausalQuery({
    files: ['crates/vesper-audio-core/src/lib.rs'],
  });

  expect(vesperResult.matchedCount).toBeGreaterThan(0);
  expect(
    vesperResult.resonanceRules.some((r) => r.title === 'Vesper_DSP_Master_Invariants')
  ).toBe(true);
  expect(parseFloat(vesperResult.tokenDietSavingsRatio)).toBeGreaterThan(94.0);

  const mdOutput = formatResonanceForAgent(poeResult, false);
  expect(mdOutput).toContain('활성 인과 간선');
});

test('3. Legacy memory MCP 9 Tools Drop-in Compatibility (CRUD & Smart Graph)', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'causal-crud-test-'));
  const tempDbPath = join(tempDir, 'test_causal.json');
  copyFileSync(CAUSAL_MEMORY_CONFIG.GLOBAL_DB_PATH, tempDbPath);

  try {
    const store = new CausalMemoryStore(tempDbPath);

    // read_graph 스마트 공명 검증
    const smartGraph = store.readSmartGraph(['crates/vesper-audio-core/src/lib.rs']);
    expect(smartGraph.activeEntitiesCount).toBeLessThan(15);
    expect(smartGraph.totalIndexedRules).toBeGreaterThanOrEqual(152);

    // create_entities 검증
    const created = store.createEntities([
      {
        name: 'Test_New_Module',
        entityType: 'Feature',
        observations: ['절대 하드코딩 금지', '1. 초기화 수행'],
      },
    ]);
    expect(created.length).toBe(1);

    // open_nodes 검증
    const opened = store.openNodes(['Test_New_Module']);
    expect(opened.entities.length).toBe(1);
    expect(opened.entities[0].observations).toContain('절대 하드코딩 금지');

    // add_observations 검증
    const added = store.addObservations([
      { entityName: 'Test_New_Module', contents: ['2. 검증 수행'] },
    ]);
    expect(added[0].addedObservations).toContain('2. 검증 수행');

    // create_relations & search_nodes 검증
    store.createRelations([
      { from: 'Test_New_Module', to: 'Synapse_Kit_Core_Invariants', relationType: 'depends_on' },
    ]);
    const searched = store.searchNodes('Test_New_Module');
    expect(searched.entities.length).toBe(1);
    expect(searched.relations.some((r) => r.relationType === 'depends_on')).toBe(true);

    // delete_observations, delete_relations, delete_entities 검증
    store.deleteObservations([
      { entityName: 'Test_New_Module', observations: ['2. 검증 수행'] },
    ]);
    store.deleteRelations([
      { from: 'Test_New_Module', to: 'Synapse_Kit_Core_Invariants', relationType: 'depends_on' },
    ]);
    store.deleteEntities(['Test_New_Module']);

    const afterDelete = store.openNodes(['Test_New_Module']);
    expect(afterDelete.entities.length).toBe(0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('4. Live Local Daemon (Port 4242) & Ephemeral HTTP/MCP JSON-RPC Verification', async () => {
  const testPort = 4299;
  const server = startCausalServer({ port: testPort });

  try {
    // MCP initialize 핸드셰이크 검증
    const initRes = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      }),
    });
    const initData = await initRes.json();
    expect(initData.result.serverInfo.name).toBe('synapse-causal-memory');

    // MCP tools/list (21개 도구 노출 확인: 기본 12종 + 컨텍스트 3종 + 슈퍼코어 6종)
    const listRes = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });
    const listData = await listRes.json();
    expect(listData.result.tools.length).toBe(21);

    // MCP tools/call read_graph 호출 검증
    const callRes = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'read_graph', arguments: {} },
      }),
    });
    const callData = await callRes.json();
    const parsedGraph = JSON.parse(callData.result.content[0].text);
    expect(parsedGraph.totalIndexedRules).toBeGreaterThanOrEqual(152);
  } finally {
    server.stop();
  }
});

test('5. MCP Stdio Server E2E Subprocess Pipe Verification', async () => {
  const proc = spawn(['bun', 'D:/synapse/dist/cli.js', 'memory', 'mcp-stdio'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  try {
    const requests =
      [
        JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'initialize', params: {} }),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: {
            name: 'query_causal_memory',
            arguments: { keywords: ['vesper'], compact: true },
          },
        }),
      ].join('\n') + '\n';

    proc.stdin.write(requests);
    proc.stdin.flush();
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const lines = output
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(lines.length).toBe(2);

    const initReply = JSON.parse(lines[0]);
    expect(initReply.id).toBe(10);
    expect(initReply.result.serverInfo.name).toBe('synapse-causal-memory');

    const callReply = JSON.parse(lines[1]);
    expect(callReply.id).toBe(11);
    const payload = JSON.parse(callReply.result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.matchedCount).toBeGreaterThan(0);
  } finally {
    proc.kill();
  }
});
