import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { CausalMemoryStore, type CausalRule, type CausalRelation } from '../memory/causal-store';
import { startCausalServer } from '../memory/causal-server';
import { pingPeer, syncWithPeer, queryRemotePeer } from '../memory/causal-peer';

describe('Causal Memory Peer & Mesh Synchronization Suite', () => {
  const TEST_PORT = 4343;
  let serverInstance: any;

  beforeAll(() => {
    serverInstance = startCausalServer({
      port: TEST_PORT,
      host: '127.0.0.1',
    });
  });

  afterAll(() => {
    if (serverInstance && typeof serverInstance.stop === 'function') {
      serverInstance.stop();
    }
  });

  test('1. Database Merge - Invariant & Relation Non-destructive Sync', () => {
    const store = new CausalMemoryStore();
    const initialStatus = store.getStatus();

    const sampleRule: CausalRule = {
      id: 'rule-test-peer-sync',
      domain: 'Infrastructure_And_Cloud',
      title: '테스트용 원격 동기화 규칙',
      triggers: { keywords: ['remote-peer-sync-test'] },
      invariants: ['원격 노드와의 무손실 병합이 검증되어야 한다.'],
      actions: ['동기화 성공 확인'],
      context: ['peer sync test'],
      lastVerified: '2026-11-04',
    };

    const sampleRel: CausalRelation = {
      from: '테스트용 원격 동기화 규칙',
      to: 'desktop-cj15bv4',
      relationType: 'synced_to',
    };

    const mergeRes = store.mergeDatabase([sampleRule], [sampleRel]);
    expect(mergeRes.totalRules).toBeGreaterThanOrEqual(initialStatus.totalRules);
    expect(mergeRes.addedRelations).toBeGreaterThanOrEqual(0);

    // 다시 동일 데이터 병합 시 중복 추가 방지 확인 (Idempotency)
    const idempotentRes = store.mergeDatabase([sampleRule], [sampleRel]);
    expect(idempotentRes.addedRules).toBe(0);
    expect(idempotentRes.addedRelations).toBe(0);

    // 정리: 테스트 규칙 및 관계 삭제
    store.deleteRule(sampleRule.id);
  });

  test('2. Live Peer Health & Latency Probe (GET /health)', async () => {
    const health = await pingPeer('127.0.0.1', TEST_PORT);
    expect(health.reachable).toBe(true);
    expect(health.rttMs).toBeGreaterThanOrEqual(0);
    expect(health.totalRules).toBeGreaterThan(100);
    expect(health.version).toBeDefined();
  });

  test('3. Live Peer Sync Endpoint (GET /sync & POST /sync)', async () => {
    const syncRes = await syncWithPeer('127.0.0.1', TEST_PORT, 'pull');
    expect(syncRes.success).toBe(true);
    expect(syncRes.direction).toBe('pull');
    expect(syncRes.durationMs).toBeGreaterThan(0);
    expect(syncRes.totalRules).toBeGreaterThan(100);
  });

  test('4. Remote Peer Resonance Query (POST /query)', async () => {
    const resonance = await queryRemotePeer(`http://127.0.0.1:${TEST_PORT}`, {
      keywords: ['oracle', 'cloud'],
    });

    expect(resonance.matchedCount).toBeGreaterThan(0);
    expect(resonance.resonanceRules.length).toBeGreaterThan(0);
    expect(resonance.queryDurationMs).toBeDefined();
  });
});
