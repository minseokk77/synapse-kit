import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'bun';
import { Database } from 'bun:sqlite';

import { SynapseDB } from '../db';
import { CausalMemoryStore, type CausalMemoryDatabase } from '../memory';
import {
  getGitState,
  shouldSkipBuildTrack,
  shouldSkipSign,
  computeFileHash,
  saveBuildCache,
  loadBuildCache,
} from '../compiler/causal-build';
import { analyzeCausalGraph, executeChecks, schemaChecker, defineConfig } from '../compiler';

describe('Synapse Kit 3대 코어 (DB · Memory · Compiler) 미시행 심층 검증 스위트', () => {
  /**
   * [검증 방식 1] DB: 속성 기반 차등 라운드트립 퍼징 (Property-Based Differential Round-Trip Fuzzing)
   * - 200개 이상의 극단적/적대적 데이터 조합(빈 배열 [], 중첩 객체, 줄바꿈/따옴표/콜론/샵 포함 문자열,
   *   64비트 Snowflake ID 문자열, 선행 0 숫자 문자열, 한국어/이모지/위키링크)을 직렬화 -> 디스크 플러시 -> 재로드 후
   *   원본 메모리 객체와 100% 동일한지(Lossless Round-Trip) 검증합니다.
   */
  test('1. [DB 퍼징] 200개 적대적 페이로드(64-bit Snowflake, 빈 배열, 특수문자, 다중행) 무손실 라운드트립 검증', async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'synapse-fuzz-vault-'));
    try {
      const db = new SynapseDB({
        vaultDir,
        autoWatch: false,
      });
      await db.init();

      const col = db.collection<Record<string, unknown>>('fuzz_items');
      const totalDocs = 200;
      const expectedPayloads = new Map<string, { data: Record<string, unknown>; body: string }>();

      for (let i = 0; i < totalDocs; i++) {
        const id = `fuzz_${i}`;
        const snowflakeId = `156811819213861${String(1000 + i)}`; // 64-bit integer string beyond MAX_SAFE_INTEGER
        const leadingZeroCode = `000${i}`;
        const trickyText = `라인1: "따옴표" 및 #해시태그와 [[fuzz_${(i + 1) % totalDocs}]]\n라인2: key: value 위장 텍스트 \\ 백슬래시 🚀 한국어_${i}`;

        const data: Record<string, unknown> = {
          index: i,
          active: i % 2 === 0,
          snowflakeId,
          leadingZeroCode,
          emptyList: [],
          emptyObj: {},
          trickyText,
          stringList: [`item_${i}`, ` line\nbreak `, `colon:val`, `#hash`],
          nestedMeta: {
            level: i * 1.5,
            flag: i % 3 === 0,
            label: `중첩: "라벨_${i}"`,
          },
          objectList:
            i % 4 === 0
              ? []
              : [
                  {
                    subId: `sub_${i}_a`,
                    count: i,
                    innerTags: ['alpha', 'beta'],
                  },
                  {
                    subId: `sub_${i}_b`,
                    count: i + 10,
                    innerTags: [],
                  },
                ],
        };

        const body = `# 퍼징 문서 ${i}\n\n본문 내 위키링크 [[fuzz_${(i + 1) % totalDocs}]] 및 #태그_${i % 10} 포함.\n\n\`\`\`ts\nconst x = "${i}";\n\`\`\``;

        await col.save({ id, data, body });
        expectedPayloads.set(id, { data, body });
      }

      // 디스크 원자적 플러시
      db.flush();
      db.close();

      // 완전히 새로운 엔진 인스턴스로 디스크에서 콜드 리로드
      const reloadedDb = new SynapseDB({
        vaultDir,
        autoWatch: false,
      });
      await reloadedDb.init();
      const reloadedCol = reloadedDb.collection<Record<string, unknown>>('fuzz_items');

      expect(reloadedCol.count()).toBe(totalDocs);

      for (const [id, expected] of expectedPayloads.entries()) {
        const doc = reloadedCol.get(id);
        expect(doc).not.toBeNull();
        expect(doc!.data).toEqual(expected.data);
        // 64비트 Snowflake ID와 선행 0 코드가 숫자로 손실 변환되지 않고 문자열로 보존되었는지 엄격 확인
        expect(typeof doc!.data.snowflakeId).toBe('string');
        expect(doc!.data.snowflakeId).toBe(expected.data.snowflakeId);
        expect(typeof doc!.data.leadingZeroCode).toBe('string');
        expect(doc!.data.leadingZeroCode).toBe(expected.data.leadingZeroCode);
        expect(Array.isArray(doc!.data.emptyList)).toBe(true);
        expect((doc!.data.emptyList as unknown[]).length).toBe(0);
        expect(doc!.body).toBe(expected.body);
      }

      const invariants = reloadedDb.engine.connectome.verifyGraphInvariants();
      expect(invariants.ok).toBe(true);
      expect(invariants.brokenOutgoing).toEqual([]);
      expect(invariants.brokenIncoming).toEqual([]);
      expect(invariants.ghostTokens).toEqual([]);
      reloadedDb.close();
    } finally {
      rmSync(vaultDir, { recursive: true, force: true });
    }
  });

  /**
   * [검증 방식 2] DB: 그래프 위상 변이(Mutation) 및 양방향 대칭 불변성(Symmetry Invariant) 증명
   * - 다이아몬드(A -> B, C -> D), 순환(A -> B -> D -> A), 자기참조(S -> S), 지연 생성 타깃 노드를 구성하고,
   *   피참조 노드를 반복 수정/삭제/재생성할 때 역방향 간선(Incoming Synapses)과 역색인 토큰에 유령 데이터(Ghost State)가
   *   단 1개도 남지 않는지 수학적 불변식으로 검증합니다.
   */
  test('2. [DB 그래프 불변성] 피참조 노드 반복 수정·삭제·순환 참조 시 양방향 대칭성 및 유령 토큰 0건 증명', async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'synapse-graph-inv-'));
    try {
      const db = new SynapseDB({ vaultDir, autoWatch: false });
      await db.init();
      const nodes = db.collection<{ title: string; keyword: string }>('nodes');
      const connectome = db.engine.connectome;

      // 1. 다이아몬드 + 순환 + 자기참조 그래프 구성
      await nodes.save({
        id: 'node_a',
        data: { title: '시작 노드 A', keyword: 'ephemeralalphatoken' },
        body: '연결: [[nodes/node_b]] 및 [[nodes/node_c]]',
      });
      await nodes.save({
        id: 'node_b',
        data: { title: '중간 노드 B', keyword: 'ephemeralbetatoken' },
        body: '연결: [[nodes/node_d]]',
      });
      await nodes.save({
        id: 'node_c',
        data: { title: '중간 노드 C', keyword: 'ephemeralgammatoken' },
        body: '연결: [[nodes/node_d]]',
      });
      await nodes.save({
        id: 'node_d',
        data: { title: '종점 노드 D', keyword: 'ephemeraldeltatoken' },
        body: '순환 연결: [[nodes/node_a]]',
      });
      await nodes.save({
        id: 'node_self',
        data: { title: '자기참조 노드', keyword: 'selflooptoken' },
        body: '자기참조: [[nodes/node_self]]',
      });

      expect(connectome.verifyGraphInvariants().ok).toBe(true);
      expect(
        nodes
          .synapses('node_d')
          .incoming()
          .map((d) => d.id)
          .sort()
      ).toEqual(['node_b', 'node_c']);

      // 2. 핵심 검증: 피참조 타깃 노드(node_d)를 단독 업데이트하더라도 node_b, node_c가 node_d를 가리키는 역방향 간선이 보존되어야 함
      await nodes.save({
        id: 'node_d',
        data: { title: '종점 노드 D (수정됨)', keyword: 'replaceddeltatoken' },
        body: '순환 연결 유지: [[nodes/node_a]]',
      });

      expect(connectome.verifyGraphInvariants().ok).toBe(true);
      expect(
        nodes
          .synapses('node_d')
          .incoming()
          .map((d) => d.id)
          .sort()
      ).toEqual(['node_b', 'node_c']);

      // 이전 키워드('ephemeraldeltatoken')는 역색인에서 완전히 소거되어야 함 (유령 토큰 0건)
      expect(nodes.search('ephemeraldeltatoken')).toEqual([]);
      expect(nodes.search('replaceddeltatoken').map((r) => r.document.id)).toEqual(['node_d']);

      // 3. 중간 노드(node_b) 삭제 시 node_d의 incoming에서 node_b만 정확히 제거되고 node_c는 유지되어야 함
      await nodes.delete('node_b');
      expect(connectome.verifyGraphInvariants().ok).toBe(true);
      expect(
        nodes
          .synapses('node_d')
          .incoming()
          .map((d) => d.id)
      ).toEqual(['node_c']);
      expect(nodes.search('ephemeralbetatoken')).toEqual([]);
      db.close();
    } finally {
      rmSync(vaultDir, { recursive: true, force: true });
    }
  });

  /**
   * [검증 방식 3] DB: 실제 SQLite 바이너리 마이그레이션 + SQL 인젝션 방어 + 100 동시성 레이스 + 실시간 파일 감시자(Watcher)
   */
  test('3. [DB 실전 스트레스] 실제 bun:sqlite 마이그레이션, SQL Injection 차단, 100 동시 쓰기 원자성 및 실시간 파일 감시', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'synapse-sqlite-stress-'));
    const sqlitePath = join(tempRoot, 'legacy.sqlite');
    const vaultDir = join(tempRoot, 'vault');

    try {
      // 1. 실제 SQLite 바이너리 DB 생성 및 레코드 삽입
      const sqlite = new Database(sqlitePath, { create: true });
      sqlite.exec(`
        CREATE TABLE streamers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          tags_json TEXT
        );
        CREATE TABLE clips (
          clip_id TEXT PRIMARY KEY,
          streamer_id TEXT NOT NULL,
          title TEXT NOT NULL,
          views INTEGER NOT NULL
        );
      `);
      sqlite.prepare('INSERT INTO streamers VALUES (?, ?, ?)').run('st_1', '침착맨', JSON.stringify(['치지직', '스트리머']));
      sqlite.prepare('INSERT INTO clips VALUES (?, ?, ?, ?)').run('clip_101', 'st_1', '레전드 하이라이트', 9500);
      sqlite.close();

      const db = new SynapseDB({ vaultDir, autoWatch: false });
      await db.init();
      const migrator = db.createMigrator();

      // 2. SQL 인젝션 공격 테이블명 차단 검증
      await expect(
        migrator.migrateFromSqlite(sqlitePath, [
          {
            tableName: 'streamers; DROP TABLE clips--',
            targetCollection: 'hacked',
            mapRow: (row: Record<string, unknown>) => ({
              id: String(row.id),
              data: row,
            }),
          },
        ])
      ).rejects.toThrow('허용되지 않는 SQLite 테이블 식별자입니다');

      // 3. 정상 SQLite -> Markdown 볼트 마이그레이션 검증
      const migStats = await migrator.migrateFromSqlite(sqlitePath, [
        {
          tableName: 'streamers',
          targetCollection: 'streamers',
          mapRow: (row: Record<string, unknown>) => ({
            id: String(row.id),
            data: { name: String(row.name), tags: JSON.parse(String(row.tags_json || '[]')) },
            body: `# 스트리머 ${String(row.name)}`,
          }),
        },
        {
          tableName: 'clips',
          targetCollection: 'clips',
          mapRow: (row: Record<string, unknown>) => ({
            id: String(row.clip_id),
            data: { streamer_id: String(row.streamer_id), title: String(row.title), views: Number(row.views) },
            body: `# ${String(row.title)}\n\n스트리머 [[streamers/${String(row.streamer_id)}]] 클립`,
          }),
        },
      ]);

      expect(migStats.streamers).toBe(1);
      expect(migStats.clips).toBe(1);
      expect(
        db
          .collection('streamers')
          .synapses('st_1')
          .incoming()
          .map((d) => d.id)
      ).toEqual(['clip_101']);

      // 4. 100개 비동기 동시 저장 및 병렬 flush 레이스 컨디션 스트레스
      const clipsCol = db.collection<{ streamer_id: string; title: string; views: number }>('clips');
      await Promise.all(
        Array.from({ length: 100 }, async (_, idx) => {
          const cid = `concurrent_${idx % 25}`; // 25개 파일에 4중 경합 유도
          await clipsCol.save({
            id: cid,
            data: {
              streamer_id: 'st_1',
              title: `동시성 클립 #${idx}`,
              views: idx * 100,
            },
            body: `동시성 테스트 본문 [[streamers/st_1]]`,
          });
          if (idx % 10 === 0) {
            db.flush();
          }
        })
      );
      db.flush();
      db.close();

      // 볼트 내 임시 파일(.tmp)이 단 1개도 남아있지 않아야 함
      const clipFiles = readdirSync(join(vaultDir, 'clips'));
      expect(clipFiles.filter((f) => f.endsWith('.tmp'))).toEqual([]);
      expect(clipFiles.filter((f) => f.endsWith('.md')).length).toBe(26); // clip_101 + 25개

      // 5. 실시간 파일 감시(autoWatch) 핫리로드 검증
      const watchedDb = new SynapseDB({ vaultDir, autoWatch: true });
      await watchedDb.init();
      try {
        const watchedStreamers = watchedDb.collection<{ name: string }>('streamers');
        const targetMdPath = join(vaultDir, 'streamers', 'st_1.md');
        const currentRaw = readFileSync(targetMdPath, 'utf-8');
        const updatedRaw = currentRaw.replace('침착맨', '침착맨_외부편집됨');
        writeFileSync(targetMdPath, updatedRaw, 'utf-8');

        // 디바운스 감시자(80ms)가 반영할 시간을 대기 후 확인
        await new Promise((r) => setTimeout(r, 250));
        const hotReloaded = watchedStreamers.get('st_1');
        expect(hotReloaded?.data.name).toBe('침착맨_외부편집됨');
      } finally {
        watchedDb.close();
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * [검증 방식 4] Memory: 순환 그래프 다중 홉 종료 보장 + 도메인 우선순위 중복 병합 방어 + 고아 간선(Orphan Relation) 자동 정리
   */
  test('4. [Memory 심층 검증] 3-노드 순환 간선 무한루프 방지, 도메인 우선순위 중복 제거 및 삭제 시 고아 간선 0건 보장', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'synapse-mem-verify-'));
    const dbPath = join(tempDir, 'causal_test.json');

    try {
      const cyclicDb: CausalMemoryDatabase = {
        version: '2.0.0',
        updatedAt: new Date().toISOString(),
        totalRules: 3,
        totalRelations: 3,
        rules: [
          {
            id: 'rule_alpha',
            domain: 'BioPhys_Research_And_Architecture',
            title: 'Alpha_Node',
            triggers: { keywords: ['alpha_trigger'] },
            invariants: ['Alpha 불변식'],
            actions: ['Alpha 액션'],
            context: [],
          },
          {
            id: 'rule_beta',
            domain: 'BioPhys_Research_And_Architecture',
            title: 'Beta_Node',
            triggers: { keywords: ['beta_trigger'] },
            invariants: ['Beta 불변식'],
            actions: ['Beta 액션'],
            context: [],
          },
          {
            id: 'rule_gamma',
            domain: 'BioPhys_Research_And_Architecture',
            title: 'Gamma_Node',
            triggers: { keywords: ['gamma_trigger'] },
            invariants: ['Gamma 불변식'],
            actions: ['Gamma 액션'],
            context: [],
          },
        ],
        relations: [
          { from: 'Alpha_Node', to: 'Beta_Node', relationType: 'DEPENDS_ON' },
          { from: 'Beta_Node', to: 'Gamma_Node', relationType: 'DEPENDS_ON' },
          { from: 'Gamma_Node', to: 'Alpha_Node', relationType: 'DEPENDS_ON' }, // 완전 순환(Cycle)
        ],
      };

      const store = new CausalMemoryStore(dbPath, cyclicDb);

      // 1. maxHops: 10으로 순환 그래프를 쿼리해도 무한 루프 없이 15ms 이내에 정확히 3개 노드로 수렴해야 함
      const res = store.queryResonance({
        keywords: ['alpha_trigger'],
        propagateRelations: true,
        maxHops: 10,
      });
      expect(res.matchedCount).toBe(3);
      expect(res.queryDurationMs).toBeLessThan(15);

      // 2. 오분류된 중복 제목(BioPhys 규칙이 User_Preferences_And_Rules로 들어오는 경우) 병합 시 특화 도메인 보존 검증
      store.mergeDatabase(
        [
          {
            id: 'rule_biophys_good',
            domain: 'BioPhys_Research_And_Architecture',
            title: 'BioPhys_Core_Axiom',
            triggers: { keywords: ['biophys'] },
            invariants: ['정상 도메인 규칙'],
            actions: [],
            context: [],
            lastVerified: '2026-04-01T00:00:00.000Z',
          },
          {
            id: 'rule_biophys_bad_dup',
            domain: 'User_Preferences_And_Rules',
            title: 'BioPhys_Core_Axiom',
            triggers: { alwaysActive: true, keywords: ['biophys'] },
            invariants: ['오분류 상시 활성 규칙'],
            actions: [],
            context: [],
            lastVerified: '2026-04-09T00:00:00.000Z', // 날짜가 더 최신이어도 오분류 도메인이므로 기각되어야 함
          },
        ],
        []
      );

      const auditAfterMerge = store.audit();
      expect(auditAfterMerge.ok).toBe(true);
      expect(auditAfterMerge.alwaysActiveCount).toBe(0);

      // 3. 규칙 삭제 시 연결된 간선(고아 간선)까지 모두 정리되어 무결성 감사가 통과해야 함
      const deleted = store.deleteRule('rule_beta');
      expect(deleted).toBe(true);
      const auditAfterDelete = store.audit();
      expect(auditAfterDelete.ok).toBe(true);
      expect(auditAfterDelete.issues).toEqual([]);
      expect(auditAfterDelete.totalRelations).toBe(1); // Gamma -> Alpha 간선 1개만 남고 Beta 관련 간선 2개는 자동 제거됨
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * [검증 방식 5] Compiler: 임시 Git 저장소 기반 파일 이름 변경(git mv) 감지 + 상대 경로(./src) 캐시 무효화 + 바이너리 1비트 변조 탐지
   */
  test('5. [Compiler 실전 검증] Git Rename(R old -> new) 감지, ./상대경로 빌드 무효화 및 인스톨러 1-Bit 변조 서명 차단', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'synapse-compiler-git-'));
    try {
      // 1. 실제 임시 Git 저장소 초기화 및 커밋 생성
      spawnSync(['git', 'init'], { cwd: repoDir });
      spawnSync(['git', 'config', 'user.email', 'test@synapse.local'], { cwd: repoDir });
      spawnSync(['git', 'config', 'user.name', 'Synapse Tester'], { cwd: repoDir });

      const srcDir = join(repoDir, 'src');
      const distDir = join(repoDir, 'dist');
      writeFileSync(join(repoDir, '.gitignore'), 'node_modules/\n', 'utf-8');
      spawnSync(['powershell', '-Command', `New-Item -ItemType Directory -Force -Path "${srcDir}", "${distDir}"`]);

      const fileA = join(srcDir, 'alpha.ts');
      const artifactFile = join(distDir, 'bundle.js');
      writeFileSync(fileA, 'export const a = 1;\n', 'utf-8');
      writeFileSync(artifactFile, '// compiled bundle\n', 'utf-8');

      spawnSync(['git', 'add', '.'], { cwd: repoDir });
      spawnSync(['git', 'commit', '-m', 'init'], { cwd: repoDir });

      // 과거 시점의 빌드 캐시 기록
      const pastIso = new Date(Date.now() - 10_000).toISOString();
      const gitStateClean = await getGitState(repoDir);
      expect(gitStateClean.modifiedFiles).toEqual([]);

      const cache = loadBuildCache(repoDir);
      cache.tracks['frontend'] = {
        lastBuildTime: pastIso,
        gitCommit: gitStateClean.head,
        artifactExists: true,
      };
      saveBuildCache(repoDir, cache);

      // 2. 클린 상태에서는 상대 경로('./src') 소스 트랙이 정확히 스킵되어야 함
      const trackConfig = {
        name: 'frontend',
        cmd: 'bun --version',
        sources: ['./src'],
        artifacts: ['dist/bundle.js'],
      };
      const cleanDecision = shouldSkipBuildTrack(
        trackConfig,
        repoDir,
        gitStateClean.repoRoot,
        cache,
        gitStateClean.modifiedFiles,
        false
      );
      expect(cleanDecision.skip).toBe(true);

      // 3. git mv로 파일 이름 변경(R  src/alpha.ts -> src/beta.ts) 발생 시 getGitState가 감지하고 빌드 스킵을 차단해야 함
      spawnSync(['git', 'mv', 'src/alpha.ts', 'src/beta.ts'], { cwd: repoDir });
      const gitStateRenamed = await getGitState(repoDir);
      expect(gitStateRenamed.modifiedFiles.some((f) => f.includes('src/beta.ts') || f.includes('src/alpha.ts'))).toBe(true);

      const renameDecision = shouldSkipBuildTrack(
        trackConfig,
        repoDir,
        gitStateRenamed.repoRoot,
        cache,
        gitStateRenamed.modifiedFiles,
        false
      );
      expect(renameDecision.skip).toBe(false);
      expect(renameDecision.reason).toContain('소스 코드 변경 감지');

      // 4. 인스톨러 바이너리 1-Byte 비트 플립(Bit-Flip) 변조 시 서명 캐시 즉시 무효화 검증
      const installerPath = join(distDir, 'setup.exe');
      const sigPath = join(distDir, 'setup.exe.sig');
      const originalBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      writeFileSync(installerPath, originalBytes);
      writeFileSync(sigPath, 'valid_signature_ed25519', 'utf-8');

      const originalHash = computeFileHash(installerPath);
      cache.sign = {
        lastSignTime: new Date().toISOString(),
        installerHash: originalHash,
        signaturePath: sigPath,
      };

      // 변조 전: 서명 스킵 성공
      const signBefore = shouldSkipSign(installerPath, sigPath, cache, false);
      expect(signBefore.skip).toBe(true);

      // 마지막 1바이트에 1비트 XOR 변조 가하기
      const tamperedBytes = Buffer.from(originalBytes);
      tamperedBytes[tamperedBytes.length - 1] ^= 0x01;
      writeFileSync(installerPath, tamperedBytes);

      const signAfter = shouldSkipSign(installerPath, sigPath, cache, false);
      expect(signAfter.skip).toBe(false);
      expect(signAfter.reason).toContain('인스톨러 바이너리 변경 감지');
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  /**
   * [검증 방식 6] 3대 코어 폐루프 통합 검증 (Compiler ↔ Memory ↔ DB Closed-Loop Integration)
   * - Compiler가 소스 코드의 스키마/인과율 위반 및 의존성 그래프를 스캔하고,
   * - Memory가 해당 파일 및 도메인에 공명하는 인과율 규칙(CausalRule)을 0-토큰 역색인으로 추출하며,
   * - DB가 컴파일 감사 결과와 공명 규칙들을 양방향 위키링크([[rules/rule_id]])가 연결된 마크다운 볼트로 영속화한 뒤
   *   Obsidian Canvas(.canvas) 시각화로 내보내는 전 과정을 단일 파이프라인으로 검증합니다.
   */
  test('6. [Tri-Core 폐루프 통합] Compiler 정적 감사 -> Memory 공명 규칙 추출 -> DB 마크다운 볼트 영속화 및 Canvas 시각화', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'synapse-tricore-loop-'));
    const projectDir = join(workspaceDir, 'app');
    const vaultDir = join(workspaceDir, 'audit_vault');
    const memoryJsonPath = join(workspaceDir, 'causal_memory.json');
    const canvasPath = join(workspaceDir, 'audit_map.canvas');

    try {
      // 1. 대상 미니 프로젝트 생성 (스키마 불일치 유발: requiredKey 누락)
      const srcDir = join(projectDir, 'src');
      spawnSync(['powershell', '-Command', `New-Item -ItemType Directory -Force -Path "${srcDir}"`]);
      const configJsonPath = join(srcDir, 'app-config.json');
      writeFileSync(configJsonPath, JSON.stringify({ appName: 'SynapseApp' }, null, 2), 'utf-8');

      // 2. [Compiler] schemaChecker 플러그인 및 인과율 그래프 분석 수행
      const schemaPlugin = schemaChecker({
        targets: [
          {
            path: 'src/app-config.json',
            validator: (data: any) => (data.securityToken ? null : '필수 키 누락: securityToken'),
          },
        ],
      });

      const synapseConfig = defineConfig({
        rootDir: projectDir,
        plugins: [schemaPlugin],
      });

      const checkRes = await schemaPlugin.check({
        rootDir: projectDir,
        options: { mode: 'all', agentMode: false, compactMode: false, watch: false },
      });
      expect(checkRes.status).toBe('error');

      const causalDecision = await analyzeCausalGraph(projectDir, synapseConfig.plugins, {
        mode: 'all',
        agentMode: false,
        compactMode: false,
        watch: false,
      });
      expect(causalDecision.activePluginNames.has('schema')).toBe(true);

      // 3. [Memory] 위반된 파일('src/app-config.json')과 연관된 인과율 아키텍처 규칙 공명 쿼리
      const memoryStore = new CausalMemoryStore(memoryJsonPath, {
        version: '2.0.0',
        updatedAt: new Date().toISOString(),
        totalRules: 1,
        totalRelations: 0,
        rules: [
          {
            id: 'rule_schema_security_token',
            domain: 'Zero_Defect_Guard',
            title: 'AppConfig_Security_Schema_Policy',
            triggers: {
              files: ['src/app-config.json'],
              keywords: ['AppConfigSchema', 'securityToken'],
            },
            invariants: ['모든 배포 설정 JSON에는 securityToken 필수 키가 존재해야 함'],
            actions: ['누락 시 빌드 파이프라인 즉시 중단 및 볼트 감사 기록 생성'],
            context: ['보안 설정 누락 방지'],
          },
        ],
        relations: [],
      });

      const resonance = memoryStore.queryResonance({
        files: ['src/app-config.json'],
        keywords: ['AppConfigSchema'],
      });
      expect(resonance.matchedCount).toBe(1);
      const matchedRule = resonance.resonanceRules[0];

      // 4. [DB] 공명된 규칙과 컴파일러 감사 리포트를 마크다운 볼트에 상호 위키링크로 저장
      const db = new SynapseDB({ vaultDir, autoWatch: false });
      await db.init();

      const rulesCol = db.collection<{ domain: string; title: string; invariants: readonly string[] }>('rules');
      const reportsCol = db.collection<{ file: string; passed: boolean; details: string }>('reports');

      await rulesCol.save({
        id: matchedRule.id,
        data: {
          domain: matchedRule.domain,
          title: matchedRule.title,
          invariants: matchedRule.invariants,
        },
        body: `# ${matchedRule.title}\n\n- 불변식: ${matchedRule.invariants.join(', ')}`,
      });

      await reportsCol.save({
        id: 'audit_report_001',
        data: {
          file: 'src/app-config.json',
          passed: checkRes.status === 'success',
          details: checkRes.details || '',
        },
        body: `# 감사 리포트 #001\n\n대상 파일 \`src/app-config.json\`에서 스키마 위반이 감지되어 [[rules/${matchedRule.id}]] 규칙이 발동되었습니다.`,
      });

      db.flush();

      // 5. Connectome 역방향 링크 및 Obsidian Canvas 시각화 파일 생성 검증
      const incomingToRule = rulesCol.synapses(matchedRule.id).incoming();
      expect(incomingToRule.map((d) => d.id)).toEqual(['audit_report_001']);
      expect(db.engine.connectome.verifyGraphInvariants().ok).toBe(true);

      const canvas = db.exportCanvas(canvasPath);
      expect(canvas.nodes.length).toBe(2);
      expect(canvas.edges.length).toBe(1);
      expect(canvas.edges[0].fromNode).toBe('node_reports_audit_report_001');
      expect(canvas.edges[0].toNode).toBe(`node_rules_${matchedRule.id}`);
      db.close();
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
