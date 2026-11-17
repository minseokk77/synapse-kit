import { describe, expect, it } from "bun:test";
import { buildRepoMap, computePrBlastRadius } from "../index";

describe("🗺️ Synapse-Codemap 검증", () => {
  it("1. TS/Rust 심볼 추출, 초압축 Repo-Map 토큰 절감 및 PR Blast Radius 계산", () => {
    const files = [
      {
        path: "src/auth.ts",
        content: `export interface UserToken { id: string; }\nexport function verifyToken(t: string): boolean { return t.length > 0; }\n` + "// padding\n".repeat(40),
      },
      {
        path: "src/api.ts",
        content: `import { verifyToken } from "./auth";\nexport async function handleReq() { return verifyToken("x"); }\n` + "// body\n".repeat(40),
      },
      {
        path: "src/lib.rs",
        content: `use std::collections::HashMap;\npub struct FastCache { pub size: usize }\npub fn warm_cache() {}\n`,
      },
    ];

    const map = buildRepoMap(files);
    expect(map.totalFiles).toBe(3);
    expect(map.totalSymbols).toBe(5);
    expect(map.tokenReductionRatio).toBeGreaterThan(0.5);
    expect(map.compactMapText).toContain("function:verifyToken@L2");

    const blast = computePrBlastRadius(["src/auth.ts"], map);
    expect(blast.impactedFiles).toContain("src/auth.ts");
    expect(blast.impactedFiles).toContain("src/api.ts");
  });
});
