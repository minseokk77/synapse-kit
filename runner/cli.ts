#!/usr/bin/env bun
/**
 * 시냅스 러너 CLI 진입점 (Synapse Runner CLI)
 */
import { SynapseRunner } from "./src";

const runner = new SynapseRunner({
  autoRestart: true,
  autoHarvestCrash: true,
});

process.stdout.write("🔄 Synapse Runner 자가치유 슈퍼바이저 대기 중...\n");

process.on("SIGINT", () => {
  runner.close();
  process.exit(0);
});
