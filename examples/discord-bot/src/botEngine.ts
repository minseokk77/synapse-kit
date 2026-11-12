/**
 * 시냅스 3.0 대통합 디스코드 봇 코어 엔진 (Synapse Discord Bot Core Engine)
 * - DB (마크다운 볼트 & Causal-WAL) + Bus (초저지연 이벤트) + Guard (보안 방화벽)
 * - Mesh (오라클 VM ↔ 로컬 볼트 P2P 동기화) + Runtime (커스텀 명령어 샌드박스)
 */
import {
  SynapseDB,
  SynapseBus,
  SynapseGuard,
  SynapseMesh,
  SynapseRuntime,
  HotSwapManager,
} from "../../../index";
import {
  BOT_DEFAULTS,
  type DiscordBotConfig,
  type GuildAlertConfig,
  type ChzzkLiveEvent,
} from "./config";

export class SynapseDiscordBot {
  public readonly db: SynapseDB;
  public readonly bus: SynapseBus;
  public readonly guard: SynapseGuard;
  public readonly mesh: SynapseMesh;
  public readonly runtime: SynapseRuntime;
  public readonly hotSwap: HotSwapManager;

  private isRunning = false;
  private readonly dispatchedAlerts: { guildId: string; message: string; timestampMs: number }[] = [];

  constructor(public readonly config: DiscordBotConfig) {
    this.db = new SynapseDB({
      vaultDir: config.vaultDir,
      autoWatch: false,
      wal: { ringCapacity: 2048 },
    });
    this.bus = new SynapseBus({ ringCapacity: 4096 });
    this.guard = new SynapseGuard();
    this.mesh = new SynapseMesh(config.vaultDir, {
      nodeId: config.nodeId || "discord-bot-node",
      port: config.meshPort,
    });
    this.runtime = new SynapseRuntime({ timeoutMs: BOT_DEFAULTS.SANDBOX_TIMEOUT_MS });
    this.hotSwap = new HotSwapManager();

    this.registerBusListeners();
  }

  /**
   * 봇 초기화 및 볼트 준비
   */
  public async init(): Promise<void> {
    if (this.isRunning) return;
    await this.db.init();
    await this.mesh.start();
    this.isRunning = true;
  }

  /**
   * 버스 이벤트 리스너 등록
   */
  private registerBusListeners(): void {
    // 치지직 방송 시작 이벤트 수신 시 등록된 모든 길드에 알림 디스패치
    this.bus.on<ChzzkLiveEvent>("chzzk.stream.live", async (event) => {
      await this.handleChzzkLive(event.payload);
    });
  }

  /**
   * 길드 객체 내 악성 스크립트 및 인라인 이벤트 정화 (Frontmatter XSS 방어)
   */
  private sanitizeGuildData(guild: GuildAlertConfig): GuildAlertConfig {
    const cleanName = this.guard.sanitizer.sanitizeMarkdown(guild.guildName).cleanContent;
    const cleanTemplate = guild.alertTemplate
      ? this.guard.sanitizer.sanitizeMarkdown(guild.alertTemplate).cleanContent
      : undefined;

    return {
      ...guild,
      guildName: cleanName,
      alertTemplate: cleanTemplate,
    };
  }

  /**
   * 길드 설정 등록 또는 수정 (마크다운 볼트 영속화 & 위키링크 자동 연결)
   */
  public async registerGuild(guild: GuildAlertConfig): Promise<void> {
    const guildsCol = this.db.collection<GuildAlertConfig>("guilds");
    const sanitizedGuild = this.sanitizeGuildData(guild);

    // 위키링크 형태로 스트리머 의존성 명시 (커넥톰 그래프 형성)
    const streamerLinks = sanitizedGuild.streamers
      .map((s) => `[[streamers/${s}]]`)
      .join(", ");

    const body = `# ${sanitizedGuild.guildName} (${sanitizedGuild.guildId})\n알림 채널: [[channels/${sanitizedGuild.alertChannelId}]]\n구독 스트리머: ${streamerLinks}`;

    // 보안 방화벽으로 본문 내 악성 태그 사전 정화
    const { cleanContent } = this.guard.auditAndSanitizeVault(body, `guilds/${sanitizedGuild.guildId}.md`);

    await guildsCol.save({
      id: sanitizedGuild.guildId,
      data: sanitizedGuild,
      body: cleanContent,
    });

    this.db.engine.flushPendingWrites();
  }

  /**
   * 치지직 방송 시작 이벤트 처리 및 알림 생성
   */
  public async handleChzzkLive(event: ChzzkLiveEvent): Promise<number> {
    const guildsCol = this.db.collection<GuildAlertConfig>("guilds");
    const allGuilds = guildsCol.query();
    let sentCount = 0;

    for (const guildDoc of allGuilds) {
      const guild = guildDoc.data;
      if (guild.streamers.includes(event.streamerId)) {
        const template = guild.alertTemplate || BOT_DEFAULTS.DEFAULT_TEMPLATE;
        const alertMsg = template
          .replace("{streamerName}", event.streamerName)
          .replace("{liveTitle}", event.liveTitle)
          .replace("{liveUrl}", event.liveUrl);

        // 악성 XSS/인젝션 방지
        const { cleanContent } = this.guard.auditAndSanitizeVault(alertMsg);

        this.dispatchedAlerts.push({
          guildId: guild.guildId,
          message: cleanContent,
          timestampMs: Date.now(),
        });

        // Causal-WAL 및 버스 이벤트 발행
        this.bus.emit("discord.alert.dispatched", {
          guildId: guild.guildId,
          channelId: guild.alertChannelId,
          message: cleanContent,
        });

        sentCount++;
      }
    }

    return sentCount;
  }

  /**
   * 관리자 커스텀 스크립트 격리 실행 (마이크로 샌드박스 VM)
   */
  public executeCustomFilter(
    script: string,
    eventData: any
  ): { ok: boolean; result?: any; error?: string } {
    // 1. Verifier 관점의 보안 검증 (eval, process 차단)
    const audit = this.guard.auditSource(script, "customFilter.js");
    if (!audit.ok) {
      return { ok: false, error: audit.violations[0].description };
    }

    // 2. 샌드박스 격리 실행
    const res = this.runtime.runFunction(script, eventData);
    return {
      ok: res.ok,
      result: res.result,
      error: res.error,
    };
  }

  /**
   * 과거 시점 길드 설정 무손실 시간여행 복원 (Time-Travel)
   */
  public restoreGuildAsOfLsn(targetLsn: number, guildId: string): GuildAlertConfig | null {
    const pastConnectome = this.db.asOfLsn(targetLsn);
    const doc = pastConnectome.getDocument<GuildAlertConfig>("guilds", guildId);
    return doc?.data ?? null;
  }

  /**
   * 발송된 알림 목록 반환
   */
  public getDispatchedAlerts(): readonly { guildId: string; message: string; timestampMs: number }[] {
    return this.dispatchedAlerts;
  }

  /**
   * 봇 안전 종료
   */
  public close(): void {
    this.isRunning = false;
    this.db.close();
    this.bus.close();
    this.mesh.close();
    this.hotSwap.close();
  }
}
