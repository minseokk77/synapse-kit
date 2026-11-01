import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CAUSAL_MEMORY_CONFIG } from './causal-config';
import {
  CausalMemoryStore,
  type CausalMemoryDatabase,
  type CausalRelation,
  type CausalRule,
  type LegacyEntityInput,
} from './causal-store';

interface LegacyGraphFile {
  readonly entities?: readonly LegacyEntityInput[];
  readonly relations?: readonly CausalRelation[];
}

/**
 * 구형 지식 그래프(memory_backup)를 차세대 인과율 메모리(Causal Memory 2.1)로 무손실 변환합니다.
 * 엔티티뿐만 아니라 모든 인과 간선(Relations)을 100% 보존하며, 도메인 오분류를 방지합니다.
 */
export function migrateLegacyMemoryGraph(
  sourceBackupPath: string = CAUSAL_MEMORY_CONFIG.LEGACY_BACKUP_PATH,
  targetGlobalPath: string = CAUSAL_MEMORY_CONFIG.GLOBAL_DB_PATH,
  targetLocalPath: string = CAUSAL_MEMORY_CONFIG.LOCAL_DB_PATH
): {
  readonly ok: boolean;
  readonly totalRules: number;
  readonly totalRelations: number;
  readonly alwaysActiveCount: number;
  readonly domains: readonly string[];
} {
  if (!existsSync(sourceBackupPath)) {
    throw new Error(`구형 메모리 백업 파일을 찾을 수 없습니다: ${sourceBackupPath}`);
  }

  const raw = readFileSync(sourceBackupPath, 'utf-8');
  const legacy: LegacyGraphFile = JSON.parse(raw);
  const entities = legacy.entities || [];
  const legacyRelations = legacy.relations || [];

  const today = new Date().toISOString().split('T')[0];
  const seenIds = new Map<string, number>();
  const rules: CausalRule[] = [];

  for (const ent of entities) {
    const inferred = CausalMemoryStore.inferRuleFromEntity(ent, today);
    const baseId = inferred.id;
    const count = seenIds.get(baseId) || 0;
    seenIds.set(baseId, count + 1);

    const uniqueId = count === 0 ? baseId : `${baseId}-${count + 1}`;
    rules.push({
      ...inferred,
      id: uniqueId,
    });
  }

  // Vesper DSP 및 Synapse Kit 핵심 인과 불변식이 누락되지 않도록 보강 확인
  const hasVesperCore = rules.some((r) => r.id === 'rule-project_vesper_dsp-vesper-dsp-master-invariants');
  if (!hasVesperCore) {
    rules.push({
      id: 'rule-project_vesper_dsp-vesper-dsp-master-invariants',
      domain: 'Project_Vesper_DSP',
      title: 'Vesper_DSP_Master_Invariants',
      entityType: 'Architecture_Invariant',
      triggers: {
        files: ['D:/Vesper', 'crates/vesper-', 'vesper-apo', 'dsp-settings.json'],
        keywords: ['vesper', 'dsp', 'mmcss', 'virtuallock', '오디오', '사운드', '끊김', 'apo'],
        commands: ['check', 'build', 'package', 'sign'],
      },
      invariants: [
        '오디오 버퍼는 반드시 Win32 VirtualLock으로 물리 RAM에 고정하여 디스크 스왑 아웃(하드 페이지 폴트)을 원천 차단할 것',
        '오디오 처리 스레드는 Windows MMCSS(Pro Audio) 실시간 스케줄러에 필수 등록할 것',
        '설정 저장은 브라우저 localStorage 단독 의존을 금지하고 Crash-Safe 원자적(Atomic) 파일 저장(dsp-settings.json)을 사용할 것',
        'Windows 셧다운 시 WM_QUERYENDSESSION / SM_SHUTTINGDOWN 감지 후 정상 종료를 보장할 것',
      ],
      actions: [
        '1. Cargo Workspace 5대 마이크로 크레이트(vesper-config, vesper-ipc, vesper-audio-core, vesper-system, vesper-tauri) 경계 준수',
        '2. 수정된 크레이트 트랙만 인과율 증분 빌드 수행',
      ],
      context: [
        '실증 타깃 경로: D:\\Vesper\\dsp-boot-fix\\dsp',
        'APO DLL 및 Taskbar 네이티브 바이너리 아키텍처 무결성(x64 PE) 검증 필수',
      ],
      lastVerified: today,
    });
  }

  const hasSynapseCore = rules.some((r) => r.id === 'rule-project_synapse_kit-synapse-kit-core-invariants');
  if (!hasSynapseCore) {
    rules.push({
      id: 'rule-project_synapse_kit-synapse-kit-core-invariants',
      domain: 'Project_Synapse_Kit',
      title: 'Synapse_Kit_Core_Invariants',
      entityType: 'Framework_Invariant',
      triggers: {
        files: ['D:/synapse', 'D:/synapse-site', 'synapse.config.ts'],
        keywords: ['synapse', 'synapse-kit', '시냅스', '인과율', 'causal', '컴파일러', '체커'],
        commands: ['check', 'build', 'package', 'sign', 'init', 'memory'],
      },
      invariants: [
        'Git 상태 스캔 시 반드시 git status --porcelain -uall 플래그를 사용하여 미추적 하위 디렉터리 파일 누락을 방지할 것',
        'AI 에이전트 연동 시 --compact 모드를 통해 성공 시 11토큰 단일 라인 JSON을 반환하여 토큰을 99.8% 절감할 것',
        '패키지 매니저 및 런타임은 npm/npx를 절대 사용하지 않고 반드시 bun을 사용할 것',
      ],
      actions: [
        '1. 코드 변경 후 bun D:/synapse/dist/cli.js check --compact로 무결성 검증',
        '2. 메모리 조회 시 synapse memory query로 공명 규칙만 최소 토큰 주입',
      ],
      context: [
        '엔진 코어 경로: D:\\synapse',
        '공식 문서 및 위키 경로: D:\\synapse-site (KO/EN 다국어 로케일 자동 분기)',
      ],
      lastVerified: today,
    });
  }

  // 기존 33개 관계(Relations) 100% 보존 + 핵심 실무 인과 간선 보강
  const relations: CausalRelation[] = [...legacyRelations];
  const coreRelations: CausalRelation[] = [
    {
      from: 'POE2_AutoFilter_Project',
      to: 'POE2_AutoFilter_ReleaseProcess',
      relationType: 'governed_by_workflow',
    },
    {
      from: 'POE2_AutoFilter_ReleaseProcess',
      to: 'POE2_AutoFilter_Updater',
      relationType: 'triggers_update_of',
    },
    {
      from: 'POE2_AutoFilter_ReleaseProcess',
      to: 'POE2_AutoFilter_KnownBugs',
      relationType: 'verifies_and_notifies',
    },
    {
      from: 'Synapse_Kit_Core_Invariants',
      to: 'Vesper_DSP_Master_Invariants',
      relationType: 'verifies_and_builds',
    },
  ];

  for (const cr of coreRelations) {
    const exists = relations.some(
      (r) => r.from === cr.from && r.to === cr.to && r.relationType === cr.relationType
    );
    if (!exists) {
      relations.push(cr);
    }
  }

  const db: CausalMemoryDatabase = {
    version: CAUSAL_MEMORY_CONFIG.SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    totalRules: rules.length,
    totalRelations: relations.length,
    rules,
    relations,
  };

  const serialized = JSON.stringify(db, null, 2);

  for (const outPath of [targetGlobalPath, targetLocalPath]) {
    const dir = dirname(outPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(outPath, serialized, 'utf-8');
  }

  const alwaysActiveCount = rules.filter((r) => r.triggers.alwaysActive).length;
  const domains = Array.from(new Set(rules.map((r) => r.domain)));

  return {
    ok: true,
    totalRules: rules.length,
    totalRelations: relations.length,
    alwaysActiveCount,
    domains,
  };
}
