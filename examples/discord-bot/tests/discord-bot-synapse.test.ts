/**
 * 시냅스 3.0 대통합 디스코드 봇 실전 E2E 종합 검증 스위트
 * (Synapse 3.0 Real-World Discord Bot Comprehensive Verification)
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { existsSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { SynapseDiscordBot } from "../src/botEngine";
import type { ChzzkLiveEvent } from "../src/config";

const TEST_BOT_VAULT_PRIMARY = join(import.meta.dir, ".test_bot_primary");
const TEST_BOT_VAULT_BACKUP = join(import.meta.dir, ".test_bot_backup");

describe("🤖 Synapse 3.0 기반 디스코드 봇 (치지직 알림 & 자가치유) 실전 검증", () => {
  let botPrimary: SynapseDiscordBot;
  let botBackup: SynapseDiscordBot;

  beforeEach(async () => {
    if (existsSync(TEST_BOT_VAULT_PRIMARY)) rmSync(TEST_BOT_VAULT_PRIMARY, { recursive: true, force: true });
    if (existsSync(TEST_BOT_VAULT_BACKUP)) rmSync(TEST_BOT_VAULT_BACKUP, { recursive: true, force: true });
    mkdirSync(TEST_BOT_VAULT_PRIMARY, { recursive: true });
    mkdirSync(TEST_BOT_VAULT_BACKUP, { recursive: true });

    botPrimary = new SynapseDiscordBot({
      vaultDir: TEST_BOT_VAULT_PRIMARY,
      nodeId: "oracle-cloud-primary",
      meshPort: 4545,
    });
    botBackup = new SynapseDiscordBot({
      vaultDir: TEST_BOT_VAULT_BACKUP,
      nodeId: "local-pc-backup",
      meshPort: 4546,
    });

    await botPrimary.init();
    await botBackup.init();
  });

  afterEach(() => {
    botPrimary.close();
    botBackup.close();
    if (existsSync(TEST_BOT_VAULT_PRIMARY)) rmSync(TEST_BOT_VAULT_PRIMARY, { recursive: true, force: true });
    if (existsSync(TEST_BOT_VAULT_BACKUP)) rmSync(TEST_BOT_VAULT_BACKUP, { recursive: true, force: true });
  });

  it("1. [길드 등록 & 마크다운 볼트 생성] 위키링크 자동 연결 및 사람이 읽는 마크다운 저장", async () => {
    await botPrimary.registerGuild({
      guildId: "guild_1001",
      guildName: "프로그래머들의 숲",
      alertChannelId: "ch_general",
      streamers: ["chzzk_alpha", "chzzk_beta"],
    });

    // 1) 디스크 상에 실제 사람이 읽을 수 있는 .md 파일 생성 확인
    const mdPath = join(TEST_BOT_VAULT_PRIMARY, "guilds", "guild_1001.md");
    expect(existsSync(mdPath)).toBe(true);

    const rawMd = readFileSync(mdPath, "utf-8");
    expect(rawMd).toContain("# 프로그래머들의 숲");
    expect(rawMd).toContain("[[channels/ch_general]]");
    expect(rawMd).toContain("[[streamers/chzzk_alpha]]");

    // 2) 인메모리 커넥톰에서 한국어 전문 검색 검증
    const searchRes = botPrimary.db.engine.connectome.search("프로그래머");
    expect(searchRes.length).toBe(1);
    expect(searchRes[0].document.id).toBe("guild_1001");
  });

  it("2. [치지직 방송 시작 ➔ 0.3µs 버스 ➔ 알림 자동 발송] 실시간 알림 파이프라인 검증", async () => {
    await botPrimary.registerGuild({
      guildId: "guild_gaming",
      guildName: "게임 종합 서버",
      alertChannelId: "ch_alerts",
      streamers: ["streamer_pro"],
      alertTemplate: "🎮 **{streamerName}** 님 ON AIR! [{liveTitle}] ({liveUrl})",
    });

    const liveEvent: ChzzkLiveEvent = {
      streamerId: "streamer_pro",
      streamerName: "프로게이머A",
      liveTitle: "시즌 1위 달성 도전 방송",
      category: "오버워치",
      liveUrl: "https://chzzk.naver.com/live/streamer_pro",
      startedAtMs: Date.now(),
    };

    // 버스에 치지직 방송 시작 이벤트 발행 (0.3µs 초저지연)
    botPrimary.bus.emit("chzzk.stream.live", liveEvent);

    // 알림 디스패치 검증
    await new Promise((resolve) => setTimeout(resolve, 50));
    const alerts = botPrimary.getDispatchedAlerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0].guildId).toBe("guild_gaming");
    expect(alerts[0].message).toContain("프로게이머A");
    expect(alerts[0].message).toContain("시즌 1위 달성 도전 방송");
  });

  it("3. [악성 XSS 및 인젝션 방어] 길드 설정 내 악성 <script> 자동 새니타이징", async () => {
    await botPrimary.registerGuild({
      guildId: "guild_hacker",
      guildName: "악성 공격 테스트 서버<script>alert(1)</script>",
      alertChannelId: "ch_test",
      streamers: ["streamer_x"],
      alertTemplate: "알림<img src=x onerror=alert('hack')> {liveTitle}",
    });

    const mdPath = join(TEST_BOT_VAULT_PRIMARY, "guilds", "guild_hacker.md");
    const rawMd = readFileSync(mdPath, "utf-8");
    expect(rawMd).not.toContain("<script>");
    expect(rawMd).not.toContain("onerror=");
  });

  it("4. [디스코드 봇 토큰 유출 원천 차단] Secret Shield 토큰 유출 감지", () => {
    const dummyDiscordToken = ["MTIzNDU2Nzg5MDEyMzQ1Njc4", "Ga12bC", "123456789012345678901234567"].join(".");
    const leakedConfigCode = `
      export const botConfig = {
        token: "${dummyDiscordToken}",
      };
    `;

    expect(() => botPrimary.guard.assertClean(leakedConfigCode, "botConfig.ts")).toThrow();
  });

  it("5. [커스텀 필터링 스크립트 격리 & 무한루프 가드] 마이크로 샌드박스 안전 실행", () => {
    // 1) 정상 필터링: 특정 카테고리만 알림 허용
    const safeScript = `
      return input.category === "발로란트" || input.category === "오버워치";
    `;
    const check1 = botPrimary.executeCustomFilter(safeScript, { category: "발로란트" });
    expect(check1.ok).toBe(true);
    expect(check1.result).toBe(true);

    const check2 = botPrimary.executeCustomFilter(safeScript, { category: "메이플" });
    expect(check2.ok).toBe(true);
    expect(check2.result).toBe(false);

    // 2) 악성 무한 루프 스크립트 가드: 300ms 내 인터럽트 강제 차단
    const maliciousScript = `
      while(true) {}
    `;
    const check3 = botPrimary.executeCustomFilter(maliciousScript, {});
    expect(check3.ok).toBe(false);
    expect(check3.error).toContain("제한 시간 초과");
  });

  it("6. [시계열 시간여행 복원 (asOfLsn)] 길드 설정 실수 변경 시 과거 LSN 100% 무손실 롤백", async () => {
    // LSN 1: 최초 v1.0 등록
    await botPrimary.registerGuild({
      guildId: "guild_vip",
      guildName: "VIP 서버 v1.0",
      alertChannelId: "ch_vip_primary",
      streamers: ["star_1"],
    });
    const lsnAtV1 = botPrimary.db.walStats().ringBuffer.currentLsn;

    // LSN 2: 실수로 설정이 변조됨
    await botPrimary.registerGuild({
      guildId: "guild_vip",
      guildName: "망가진 서버 설정",
      alertChannelId: "ch_wrong",
      streamers: [],
    });

    const currentDoc = botPrimary.db.collection("guilds").get("guild_vip");
    expect(currentDoc?.data.guildName).toBe("망가진 서버 설정");

    // 과거 LSN 1 시점으로 시간 여행 (asOfLsn)
    const restored = botPrimary.restoreGuildAsOfLsn(lsnAtV1, "guild_vip");
    expect(restored).not.toBeNull();
    expect(restored?.guildName).toBe("VIP 서버 v1.0");
    expect(restored?.alertChannelId).toBe("ch_vip_primary");
    expect(restored?.streamers).toContain("star_1");
  });

  it("7. [오라클 VM ↔ 로컬 노드 간 Mesh P2P 동기화] 분산 볼트 실시간 미러링 검증", async () => {
    // 오라클 노드(Primary)에서 신규 길드 등록
    await botPrimary.registerGuild({
      guildId: "guild_distributed",
      guildName: "분산 동기화 길드",
      alertChannelId: "ch_sync",
      streamers: ["streamer_oracle"],
    });

    // Mesh를 통해 Primary의 매니페스트를 Backup 노드로 가져와 미러링
    const primaryManifest = botPrimary.mesh.getLocalManifest();
    const delta = botBackup.mesh.diffManifest(primaryManifest);
    expect(delta.toPull).toContain("guilds/guild_distributed.md");

    for (const path of delta.toPull) {
      const content = botPrimary.mesh.vaultSync.readVaultFile(path);
      if (content !== null) {
        botBackup.mesh.vaultSync.writeVaultFile(path, content);
      }
    }

    // 백업 노드(내 PC)에 원자적 미러링 완료 확인
    const backupMdPath = join(TEST_BOT_VAULT_BACKUP, "guilds", "guild_distributed.md");
    expect(existsSync(backupMdPath)).toBe(true);

    const backupContent = botBackup.mesh.vaultSync.readVaultFile("guilds/guild_distributed.md");
    expect(backupContent).toContain("분산 동기화 길드");
  });
});
