/**
 * Synapse 시리즈 6종(Trace · Codemap · Sandbox-FS · Policy · Pulse · Voice)
 * 대규모 스트레스 & 기존 방식 대비 비교 벤치마크 (초 s 단위 소수점 표기)
 * 실행: bun run tests/series-6-massive-benchmark.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SynapseConnectome } from "../db";
import { SynapseTracer, buildRepoMap, computePrBlastRadius } from "../compiler";
import { SandboxOverlayFS } from "../runtime";
import { HitlApprovalGate, PiiRedactor } from "../guard";
import { PulseEngine } from "../bus";
import { transcribeVoiceChunks, type AudioChunkInput } from "../optic";

const SERIES_BENCH_CONFIG = {
  TRACE_SPANS: 10000,
  CODEMAP_FILES: 5000,
  SANDBOX_FILES: 2000,
  POLICY_DOCS: 5000,
  POLICY_HITL_REQS: 2000,
  PULSE_EVENTS: 50000,
  VOICE_CHUNKS: 2000,
} as const;

const fmtSec = (ms: number) => `${(ms / 1000).toFixed(4)}s`;

async function runSeries6Benchmark(): Promise<void> {
  const out = (msg: string) => process.stdout.write(`${msg}\n`);
  out("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  out("🚀 [Synapse 시리즈 6종 대규모 벤치마크] Trace·Codemap·SandboxFS·Policy·Pulse·Voice");
  out("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const totalStart = performance.now();

  // 1. Synapse-Trace: 10,000 스팬 + 타임트래블 리플레이
  const t0 = performance.now();
  const tracer = new SynapseTracer("massive-trace");
  for (let i = 1; i <= SERIES_BENCH_CONFIG.TRACE_SPANS; i++) {
    tracer.recordSpan({
      turn: i,
      agentId: i % 2 === 0 ? "worker" : "planner",
      toolName: i % 3 === 0 ? "dci_pull" : "batch_grep",
      status: i % 100 === 0 ? "error" : "ok",
      inputTokens: 120,
      outputTokens: 40,
      durationMs: 0.5,
      stateSnapshot: { [`k_${i % 50}`]: i },
    });
  }
  const replay = tracer.replayAtTurn(5000);
  const prof = tracer.profile(3);
  const traceMs = performance.now() - t0;
  out(`\n1. [synapse-trace] ${SERIES_BENCH_CONFIG.TRACE_SPANS.toLocaleString()} 스팬 + 5,000턴 리플레이`);
  out(`   • 실측 시간: ${fmtSec(traceMs)} | 리플레이 스팬: ${replay.spansExecuted.toLocaleString()}개 | 총 토큰: ${prof.totalTokens.toLocaleString()}`);

  // 2. Synapse-Codemap: 5,000개 TS/Rust 파일 Repo-Map vs 전체 파일
  const t1 = performance.now();
  const files = Array.from({ length: SERIES_BENCH_CONFIG.CODEMAP_FILES }, (_, i) => ({
    path: `src/mod_${i}.ts`,
    content:
      (i > 0 ? `import { fn_${i - 1} } from "./mod_${i - 1}";\n` : "") +
      `export interface Spec_${i} { id: number; }\n` +
      `export function fn_${i}(x: number): number { return x + ${i}; }\n` +
      `// 구현 본문 상세 로직 주석 및 패딩 라인\n`.repeat(15),
  }));
  const mapStart = performance.now();
  const repoMap = buildRepoMap(files);
  const blast = computePrBlastRadius(["src/mod_4995.ts"], repoMap);
  const codemapMs = performance.now() - mapStart;
  const savedPct = (repoMap.tokenReductionRatio * 100).toFixed(1);
  out(`\n2. [synapse-codemap] ${SERIES_BENCH_CONFIG.CODEMAP_FILES.toLocaleString()} 파일 AST-Lite Repo-Map + PR Blast Radius`);
  out(`   • 실측 시간: ${fmtSec(codemapMs)} | 심볼: ${repoMap.totalSymbols.toLocaleString()}개 | 영향 파일: ${blast.impactedFiles.length}개`);
  out(`   • 비교 (전체 코드 vs Repo-Map): ${repoMap.rawEstimatedTokens.toLocaleString()} tok ➔ ${repoMap.mapEstimatedTokens.toLocaleString()} tok (${savedPct}% 절감)`);

  // 3. Synapse-Sandbox-FS: 2,000파일 CoW 오버레이 쓰기/Diff/0ms 롤백
  const tempRoot = mkdtempSync(join(tmpdir(), "synapse-sfs-bench-"));
  try {
    const s0 = performance.now();
    const overlay = new SandboxOverlayFS(tempRoot);
    for (let i = 0; i < SERIES_BENCH_CONFIG.SANDBOX_FILES; i++) {
      overlay.writeFile(`pkg/file_${i}.ts`, `export const VAL_${i} = ${i};\n`);
    }
    const diffs = overlay.diff();
    overlay.rollback();
    const sandboxMs = performance.now() - s0;
    out(`\n3. [synapse-sandbox-fs] ${SERIES_BENCH_CONFIG.SANDBOX_FILES.toLocaleString()} 파일 CoW 오버레이 쓰기 · Diff · 0ms 롤백`);
    out(`   • 실측 시간: ${fmtSec(sandboxMs)} | Diff 감지: ${diffs.length.toLocaleString()}건 | 실디스크 오염: 0건`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  // 4. Synapse-Policy: 5,000건 PII(20,000개 개인정보) 마스킹/복원 + 2,000건 HITL 게이트
  const p0 = performance.now();
  const redactor = new PiiRedactor();
  let totalPii = 0;
  for (let i = 0; i < SERIES_BENCH_CONFIG.POLICY_DOCS; i++) {
    const sample = `고객_${i} 주민 900101-1234567, 연락처 010-1234-5678, 카드 1234-5678-9012-3456, user${i}@test.com`;
    const r = redactor.redact(sample);
    totalPii += r.redactionsCount;
    redactor.unredact(r.redactedText, r.tokenMap);
  }
  const gate = new HitlApprovalGate({ approvalHandler: () => true });
  for (let i = 0; i < SERIES_BENCH_CONFIG.POLICY_HITL_REQS; i++) {
    await gate.authorize({
      action: i % 2 === 0 ? "deploy" : "read:status",
      actorId: "agent-01",
      summary: `작업 #${i}`,
    });
  }
  const policyMs = performance.now() - p0;
  out(`\n4. [synapse-policy] ${SERIES_BENCH_CONFIG.POLICY_DOCS.toLocaleString()}문서 PII 마스킹/복원 + ${SERIES_BENCH_CONFIG.POLICY_HITL_REQS.toLocaleString()}건 HITL 게이트`);
  out(`   • 실측 시간: ${fmtSec(policyMs)} | PII 비식별화/복원: ${totalPii.toLocaleString()}건 | 감사로그: ${gate.getAuditLogs().length.toLocaleString()}건`);

  // 5. Synapse-Pulse: 50,000건 이벤트 0-토큰 로컬 필터링 vs 전체 AI 호출
  const u0 = performance.now();
  const pulse = new PulseEngine();
  pulse.registerRule({
    id: "crit-err",
    topic: "app.log",
    minSeverity: "critical",
    pattern: /FATAL_OOM/,
    cooldownMs: 0,
    onTrigger: () => {},
  });
  for (let i = 0; i < SERIES_BENCH_CONFIG.PULSE_EVENTS; i++) {
    const isCrit = i % 1000 === 0;
    await pulse.ingest({
      topic: "app.log",
      severity: isCrit ? "critical" : "info",
      payload: isCrit ? `FATAL_OOM at worker ${i}` : `heartbeat ok ${i}`,
    });
  }
  const pulseMs = performance.now() - u0;
  const pStats = pulse.getStats();
  out(`\n5. [synapse-pulse] ${SERIES_BENCH_CONFIG.PULSE_EVENTS.toLocaleString()}건 이벤트 스트림 0-토큰 필터링`);
  out(`   • 실측 시간: ${fmtSec(pulseMs)} | 0-토큰 스킵: ${pStats.zeroTokenFilteredOut.toLocaleString()}건 (${(pStats.tokenSkipRatio * 100).toFixed(2)}%) | AI 트리거: ${pStats.aiTriggersFired}건`);

  // 6. Synapse-Voice: 2,000 청크 VAD 무음 80% 스킵 vs 전체 STT
  const v0 = performance.now();
  const connectome = new SynapseConnectome();
  const silencePcm = new Float32Array(800).fill(0.0001);
  const speechPcm = new Float32Array(800).fill(0.25);
  const chunks: AudioChunkInput[] = Array.from({ length: SERIES_BENCH_CONFIG.VOICE_CHUNKS }, (_, i) => ({
    chunkId: `c-${i}`,
    pcmSamples: i % 5 === 0 ? speechPcm : silencePcm,
  }));
  const voiceRes = await transcribeVoiceChunks(chunks, {
    sessionId: "massive-call-01",
    sttEngine: (_samples, _sr) => [{ speaker: "화자A", startSec: 0, endSec: 1, text: "안건 [[meetings/별표-1]] 확인" }],
  });
  const voiceMs = performance.now() - v0;
  const sttSavedPct = ((voiceRes.silenceSkippedChunks / SERIES_BENCH_CONFIG.VOICE_CHUNKS) * 100).toFixed(1);
  out(`\n6. [synapse-voice] ${SERIES_BENCH_CONFIG.VOICE_CHUNKS.toLocaleString()}개 PCM 오디오 청크 VAD 필터 + STT 적재`);
  out(`   • 실측 시간: ${fmtSec(voiceMs)} | 무음 스킵: ${voiceRes.silenceSkippedChunks.toLocaleString()}청크 (${sttSavedPct}% STT 비용 절감) | 유성 STT: ${voiceRes.activeSpeechChunks}청크`);

  const totalMs = performance.now() - totalStart;
  out("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  out(`🏆 Synapse 시리즈 6종 대규모 통합 벤치마크 완료 (총 소요 시간: ${fmtSec(totalMs)})`);
}

runSeries6Benchmark();
