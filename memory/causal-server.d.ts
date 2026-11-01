import { CausalMemoryStore } from './causal-store';
export interface ServerOptions {
    readonly port?: number;
    readonly host?: string;
    readonly dbPath?: string;
}
export interface JsonRpcRequest {
    readonly jsonrpc?: string;
    readonly id?: string | number | null;
    readonly method: string;
    readonly params?: Record<string, any>;
}
/**
 * MCP 표준 도구 스키마 목록 (신규 인과율 도구 3종 + 구형 memory 호환 도구 9종 = 총 12종)
 */
export declare const CAUSAL_MCP_TOOLS: readonly [{
    readonly name: "query_causal_memory";
    readonly description: "작업 컨텍스트(수정된 파일, 키워드, 명령어, 도메인)에 매칭되는 인과율 지식과 불변 규칙만 0ms 초경량으로 공명 쿼리합니다.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly files: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly description: "감지할 대상 파일 경로 목록 (생략 시 Git 변경 파일 자동 감지)";
            };
            readonly keywords: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly description: "검색할 도메인/작업 키워드 목록";
            };
            readonly command: {
                readonly type: "string";
                readonly description: "연동 명령어 (예: check, build, release, sign)";
            };
            readonly domain: {
                readonly type: "string";
                readonly description: "특정 도메인 필터";
            };
            readonly compact: {
                readonly type: "boolean";
                readonly description: "초소형 JSON 포맷 반환 여부";
            };
        };
    };
}, {
    readonly name: "assert_causal_rule";
    readonly description: "신규 인과율 규칙(원인 트리거 ➔ 불변 계약 ➔ 실행 지침)을 메모리에 등록하거나 갱신합니다.";
    readonly inputSchema: {
        readonly type: "object";
        readonly required: readonly ["id", "domain", "title", "triggers"];
        readonly properties: {
            readonly id: {
                readonly type: "string";
            };
            readonly domain: {
                readonly type: "string";
            };
            readonly title: {
                readonly type: "string";
            };
            readonly triggers: {
                readonly type: "object";
            };
            readonly invariants: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
            };
            readonly actions: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
            };
            readonly context: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
            };
        };
    };
}, {
    readonly name: "audit_causal_memory";
    readonly description: "인과율 메모리 데이터베이스의 무결성, 도메인 분포, 토큰 절감 상태를 감사(Audit)합니다.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {};
    };
}, {
    readonly name: "read_graph";
    readonly description: "Read the active causal resonance knowledge graph (automatically filters out unrelated noise for 90%+ token savings)";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {};
    };
}, {
    readonly name: "search_nodes";
    readonly description: "Search for causal rules and nodes in the knowledge graph based on a query and traverse causal relations";
    readonly inputSchema: {
        readonly type: "object";
        readonly required: readonly ["query"];
        readonly properties: {
            readonly query: {
                readonly type: "string";
                readonly description: "The search query to match against rule titles, domains, triggers, and invariants";
            };
        };
    };
}, {
    readonly name: "open_nodes";
    readonly description: "Open specific causal rule nodes in the knowledge graph by their names or IDs";
    readonly inputSchema: {
        readonly type: "object";
        readonly required: readonly ["names"];
        readonly properties: {
            readonly names: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly description: "An array of entity names or rule IDs to retrieve";
            };
        };
    };
}, {
    readonly name: "create_entities";
    readonly description: "Create multiple new entities (automatically converted into structured Causal Rules)";
    readonly inputSchema: {
        readonly type: "object";
        readonly required: readonly ["entities"];
        readonly properties: {
            readonly entities: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly required: readonly ["name", "entityType", "observations"];
                    readonly properties: {
                        readonly name: {
                            readonly type: "string";
                        };
                        readonly entityType: {
                            readonly type: "string";
                        };
                        readonly observations: {
                            readonly type: "array";
                            readonly items: {
                                readonly type: "string";
                            };
                        };
                    };
                };
            };
        };
    };
}, {
    readonly name: "create_relations";
    readonly description: "Create multiple new causal relations between nodes in the knowledge graph";
    readonly inputSchema: {
        readonly type: "object";
        readonly required: readonly ["relations"];
        readonly properties: {
            readonly relations: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly required: readonly ["from", "to", "relationType"];
                    readonly properties: {
                        readonly from: {
                            readonly type: "string";
                        };
                        readonly to: {
                            readonly type: "string";
                        };
                        readonly relationType: {
                            readonly type: "string";
                        };
                    };
                };
            };
        };
    };
}, {
    readonly name: "add_observations";
    readonly description: "Add new invariants, actions, or context observations to existing causal rules";
    readonly inputSchema: {
        readonly type: "object";
        readonly required: readonly ["observations"];
        readonly properties: {
            readonly observations: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly required: readonly ["entityName", "contents"];
                    readonly properties: {
                        readonly entityName: {
                            readonly type: "string";
                        };
                        readonly contents: {
                            readonly type: "array";
                            readonly items: {
                                readonly type: "string";
                            };
                        };
                    };
                };
            };
        };
    };
}, {
    readonly name: "delete_entities";
    readonly description: "Delete multiple entities/rules and their associated causal relations";
    readonly inputSchema: {
        readonly type: "object";
        readonly required: readonly ["entityNames"];
        readonly properties: {
            readonly entityNames: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
            };
        };
    };
}, {
    readonly name: "delete_observations";
    readonly description: "Delete specific observations from entities/rules in the causal memory";
    readonly inputSchema: {
        readonly type: "object";
        readonly required: readonly ["deletions"];
        readonly properties: {
            readonly deletions: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly required: readonly ["entityName", "observations"];
                    readonly properties: {
                        readonly entityName: {
                            readonly type: "string";
                        };
                        readonly observations: {
                            readonly type: "array";
                            readonly items: {
                                readonly type: "string";
                            };
                        };
                    };
                };
            };
        };
    };
}, {
    readonly name: "delete_relations";
    readonly description: "Delete multiple causal relations from the knowledge graph";
    readonly inputSchema: {
        readonly type: "object";
        readonly required: readonly ["relations"];
        readonly properties: {
            readonly relations: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly required: readonly ["from", "to", "relationType"];
                    readonly properties: {
                        readonly from: {
                            readonly type: "string";
                        };
                        readonly to: {
                            readonly type: "string";
                        };
                        readonly relationType: {
                            readonly type: "string";
                        };
                    };
                };
            };
        };
    };
}];
/**
 * MCP JSON-RPC 2.0 요청 통합 처리기 (HTTP 데몬 및 Stdio 서버 공용)
 */
export declare function handleMcpJsonRpcRequest(rpc: JsonRpcRequest, store: CausalMemoryStore, dbPath?: string): Promise<Record<string, any> | null>;
/**
 * 인과율 메모리 독립 로컬 서버 (Causal Memory HTTP & MCP Daemon)
 */
export declare function startCausalServer(options?: ServerOptions): Bun.Server<undefined>;
/**
 * MCP 표준 입출력(stdio) 서버 모드
 * Antigravity / Claude Code 등의 MCP 호스트가 프로세스를 직접 스폰하여 통신할 때 동작합니다.
 * 로컬 데몬(4242 포트)이 실행 중이면 데몬으로 프록시하고, 꺼져 있으면 인메모리 스토어로 즉시 응답합니다.
 */
export declare function startCausalMcpStdioServer(dbPath?: string): Promise<void>;
