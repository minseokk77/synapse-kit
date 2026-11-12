/**
 * 시냅스 옵틱 하이브리드 적응형 라우터 (Adaptive Hybrid Router)
 * - 0ms Fast-Path (인메모리 DOM Ready / 텍스트 인과 파서)
 * - Deep-Inspect (CDP WebSocket 연결 기반 대화형 라이브 브라우저)
 * 두 실행 모드 간의 지능형 자동 라우팅 및 폴백(Fallback) 보장
 */
import { OPTIC_HYBRID_DEFAULTS, type OpticConfig } from "./config";
import type { OpticSnapshot } from "./types";
import { SynapseOptic } from "./optic";
import { CausalPaperAnalyzer } from "./causalPaperAnalyzer";

export type ExecutionMode = "fast_path" | "deep_inspect" | "auto";

export interface HybridExecutionResult {
  readonly modeUsed: ExecutionMode;
  readonly durationMs: number;
  readonly snapshot?: OpticSnapshot;
  readonly resonanceData?: any;
  readonly fallbackOccurred: boolean;
  readonly ok: boolean;
  readonly error?: string;
}

export class OpticHybridRouter {
  private readonly optic: SynapseOptic;
  private readonly analyzer: CausalPaperAnalyzer;

  constructor(config: OpticConfig = {}) {
    this.optic = new SynapseOptic(config);
    this.analyzer = new CausalPaperAnalyzer();
    this.analyzer.initializeKnowledgeGraph();
  }

  /**
   * 대상 URL 또는 텍스트의 특성에 따라 최적의 실행 모드 판별
   */
  public determineMode(target: string, preferredMode: ExecutionMode = "auto"): ExecutionMode {
    if (preferredMode !== "auto") return preferredMode;

    const lower = target.toLowerCase();
    // 학술 사이트, 정적 문서, PDF, 텍스트 블록은 초고속 Fast-Path 적용
    const matchesPattern = OPTIC_HYBRID_DEFAULTS.FAST_PATH_PATTERNS.some((pattern) =>
      lower.includes(pattern)
    );

    if (matchesPattern || target.length > OPTIC_HYBRID_DEFAULTS.TEXT_PAYLOAD_THRESHOLD) {
      return "fast_path";
    }

    // 그 외 일반 웹 URL은 Deep-Inspect 시도
    return "deep_inspect";
  }

  /**
   * 적응형 페이지 탐색 및 스냅샷/인과 분석 실행
   */
  public async navigateAdaptive(
    target: string,
    mode: ExecutionMode = "auto"
  ): Promise<HybridExecutionResult> {
    const startTime = performance.now();
    const resolvedMode = this.determineMode(target, mode);

    // 1. Fast-Path 모드 실행
    if (resolvedMode === "fast_path") {
      try {
        const resonance = this.analyzer.analyze(target);
        return {
          modeUsed: "fast_path",
          durationMs: Number((performance.now() - startTime).toFixed(2)),
          resonanceData: resonance,
          fallbackOccurred: false,
          ok: true,
        };
      } catch (err: any) {
        // Fast-path 실패 시 Deep-Inspect로 폴백
        return this.executeDeepInspect(target, startTime, true);
      }
    }

    // 2. Deep-Inspect 모드 실행 (실패 시 Fast-Path 자동 폴백)
    return this.executeDeepInspect(target, startTime, false);
  }

  /**
   * Deep-Inspect 실행 및 Fast-Path 자동 폴백 안전망
   */
  private async executeDeepInspect(
    target: string,
    startTime: number,
    wasFallback: boolean
  ): Promise<HybridExecutionResult> {
    try {
      const snap = await this.optic.goto(target);
      return {
        modeUsed: "deep_inspect",
        durationMs: Number((performance.now() - startTime).toFixed(2)),
        snapshot: snap,
        fallbackOccurred: wasFallback,
        ok: true,
      };
    } catch (deepInspectErr: any) {
      // 라이브 브라우저 미기동 시 Fast-Path 인과 엔진으로 무중단 자동 폴백!
      try {
        const resonance = this.analyzer.analyze(target);
        return {
          modeUsed: "fast_path",
          durationMs: Number((performance.now() - startTime).toFixed(2)),
          resonanceData: resonance,
          fallbackOccurred: true,
          ok: true,
        };
      } catch (fallbackErr: any) {
        return {
          modeUsed: "deep_inspect",
          durationMs: Number((performance.now() - startTime).toFixed(2)),
          fallbackOccurred: true,
          ok: false,
          error: `Deep-Inspect 및 폴백 모두 실패: ${deepInspectErr?.message || deepInspectErr}`,
        };
      }
    }
  }
}
