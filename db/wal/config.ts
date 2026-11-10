/**
 * 시냅스 Causal-WAL 엔진 환경 설정 및 상수 모듈 (WAL Configuration & Constants)
 * 하드코딩 배제 원칙 준수: 모든 기본 용량, 타임아웃, PRAGMA 상수를 중앙 집중 관리
 */

export const WAL_CONFIG_DEFAULTS = {
  /** 순환 링 버퍼 기본 슬롯 용량 (2의 거듭제곱 권장) */
  RING_BUFFER_CAPACITY: Number(process.env.SYNAPSE_WAL_RING_CAPACITY) || 4096,

  /** 트랜잭션 아레나 초기 사전 할당 슬롯 수 */
  ARENA_INITIAL_CAPACITY: Number(process.env.SYNAPSE_WAL_ARENA_CAPACITY) || 256,

  /** 아레나 최대 확장 상한선 */
  ARENA_MAX_CAPACITY: Number(process.env.SYNAPSE_WAL_ARENA_MAX_CAPACITY) || 65536,

  /** SQLite WAL 기본 파일명 */
  SQLITE_WAL_FILENAME: process.env.SYNAPSE_WAL_SQLITE_FILENAME || "synapse_causal_wal.sqlite",

  /** SQLite mmap 가상 메모리 매핑 크기 (256MB - OS 페이지 캐시 제로-카피 위임) */
  SQLITE_MMAP_SIZE_BYTES: Number(process.env.SYNAPSE_WAL_MMAP_BYTES) || 268_435_456,

  /** SQLite Busy Timeout (밀리초) */
  SQLITE_BUSY_TIMEOUT_MS: Number(process.env.SYNAPSE_WAL_BUSY_TIMEOUT_MS) || 5000,

  /** SQLite WAL 동기화 모드 */
  SQLITE_SYNC_MODE: (process.env.SYNAPSE_WAL_SYNC_MODE as "NORMAL" | "FULL" | "OFF") || "NORMAL",
} as const;

/** 인과율 WAL 이벤트 유형 */
export enum CausalWalEventType {
  DOC_UPSERT = "DOC_UPSERT",
  DOC_DELETE = "DOC_DELETE",
  EDGE_LINK = "EDGE_LINK",
  EDGE_UNLINK = "EDGE_UNLINK",
  COMPILER_METRIC = "COMPILER_METRIC",
  CHECKPOINT_MARK = "CHECKPOINT_MARK",
}

/** 컴파일러 시계열 메트릭 페이로드 규격 */
export interface CompilerTemporalMetric {
  readonly targetFile: string;
  readonly language: string;
  readonly durationMs: number;
  readonly binarySizeBytes?: number;
  readonly symbolCount?: number;
  readonly success: boolean;
  readonly errorMessage?: string;
}

/** WAL 설정 옵션 인터페이스 */
export interface CausalWalConfig {
  /** 인메모리 링 버퍼 최대 슬롯 수 (기본: 4096) */
  readonly ringCapacity?: number;
  /** 아레나 사전 할당 슬롯 수 (기본: 256) */
  readonly arenaCapacity?: number;
  /** SQLite WAL 디스크 영속화 활성화 여부 (기본: false - 순수 인메모리 링 버퍼) */
  readonly persistSqlite?: boolean;
  /** SQLite WAL 파일 커스텀 경로 (미지정 시 vaultDir 내부에 생성) */
  readonly sqlitePath?: string;
  /** SQLite 동기화 수준 */
  readonly syncMode?: "NORMAL" | "FULL" | "OFF";
}
