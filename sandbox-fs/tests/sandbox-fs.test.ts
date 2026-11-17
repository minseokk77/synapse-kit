import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxOverlayFS } from "../index";

describe("📦 Synapse-Sandbox-FS 검증", () => {
  it("1. CoW 오버레이 격리 쓰기, 0ms 롤백 및 검증 후 실제 디스크 커밋", () => {
    const dir = mkdtempSync(join(tmpdir(), "synapse-sfs-"));
    try {
      const target = join(dir, "app.ts");
      writeFileSync(target, "export const v = 1;\n", "utf-8");

      const fsOverlay = new SandboxOverlayFS(dir);
      fsOverlay.writeFile("app.ts", "export const v = 999;\n");
      fsOverlay.writeFile("new.ts", "export const created = true;\n");

      // 오버레이 상에서는 변경되었지만 실제 디스크는 그대로
      expect(fsOverlay.readFile("app.ts")).toContain("999");
      expect(readFileSync(target, "utf-8")).toContain("1");
      expect(fsOverlay.diff().length).toBe(2);

      // 0ms 롤백
      fsOverlay.rollback();
      expect(fsOverlay.readFile("app.ts")).toContain("1");
      expect(fsOverlay.exists("new.ts")).toBe(false);

      // 재수정 후 실제 디스크 커밋
      fsOverlay.writeFile("app.ts", "export const v = 2;\n");
      const committed = fsOverlay.commitToDisk();
      expect(committed.committedWrites).toBe(1);
      expect(readFileSync(target, "utf-8")).toContain("2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
