import { describe, expect, it } from "bun:test";
import { SynapseConnectome } from "synapse-db";
import { ingestVoiceSession } from "../index";

describe("🎙️ Synapse-Voice 검증", () => {
  it("1. 에너지 기반 VAD 무음 스킵 + 화자 분리 STT + Connectome 위키링크 적재", async () => {
    const connectome = new SynapseConnectome();
    const silence = new Float32Array(1600).fill(0.0001);
    const speech = new Float32Array(1600).fill(0.25);

    const res = await ingestVoiceSession(
      connectome,
      [
        { chunkId: "c1", pcmSamples: silence },
        { chunkId: "c2", pcmSamples: silence },
        { chunkId: "c3", pcmSamples: speech },
      ],
      {
        sessionId: "weekly-sync-01",
        collection: "meetings",
        sttEngine: async () => [
          {
            speaker: "김팀장",
            startSec: 0.0,
            endSec: 4.5,
            text: "예산 세부안은 별표 1과 [[meetings/budget-doc]] 참고하세요.",
          },
        ],
      }
    );

    expect(res.silenceSkippedChunks).toBe(2);
    expect(res.activeSpeechChunks).toBe(1);
    expect(res.segmentsCount).toBe(1);
    expect(res.document?.body).toContain("**김팀장**");
    expect(res.document?.wikilinks.map((w) => w.targetId)).toContain("별표-1");
    expect(res.document?.wikilinks.map((w) => w.targetId)).toContain("budget-doc");
  });
});
