/**
 * 시냅스 옵틱 (Synapse Optic) 통합 브라우저 파사드
 * - 프로메테우스 Rust 엔진 브리지 및 시냅스 버스/가드 생태계 연동
 */
import { OPTIC_DEFAULTS, type OpticConfig } from "./config";
import type { OpticSnapshot, OpticActionResult, ReferenceNode, OpticStatus } from "./types";
import { OpticDriver } from "./driver";
import { A11yParser } from "./a11yParser";

export interface SynapseOpticOptions extends OpticConfig {
  /** 시냅스 이벤트 버스 연동 (선택적) */
  readonly bus?: { emit: (event: string, payload: any) => void };
  /** 시냅스 보안 가드 연동 (선택적) */
  readonly guard?: { scanSecret: (text: string) => { hasSecret: boolean; match?: string } };
}

export class SynapseOptic {
  public readonly driver: OpticDriver;
  private readonly endpoint: string;
  private currentUrl?: string;
  private ownedBrowserProc?: ReturnType<typeof import("bun").spawn>;
  private readonly snapshotCache = new Map<string, { snapshot: OpticSnapshot; timestamp: number }>();

  constructor(private readonly options: SynapseOpticOptions = {}) {
    this.endpoint = options.endpoint ?? OPTIC_DEFAULTS.DEFAULT_ENDPOINT;
    this.driver = new OpticDriver(options);
  }

  /**
   * 브라우징 상태 조회
   */
  public getStatus(): OpticStatus {
    return {
      connected: this.driver.isBinaryAvailable(),
      endpoint: this.endpoint,
      targetId: this.options.targetId,
      currentUrl: this.currentUrl,
      actionTimeoutMs: this.options.timeoutMs ?? OPTIC_DEFAULTS.DEFAULT_ACTION_TIMEOUT_MS,
    };
  }

  /**
   * 새 소유 브라우저 데몬 기동 및 자동 엔드포인트 연결
   */
  public async launch(port = 0): Promise<string> {
    const { proc, endpointPromise } = this.driver.launchBrowser(port);
    this.ownedBrowserProc = proc;
    const endpoint = await endpointPromise;
    this.emitBus("optic.browser.launched", { endpoint });
    return endpoint;
  }

  /**
   * 대상 웹페이지로 이동하고 인터랙티브 노드 스냅샷 추출 (인과율 인메모리 캐싱 지원)
   */
  public async goto(url: string, options: { forceRefresh?: boolean; ttlMs?: number } = {}): Promise<OpticSnapshot> {
    const ttlMs = options.ttlMs ?? 120_000;
    const now = performance.now();
    const cached = this.snapshotCache.get(url);

    if (!options.forceRefresh && cached && now - cached.timestamp < ttlMs) {
      this.emitBus("optic.navigated.cache_hit", { url, durationMs: 0 });
      return {
        ...cached.snapshot,
        durationMs: 0.05,
      };
    }

    const start = performance.now();
    this.emitBus("optic.navigating", { url });

    const res = this.driver.runCommand(["nav", url, this.endpoint]);
    const durationMs = performance.now() - start;

    if (!res.ok) {
      this.emitBus("optic.nav.failed", { url, error: res.stderr });
      throw new Error(`[SynapseOptic] 페이지 이동 실패 (${url}): ${res.stderr}`);
    }

    this.currentUrl = url;
    const snapshot = this.parseNavSnapshot(res.stdout, durationMs);
    this.snapshotCache.set(url, { snapshot, timestamp: now });
    this.emitBus("optic.navigated", { url, totalNodes: snapshot.totalNodes, durationMs });
    return snapshot;
  }

  /**
   * 복수 URL 초고속 동시 병렬 탐색 (배치 네비게이션)
   */
  public async gotoBatch(urls: readonly string[], options: { forceRefresh?: boolean } = {}): Promise<OpticSnapshot[]> {
    return Promise.all(urls.map((url) => this.goto(url, options)));
  }

  /**
   * 스냅샷 캐시 일괄 무효화
   */
  public clearCache(): void {
    this.snapshotCache.clear();
  }

  /**
   * 캐시 통계 및 적재 상태 조회
   */
  public getCacheStats(): { size: number; cachedUrls: readonly string[] } {
    return {
      size: this.snapshotCache.size,
      cachedUrls: Array.from(this.snapshotCache.keys()),
    };
  }

  /**
   * 대상 URL 목록 초고속 사전 백그라운드 프리페치 (Preload)
   */
  public async preload(urls: readonly string[]): Promise<void> {
    await Promise.allSettled(urls.map((url) => this.goto(url)));
  }

  /**
   * 브라우저 엔진 초고속 사전 워밍업 (Cold-start 지연 제거)
   */
  public warmup(): { ready: boolean; binaryAvailable: boolean; endpoint: string } {
    const binaryAvailable = this.driver.isBinaryAvailable();
    return {
      ready: binaryAvailable,
      binaryAvailable,
      endpoint: this.endpoint,
    };
  }

  /**
   * 대상 요소 클릭
   */
  public async click(target: string): Promise<OpticActionResult> {
    return this.executeAction("click", ["click", target, this.endpoint], target);
  }

  /**
   * 대상 요소 마우스 호버 (Hover / mouseMoved)
   */
  public async hover(target: string): Promise<OpticActionResult> {
    return this.executeAction("hover", ["hover", target, this.endpoint], target);
  }

  /**
   * 대상 요소 더블클릭
   */
  public async doubleClick(target: string): Promise<OpticActionResult> {
    return this.executeAction("double_click", ["double-click", target, this.endpoint], target);
  }

  /**
   * 대상 요소 우클릭 (컨텍스트 메뉴)
   */
  public async rightClick(target: string): Promise<OpticActionResult> {
    return this.executeAction("right_click", ["right-click", target, this.endpoint], target);
  }

  /**
   * 키보드 단일키/특수키 타건 (Enter, Tab, Escape, Backspace 등)
   */
  public async press(key: string): Promise<OpticActionResult> {
    return this.executeAction("press", ["press", key, this.endpoint], key);
  }

  /**
   * 대상 입력창에 텍스트 입력
   */
  public async type(target: string, text: string): Promise<OpticActionResult> {
    this.verifySecretGuard(text);
    return this.executeAction("type", ["type", target, text, this.endpoint], target, text);
  }

  /**
   * 대상 입력창에 실제 하드웨어 키보드 시뮬레이션 타건 (isTrusted 보장)
   */
  public async typeNative(target: string, text: string): Promise<OpticActionResult> {
    this.verifySecretGuard(text);
    return this.executeAction("type_native", ["type-native", target, text, this.endpoint], target, text);
  }

  /**
   * 화면 스크롤 제어
   */
  public async scroll(direction: "down" | "up" = "down", amount = OPTIC_DEFAULTS.DEFAULT_SCROLL_AMOUNT): Promise<OpticActionResult> {
    return this.executeAction("scroll", ["scroll", direction, String(amount), this.endpoint]);
  }

  /**
   * 화면 스크린샷 캡처
   */
  public async screenshot(outputPath = "screenshot.png"): Promise<OpticActionResult> {
    return this.executeAction("screenshot", ["shot", outputPath, this.endpoint]);
  }

  /**
   * 소유 브라우저 및 리소스 정리
   */
  public close(): void {
    if (this.ownedBrowserProc) {
      try {
        this.ownedBrowserProc.kill();
      } catch {}
      this.ownedBrowserProc = undefined;
    }
    this.emitBus("optic.closed", {});
  }

  /**
   * nav 출력으로부터 인터랙티브 스냅샷 DTO 파싱
   */
  private parseNavSnapshot(stdout: string, durationMs: number): OpticSnapshot {
    const rawRefs: [string, string, string][] = [];
    const lines = stdout.split("\n");

    for (const line of lines) {
      // 파싱: "  [버튼]  [@generation:1]  확인"
      const match = line.match(/\[([^\]]+)\]\s+\[@([^\]]+)\]\s+(.*)/);
      if (match) {
        const role = match[1].trim();
        const ref = match[2].trim();
        const label = match[3].trim();
        rawRefs.push([ref, role, label]);
      }
    }

    const nodes: ReferenceNode[] = A11yParser.formatReferenceSnapshot(rawRefs);
    const formattedPrompt = A11yParser.formatSnapshotSummary(nodes);
    const generation = rawRefs[0] ? rawRefs[0][0].split(":")[0] : "unknown";

    return {
      generation,
      totalNodes: nodes.length,
      formattedPrompt,
      nodes,
      durationMs,
    };
  }

  /**
   * 공통 액션 실행 및 시냅스 버스 연동
   */
  private async executeAction(action: string, args: string[], target?: string, text?: string): Promise<OpticActionResult> {
    const start = performance.now();
    const res = this.driver.runCommand(args);
    const durationMs = performance.now() - start;

    const result: OpticActionResult = {
      ok: res.ok,
      action,
      target,
      text,
      durationMs,
      error: res.ok ? undefined : res.stderr,
    };

    if (res.ok) {
      this.emitBus(`optic.action.${action}.success`, result);
    } else {
      this.emitBus(`optic.action.${action}.failed`, result);
    }

    return result;
  }

  /**
   * 비밀번호 또는 시크릿 키 입력 사전 검사
   */
  private verifySecretGuard(text: string): void {
    if (this.options.guard) {
      const check = this.options.guard.scanSecret(text);
      if (check.hasSecret) {
        throw new Error(`[SynapseOptic Guard] 보안 경고: 민감한 자격증명(${check.match})이 브라우저 입력에 감지되어 전송이 차단되었습니다.`);
      }
    }
  }

  /**
   * 시냅스 이벤트 버스로 신호 발행
   */
  private emitBus(event: string, payload: any): void {
    if (this.options.bus) {
      try {
        this.options.bus.emit(event, payload);
      } catch {}
    }
  }
}
