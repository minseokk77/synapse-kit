/**
 * 시냅스 공식 Model Context Protocol (MCP) 서버 환경설정 및 상수
 */

export const MCP_SERVER_CONFIG = {
  /** MCP 프로토콜 버전 */
  PROTOCOL_VERSION: "2024-11-05",
  /** 공식 MCP 서버 이름 */
  SERVER_NAME: "synapse-mcp",
  /** 서버 버전 */
  SERVER_VERSION: "0.4.1",
  /** 인과 쿼리 기본 최대 반환 개수 */
  DEFAULT_QUERY_LIMIT: 10,
  /** 기본 검증/감사 대상 소스 파일명 */
  DEFAULT_FILE_NAME: "source.ts",
  /** 기본 마크다운 볼트 디렉터리 경로 */
  DEFAULT_VAULT_DIR: "./.synapse-vault",
} as const;

export const MCP_ERROR_CODES = {
  /** JSON-RPC 파싱 오류 */
  PARSE_ERROR: -32700,
  /** 유효하지 않은 요청 */
  INVALID_REQUEST: -32600,
  /** 지원하지 않거나 찾을 수 없는 메서드 */
  METHOD_NOT_FOUND: -32601,
  /** 잘못된 파라미터 */
  INVALID_PARAMS: -32602,
  /** 내부 서버 오류 */
  INTERNAL_ERROR: -32603,
} as const;
