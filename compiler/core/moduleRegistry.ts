/**
 * Synapse Hybrid Module Registry (하이브리드 모듈 레지스트리 & Feature-Gate)
 *
 * 1) Feature-Gate: 미사용 모듈은 import() 자체를 실행하지 않아 메모리/콜드스타트 0 비용 유지
 * 2) 듀얼 리졸버: 외부 독립 패키지(synapse-dci 등)가 설치되어 있으면 우선 로드, 없으면 10대 코어 내장 모듈로 자동 폴백
 * 3) 동적 MCP 노출: 활성화된 모듈에 속한 MCP 도구만 필터링해 프롬프트 토큰 절감
 */

export type SynapseModuleId =
  | "dci"
  | "codemap"
  | "tracer"
  | "sandbox-fs"
  | "policy"
  | "pulse"
  | "voice"
  | "ocr"
  | "ai-core";

export type SynapseProfileName = "minimal" | "coding" | "docs" | "ops" | "full";

export interface ModuleDescriptor {
  readonly id: SynapseModuleId;
  readonly externalPackage: string;
  readonly builtinFallbackPath: string;
  readonly mcpTools: readonly string[];
  readonly description: string;
}

export const MODULE_REGISTRY_CONFIG = {
  DEFAULT_PROFILE: "full" as SynapseProfileName,
  PROFILES: {
    minimal: [],
    coding: ["codemap", "sandbox-fs", "tracer"],
    docs: ["dci", "ocr", "voice", "ai-core"],
    ops: ["pulse", "tracer", "policy"],
    full: ["dci", "codemap", "tracer", "sandbox-fs", "policy", "pulse", "voice", "ocr", "ai-core"],
  } as const satisfies Record<SynapseProfileName, readonly SynapseModuleId[]>,
  DESCRIPTORS: {
    dci: {
      id: "dci",
      externalPackage: "synapse-dci",
      builtinFallbackPath: "../../db/dci",
      mcpTools: ["synapse_db_search", "synapse_dci_ingest", "synapse_dci_edit", "synapse_ai_search"],
      description: "Hybrid Causal Pull + 12종 문서 네이티브 인제스터(HWP/PDF/Office)",
    },
    codemap: {
      id: "codemap",
      externalPackage: "synapse-codemap",
      builtinFallbackPath: "./codemap",
      mcpTools: [],
      description: "AST-Lite 초압축 Repo-Map & PR Blast Radius",
    },
    tracer: {
      id: "tracer",
      externalPackage: "synapse-trace",
      builtinFallbackPath: "./tracer",
      mcpTools: [],
      description: "턴별 스팬·키프레임 리플레이·토큰 프로파일러",
    },
    "sandbox-fs": {
      id: "sandbox-fs",
      externalPackage: "synapse-sandbox-fs",
      builtinFallbackPath: "../../runtime/src/overlayFs",
      mcpTools: [],
      description: "가상 Copy-on-Write 오버레이 파일시스템",
    },
    policy: {
      id: "policy",
      externalPackage: "synapse-policy",
      builtinFallbackPath: "../../guard/src/policy",
      mcpTools: ["synapse_guard_audit"],
      description: "한국어 PII 비식별화 & HITL 승인 게이트",
    },
    pulse: {
      id: "pulse",
      externalPackage: "synapse-pulse",
      builtinFallbackPath: "../../bus/src/pulse",
      mcpTools: [],
      description: "0-토큰 이벤트 필터 & 조건부 AI 트리거",
    },
    voice: {
      id: "voice",
      externalPackage: "synapse-voice",
      builtinFallbackPath: "../../optic/src/voice",
      mcpTools: ["synapse_optic_survey"],
      description: "에너지 기반 VAD 무음 스킵 + 화자 분리 STT",
    },
    ocr: {
      id: "ocr",
      externalPackage: "synapse-ai-core",
      builtinFallbackPath: "../../optic/src/ocr",
      mcpTools: ["synapse_optic_survey"],
      description: "스캔 이미지 PDF 자동 판별 & OCR 폴백",
    },
    "ai-core": {
      id: "ai-core",
      externalPackage: "synapse-ai-core",
      builtinFallbackPath: "../../memory/ai-vector",
      mcpTools: ["synapse_causal_query"],
      description: "Int8 양자화 벡터 + Orchestrator + Evals + JSON Repair",
    },
  } as const satisfies Record<SynapseModuleId, ModuleDescriptor>,
} as const;

export interface ResolvedModule<T = Record<string, unknown>> {
  readonly id: SynapseModuleId;
  readonly source: "external" | "builtin";
  readonly specifier: string;
  readonly exports: T;
}

export class SynapseModuleRegistry {
  private readonly enabled = new Set<SynapseModuleId>();
  private readonly cache = new Map<SynapseModuleId, ResolvedModule<any>>();
  private readonly preferExternal: boolean;

  constructor(options?: {
    profile?: SynapseProfileName;
    enabledModules?: readonly SynapseModuleId[];
    preferExternal?: boolean;
  }) {
    this.preferExternal = options?.preferExternal ?? true;
    const profile = options?.profile ?? MODULE_REGISTRY_CONFIG.DEFAULT_PROFILE;
    this.applyProfile(profile);
    if (options?.enabledModules) {
      for (const m of options.enabledModules) this.enabled.add(m);
    }
  }

  public applyProfile(profile: SynapseProfileName): void {
    this.enabled.clear();
    for (const id of MODULE_REGISTRY_CONFIG.PROFILES[profile]) {
      this.enabled.add(id);
    }
  }

  public enable(id: SynapseModuleId): void {
    this.enabled.add(id);
  }

  public disable(id: SynapseModuleId): void {
    this.enabled.delete(id);
    this.cache.delete(id);
  }

  public isEnabled(id: SynapseModuleId): boolean {
    return this.enabled.has(id);
  }

  public listEnabled(): SynapseModuleId[] {
    return Array.from(this.enabled);
  }

  public listLoaded(): SynapseModuleId[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 듀얼 리졸버: 활성화된 모듈만 동적 import() — 외부 패키지 우선, 미설치 시 10대 코어 내장 폴백
   */
  public async load<T = Record<string, unknown>>(id: SynapseModuleId): Promise<ResolvedModule<T>> {
    if (!this.enabled.has(id)) {
      throw new Error(
        `[SynapseModuleRegistry] 비활성화된 모듈입니다: '${id}'. 사용 전 enable('${id}') 또는 프로파일을 변경하세요.`
      );
    }

    const cached = this.cache.get(id);
    if (cached) return cached as ResolvedModule<T>;

    const desc = MODULE_REGISTRY_CONFIG.DESCRIPTORS[id];
    if (this.preferExternal) {
      try {
        const extMod = (await import(desc.externalPackage)) as T;
        const resolved: ResolvedModule<T> = {
          id,
          source: "external",
          specifier: desc.externalPackage,
          exports: extMod,
        };
        this.cache.set(id, resolved);
        return resolved;
      } catch {
        // 외부 독립 패키지가 없으면 10대 코어 내장 모듈로 자동 폴백
      }
    }

    try {
      const builtinMod = (await import(desc.builtinFallbackPath)) as T;
      const resolved: ResolvedModule<T> = {
        id,
        source: "builtin",
        specifier: desc.builtinFallbackPath,
        exports: builtinMod,
      };
      this.cache.set(id, resolved);
      return resolved;
    } catch {
      // 단일 파일 번들(dist/index.js) 환경에서 내부 서브모듈(./codemap, ./tracer)은 번들 엔트리에서 해결
      const bundleSelfMod = (await import(new URL("./index.js", import.meta.url).href)) as T;
      const resolved: ResolvedModule<T> = {
        id,
        source: "builtin",
        specifier: "compiler/dist/index.js",
        exports: bundleSelfMod,
      };
      this.cache.set(id, resolved);
      return resolved;
    }
  }

  /**
   * 현재 활성화된 모듈에 따라 노출할 MCP 도구 목록 동적 필터링
   */
  public filterMcpTools<TTool extends { name: string }>(
    allTools: readonly TTool[],
    alwaysInclude: readonly string[] = ["synapse_verifier_check"]
  ): TTool[] {
    const allowed = new Set<string>(alwaysInclude);
    for (const id of this.enabled) {
      for (const toolName of MODULE_REGISTRY_CONFIG.DESCRIPTORS[id].mcpTools) {
        allowed.add(toolName);
      }
    }
    return allTools.filter((t) => allowed.has(t.name));
  }
}
