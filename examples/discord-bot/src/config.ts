/**
 * 시냅스 3.0 기반 디스코드 봇 전역 설정 및 기본 상수 (Synapse Discord Bot Configuration)
 */

export interface GuildAlertConfig {
  /** 길드(서버) 식별자 */
  readonly guildId: string;
  /** 길드 명칭 */
  readonly guildName: string;
  /** 치지직 알림 전송 대상 채널 ID */
  readonly alertChannelId: string;
  /** 구독 중인 스트리머 채널 ID 목록 */
  readonly streamers: readonly string[];
  /** 커스텀 알림 템플릿 */
  readonly alertTemplate?: string;
}

export interface ChzzkLiveEvent {
  readonly streamerId: string;
  readonly streamerName: string;
  readonly liveTitle: string;
  readonly category: string;
  readonly liveUrl: string;
  readonly startedAtMs: number;
}

export interface DiscordBotConfig {
  /** 마크다운 볼트 저장 경로 (예: "vault/discord_bot") */
  readonly vaultDir: string;
  /** 봇 인스턴스 노드 ID (예: "oracle-vm" 또는 "local-backup") */
  readonly nodeId?: string;
  /** 분산 메쉬 동기화 포트 (기본: 4343) */
  readonly meshPort?: number;
}

export const BOT_DEFAULTS = {
  VAULT_DIR: "data/discord_bot_vault",
  DEFAULT_TEMPLATE: "📢 **{streamerName}** 님이 치지직 방송을 시작했습니다!\n**{liveTitle}**\n링크: {liveUrl}",
  SANDBOX_TIMEOUT_MS: 300,
} as const;
