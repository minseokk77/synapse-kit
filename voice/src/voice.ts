/**
 * Synapse-Voice: 에너지 기반 무음 구간(VAD) 제거 · 화자 분리 STT 브릿지 · Connectome 자동 적재
 */
import { SynapseConnectome, type SynapseDocument } from "synapse-db";
import { parseAnyDocumentBuffer } from "synapse-dci";

export const VOICE_CONFIG = {
  DEFAULT_VAD_RMS_THRESHOLD: 0.02,
  DEFAULT_COLLECTION: "meetings",
} as const;

export interface AudioChunkInput {
  readonly chunkId: string;
  readonly pcmSamples: Float32Array;
  readonly sampleRateHz?: number;
}

export interface UtteranceSegment {
  readonly speaker: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly text: string;
}

export type SttDiarizeFn = (samples: Float32Array, sampleRateHz: number) => Promise<UtteranceSegment[]> | UtteranceSegment[];

export interface VoiceIngestOutcome {
  readonly activeSpeechChunks: number;
  readonly silenceSkippedChunks: number;
  readonly segmentsCount: number;
  readonly document: SynapseDocument | null;
}

/**
 * PCM 오디오 프레임의 제곱 평균 에너지(Mean Square) 계산 (Math.sqrt 제거로 Zero-Root 고속 VAD)
 */
export function computeMeanSquareEnergy(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sumSq += v * v;
  }
  return sumSq / samples.length;
}

/**
 * 무음 청크를 로컬에서 0-토큰 스킵하고, 유성 구간만 STT + 화자 분리 후 Connectome에 적재
 */
export async function ingestVoiceSession(
  connectome: SynapseConnectome,
  chunks: readonly AudioChunkInput[],
  options: {
    readonly sessionId: string;
    readonly collection?: string;
    readonly vadThreshold?: number;
    readonly sttEngine: SttDiarizeFn;
  }
): Promise<VoiceIngestOutcome> {
  const threshold = options.vadThreshold ?? VOICE_CONFIG.DEFAULT_VAD_RMS_THRESHOLD;
  const thresholdSq = threshold * threshold;
  const collection = options.collection ?? VOICE_CONFIG.DEFAULT_COLLECTION;

  let activeSpeechChunks = 0;
  let silenceSkippedChunks = 0;
  const allSegments: UtteranceSegment[] = [];

  for (const chunk of chunks) {
    const msEnergy = computeMeanSquareEnergy(chunk.pcmSamples);
    if (msEnergy < thresholdSq) {
      silenceSkippedChunks++;
      continue;
    }
    activeSpeechChunks++;
    const segs = await options.sttEngine(chunk.pcmSamples, chunk.sampleRateHz ?? 16000);
    allSegments.push(...segs);
  }

  if (allSegments.length === 0) {
    return {
      activeSpeechChunks,
      silenceSkippedChunks,
      segmentsCount: 0,
      document: null,
    };
  }

  const transcriptLines = allSegments.map(
    (s) => `[${s.startSec.toFixed(1)}s~${s.endSec.toFixed(1)}s] **${s.speaker}**: ${s.text}`
  );
  const md = `# 회의 녹취록: ${options.sessionId}\n\n${transcriptLines.join("\n")}`;

  const { document } = parseAnyDocumentBuffer(new TextEncoder().encode(md), {
    id: options.sessionId,
    collection,
    title: `회의록 ${options.sessionId}`,
    fileName: `${options.sessionId}.md`,
  });

  connectome.putDocument(document);
  return {
    activeSpeechChunks,
    silenceSkippedChunks,
    segmentsCount: allSegments.length,
    document,
  };
}
