/**
 * Synapse-Optic Voice: 에너지 기반 무음 구간(VAD) 필터 & 화자 분리 STT 브릿지
 */

export const OPTIC_VOICE_CONFIG = {
  DEFAULT_VAD_RMS_THRESHOLD: 0.02,
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

export type SttDiarizeFn = (
  samples: Float32Array,
  sampleRateHz: number
) => Promise<UtteranceSegment[]> | UtteranceSegment[];

export interface VoiceTranscriptResult {
  readonly activeSpeechChunks: number;
  readonly silenceSkippedChunks: number;
  readonly segments: readonly UtteranceSegment[];
  readonly markdownTranscript: string;
}

/**
 * 제곱 평균 에너지 계산 (Math.sqrt 제거 고속 VAD)
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
 * 무음 청크는 0-토큰 스킵하고 유성 구간만 STT + 화자 분리 마크다운 회의록 생성
 */
export async function transcribeVoiceChunks(
  chunks: readonly AudioChunkInput[],
  options: {
    readonly sessionId: string;
    readonly vadThreshold?: number;
    readonly sttEngine: SttDiarizeFn;
  }
): Promise<VoiceTranscriptResult> {
  const threshold = options.vadThreshold ?? OPTIC_VOICE_CONFIG.DEFAULT_VAD_RMS_THRESHOLD;
  const thresholdSq = threshold * threshold;
  let activeSpeechChunks = 0;
  let silenceSkippedChunks = 0;
  const segments: UtteranceSegment[] = [];

  for (const chunk of chunks) {
    if (computeMeanSquareEnergy(chunk.pcmSamples) < thresholdSq) {
      silenceSkippedChunks++;
      continue;
    }
    activeSpeechChunks++;
    const segs = await options.sttEngine(chunk.pcmSamples, chunk.sampleRateHz ?? 16000);
    segments.push(...segs);
  }

  const lines = segments.map(
    (s) => `[${s.startSec.toFixed(1)}s~${s.endSec.toFixed(1)}s] **${s.speaker}**: ${s.text}`
  );
  const markdownTranscript =
    segments.length === 0 ? "" : `# 회의 녹취록: ${options.sessionId}\n\n${lines.join("\n")}`;

  return {
    activeSpeechChunks,
    silenceSkippedChunks,
    segments,
    markdownTranscript,
  };
}
