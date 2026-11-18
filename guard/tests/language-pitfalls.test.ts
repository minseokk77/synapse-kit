import { describe, expect, it } from "bun:test";
import { SynapseGuard } from "../src";

describe("🧬 SynapseGuard 8대 언어 자체 취약점 정적 감사", () => {
  it("1. [TypeScript] 프로토타입 오염, as any 단언, ReDoS 패턴 정밀 탐지", () => {
    const guard = new SynapseGuard();
    const tsCode = [
      `const user = payload as any;`,
      `target["__proto__"] = { isAdmin: true };`,
      `const badRe = /(a+)+$/;`,
      `export const clean = 1;`,
    ].join("\n");

    const report = guard.auditLanguagePitfalls(tsCode, "handler.ts");
    expect(report.ok).toBe(false);
    expect(report.totalViolations).toBe(3);

    const types = report.violations.map((v) => v.type);
    expect(types).toContain("TS_TYPE_ERASURE_BYPASS");
    expect(types).toContain("TS_PROTOTYPE_POLLUTION");
    expect(types).toContain("TS_REDOS_RISK");
  });

  it("2. [Rust] unsafe/transmute, 무검증 as 정수 캐스팅, unwrap/expect 패닉 위험 탐지", () => {
    const guard = new SynapseGuard();
    const rsCode = [
      `unsafe { std::ptr::write(ptr, 1); }`,
      `let lsn_i64 = raw_lsn as i64;`,
      `let val = map.get("k").unwrap();`,
      `let safe = i64::try_from(raw_lsn).map_err(|_| "err")?;`,
    ].join("\n");

    const report = guard.auditLanguagePitfalls(rsCode, "engine.rs");
    expect(report.ok).toBe(false);
    expect(report.totalViolations).toBe(3);

    const types = report.violations.map((v) => v.type);
    expect(types).toContain("RUST_UNSAFE_BLOCK");
    expect(types).toContain("RUST_INT_CAST_WRAP");
    expect(types).toContain("RUST_PANIC_RISK");
  });

  it("3. [C/C++ · Svelte · Java · C# · Go · Python] 6개 언어 핵심 취약점 전수 탐지", () => {
    const guard = new SynapseGuard();

    const cpp = guard.auditLanguagePitfalls(`strcpy(buf, input);\nprintf(user_msg);`, "main.cpp");
    expect(cpp.violations.map((v) => v.type)).toEqual(["CPP_BUFFER_OVERFLOW", "CPP_FORMAT_STRING"]);

    const svelte = guard.auditLanguagePitfalls(`<div>{@html userBio}</div>\nconst x = a as any;`, "Page.svelte");
    expect(svelte.violations.map((v) => v.type)).toEqual(["SVELTE_RAW_HTML_XSS", "TS_TYPE_ERASURE_BYPASS"]);

    const java = guard.auditLanguagePitfalls(
      `new ObjectInputStream(in).readObject();\nRuntime.getRuntime().exec(cmd);\nDocumentBuilderFactory.newInstance();`,
      "Service.java"
    );
    expect(java.violations.map((v) => v.type)).toEqual([
      "JAVA_INSECURE_DESERIALIZE",
      "JAVA_JNDI_OR_EXEC",
      "JAVA_XXE_RISK",
    ]);

    const csharp = guard.auditLanguagePitfalls(
      `new BinaryFormatter();\ndb.FromSqlRaw($"SELECT * FROM U WHERE id={id}");\np.UseShellExecute = true;`,
      "Controller.cs"
    );
    expect(csharp.violations.map((v) => v.type)).toEqual([
      "CSHARP_INSECURE_DESERIALIZE",
      "CSHARP_SQL_INTERPOLATION",
      "CSHARP_SHELL_EXEC",
    ]);

    const go = guard.auditLanguagePitfalls(
      `import "text/template"\nimport "math/rand"\np := unsafe.Pointer(&x)`,
      "server.go"
    );
    expect(go.violations.map((v) => v.type)).toEqual([
      "GO_TEMPLATE_XSS",
      "GO_WEAK_RAND",
      "GO_UNSAFE_POINTER",
    ]);

    const py = guard.auditLanguagePitfalls(
      `data = pickle.loads(raw)\nsubprocess.run(cmd, shell=True)\nassert is_admin`,
      "app.py"
    );
    expect(py.violations.map((v) => v.type)).toEqual([
      "PY_INSECURE_DESERIALIZE",
      "PY_SHELL_OR_EXEC",
      "PY_ASSERT_SECURITY",
    ]);
  });

  it("4. [안전 코드] 8개 언어 모범 코드는 위반 0건 통과", () => {
    const guard = new SynapseGuard();
    expect(guard.auditLanguagePitfalls(`export const safeMap = new Map<string, number>();`, "clean.ts").ok).toBe(true);
    expect(guard.auditLanguagePitfalls(`pub fn add_checked(a: u64, b: u64) -> Option<u64> { a.checked_add(b) }`, "clean.rs").ok).toBe(true);
    expect(guard.auditLanguagePitfalls(`snprintf(buf, sizeof(buf), "%s", msg);`, "clean.cpp").ok).toBe(true);
    expect(guard.auditLanguagePitfalls(`<p>{userBio}</p>`, "Clean.svelte").ok).toBe(true);
    expect(guard.auditLanguagePitfalls(`data = yaml.safe_load(raw)`, "clean.py").ok).toBe(true);
  });
});
