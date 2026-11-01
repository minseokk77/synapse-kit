/**
 * 인과율 메모리(Causal Memory) 전역 설정 및 환경 변수 모듈
 * 하드코딩을 배제하고 환경 변수와 OS 표준 경로를 통해 설정값을 관리합니다.
 */
export declare const CAUSAL_MEMORY_CONFIG: {
    /** 데이터베이스 스키마 버전 */
    readonly SCHEMA_VERSION: string;
    /** 전역 인과율 메모리 데이터베이스 기본 경로 */
    readonly GLOBAL_DB_PATH: string;
    /** 구형 메모리 백업 경로 */
    readonly LEGACY_BACKUP_PATH: string;
    /** 패키지 내장 폴백 데이터베이스 경로 */
    readonly LOCAL_DB_PATH: string;
    /** 독립 로컬 데몬 서버 기본 호스트 */
    readonly DEFAULT_HOST: string;
    /** 독립 로컬 데몬 서버 기본 포트 */
    readonly DEFAULT_PORT: number;
    /** MCP 서버 프로토콜 버전 */
    readonly MCP_PROTOCOL_VERSION: string;
    /** MCP 서버 식별 이름 */
    readonly MCP_SERVER_NAME: "synapse-causal-memory";
    /** 공명 쿼리 시 컨텍스트 최대 노출 줄 수 (토큰 절감 임계치) */
    readonly MAX_CONTEXT_PREVIEW_LINES: number;
};
