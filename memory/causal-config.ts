import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * 인과율 메모리(Causal Memory) 전역 설정 및 환경 변수 모듈
 * 하드코딩을 배제하고 환경 변수와 OS 표준 경로를 통해 설정값을 관리합니다.
 */
export const CAUSAL_MEMORY_CONFIG = {
  /** 데이터베이스 스키마 버전 */
  SCHEMA_VERSION: process.env.SYNAPSE_MEMORY_VERSION || '2.1.0',

  /** 전역 인과율 메모리 데이터베이스 기본 경로 */
  GLOBAL_DB_PATH:
    process.env.SYNAPSE_MEMORY_PATH ||
    resolve(homedir(), '.gemini', 'antigravity', 'causal_memory.json'),

  /** 구형 메모리 백업 경로 */
  LEGACY_BACKUP_PATH:
    process.env.SYNAPSE_MEMORY_BACKUP_PATH ||
    resolve(homedir(), '.gemini', 'antigravity', 'memory_backup_20261101.json'),

  /** 패키지 내장 폴백 데이터베이스 경로 */
  LOCAL_DB_PATH: resolve(import.meta.dir, 'causal-memory.json'),

  /** 독립 로컬 데몬 서버 기본 호스트 */
  DEFAULT_HOST: process.env.SYNAPSE_MEMORY_HOST || '127.0.0.1',

  /** 독립 로컬 데몬 서버 기본 포트 */
  DEFAULT_PORT: parseInt(process.env.SYNAPSE_MEMORY_PORT || '4242', 10),

  /** 원격 Causal Memory 데몬 프록시 URL (예: Tailscale 피어 http://100.82.92.122:4242) */
  REMOTE_URL: process.env.SYNAPSE_MEMORY_REMOTE_URL || '',

  /** 원격 요청 제한 시간 (ms) */
  REMOTE_TIMEOUT_MS: parseInt(process.env.SYNAPSE_MEMORY_REMOTE_TIMEOUT || '3000', 10),

  /** MCP 서버 프로토콜 버전 */
  MCP_PROTOCOL_VERSION: process.env.SYNAPSE_MCP_VERSION || '2024-11-05',

  /** MCP 서버 식별 이름 */
  MCP_SERVER_NAME: 'synapse-causal-memory',

  /** 공명 쿼리 시 컨텍스트 최대 노출 줄 수 (토큰 절감 임계치) */
  MAX_CONTEXT_PREVIEW_LINES: parseInt(process.env.SYNAPSE_MEMORY_MAX_PREVIEW || '5', 10),

  /** 전역 컨텍스트 스냅샷(Checkpoint) 저장소 기본 경로 */
  CONTEXT_DB_PATH:
    process.env.SYNAPSE_CONTEXT_PATH ||
    resolve(homedir(), '.gemini', 'antigravity', 'causal_contexts.json'),

  /** 패키지 내장 폴백 컨텍스트 스냅샷 경로 */
  LOCAL_CONTEXT_DB_PATH: resolve(import.meta.dir, 'causal-contexts.json'),

  /** 최대 보존 컨텍스트 체크포인트 개수 */
  MAX_CHECKPOINTS_RETAINED: parseInt(process.env.SYNAPSE_MAX_CHECKPOINTS || '50', 10),

  /** 옵시디언(Obsidian) 볼트 기본 연동 루트 경로 */
  DEFAULT_OBSIDIAN_VAULT_PATH:
    process.env.SYNAPSE_OBSIDIAN_VAULT ||
    resolve(homedir(), 'Documents', 'Min', 'Min'),

  /** 옵시디언 볼트 내부 인과율 렌즈 저장 서브디렉터리 */
  OBSIDIAN_LENS_SUBDIR: process.env.SYNAPSE_LENS_SUBDIR || 'Synapse-Mental',
} as const;
