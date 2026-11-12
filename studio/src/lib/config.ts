/**
 * 시냅스 스튜디오(Synapse Studio) 환경설정 및 시스템 상수
 */

export interface SynapseCoreInfo {
  readonly id: string;
  readonly name: string;
  readonly status: 'ONLINE' | 'ARMED' | 'ACTIVE' | 'SANDBOXED' | 'ENGAGED' | 'IDLE' | 'OFFLINE';
  readonly latency: string;
  readonly desc: string;
}

export const STUDIO_VERSION = "0.4.0";
export const DEFAULT_LSN = 1042;
export const MIN_LSN = 1;
export const MAX_LSN = 2000;
export const SCAN_DURATION_MS = 600;
export const OPTIC_WS_ENDPOINT = "ws://127.0.0.1:9222/devtools";

export const INITIAL_CORES: readonly SynapseCoreInfo[] = [
  { id: 'compiler', name: 'Compiler', status: 'ONLINE', latency: '0.00ms', desc: '증분 DAG 컴파일러' },
  { id: 'memory', name: 'Causal Memory', status: 'ONLINE', latency: '0.04ms', desc: '120B 가상 그래프' },
  { id: 'db', name: 'Synapse DB', status: 'ONLINE', latency: '0.12ms', desc: 'Markdown + SQLite WAL' },
  { id: 'bus', name: 'Neural Bus', status: 'ONLINE', latency: '0.30µs', desc: 'Zero-Copy 링버퍼' },
  { id: 'runner', name: 'Runner', status: 'ONLINE', latency: '0.05ms', desc: '자가치유 프로세스 감시' },
  { id: 'mesh', name: 'Mesh P2P', status: 'ONLINE', latency: '1.20ms', desc: '글로벌 분산 머클 동기화' },
  { id: 'guard', name: 'Guard', status: 'ARMED', latency: '0.15ms', desc: 'AST 시크릿 차단 방화벽' },
  { id: 'verifier', name: 'Verifier', status: 'ACTIVE', latency: '0.08ms', desc: '불변식 무결성 검증기' },
  { id: 'runtime', name: 'Runtime', status: 'SANDBOXED', latency: '0.22ms', desc: '격리 마이크로 VM' },
  { id: 'optic', name: 'Optic Browser', status: 'ENGAGED', latency: '0.04ms', desc: 'Fast-Path 듀얼 엔진' },
  { id: 'axon', name: 'Axon Deploy', status: 'IDLE', latency: '0.00ms', desc: '제로-토큰 고속 배포' },
] as const;
