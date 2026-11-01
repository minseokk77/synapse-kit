# 🧠 Synapse Kit (`synapse-kit`)
> **AI-Native Unified Compiler, Linter & Verification Framework for Tauri, Full-Stack & Polyglot Monorepos**  
> 🌐 **Language / 언어**: **English (Global)** | [한국어 (Korean)](./README.ko.md)  
> **Official Website & Interactive Wiki**: [https://synapse.minseok.online](https://synapse.minseok.online)

[![npm version](https://img.shields.io/npm/v/synapse-kit.svg?style=flat-square&color=0a84ff)](https://www.npmjs.com/package/synapse-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.1+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Supported Languages](https://img.shields.io/badge/Languages-Rust_%7C_TypeScript_%7C_C%2B%2B_%7C_C%23_%7C_Java_%7C_Svelte_%7C_Go_%7C_Python-10b981?style=flat-square)]()

`Synapse Kit` is a high-performance, AI-Native unified compiler, build, and verification framework. It concurrently orchestrates multi-language monorepos (Rust, TypeScript, Svelte 5, C++, C#, Java, Go, Python) across parallel worker pipelines and harnesses a Git-backed Causal Memory Graph to **smartly skip unmodified code in 0.00s**.

---

## 📌 Table of Contents
1. [Benchmarks (800K LOC Monorepo)](#-benchmarks-800k-loc-monorepo)
2. [Key Architecture & 3 Pillars](#-key-architecture--3-pillars)
3. [Quick Start](#-quick-start)
4. [CLI Command Reference](#-cli-command-reference)
5. [Internationalization (i18n & Locale Auto-Detection)](#-internationalization-i18n)
6. [AI Coding Agent Integration (Claude Code, Cursor)](#-ai-coding-agent-integration)
7. [Built-in Checker Plugins](#-built-in-checker-plugins)
8. [License](#-license)

---

## 📊 Benchmarks (800K LOC Monorepo)

> **Explore Interactive Charts & Wiki**: [https://synapse.minseok.online#benchmarks](https://synapse.minseok.online#benchmarks)

| Scenario | Target (813,931 LOC Monorepo) | Sequential Execution | Vesper Synapse Kit | Speedup |
| :--- | :--- | :--- | :--- | :--- |
| **7-Language Monorepo Full Check** | Rust • TS/Svelte 5 • C++ • C# • Java • Go • Python | 28.13s (Sequential) | **19.92s** (Concurrent Parallel) | **-29.2% faster** (8.21s saved) |
| **Svelte 5 + TS 7.1 Native Fusion** | 800K LOC UI reactive runes & typecheck | 149.21s (Legacy Compiler) | **0.78s** (Native Fusion) | **-99.5% dramatic reduction** |
| **Single-File Causal Smart Skip** | Modify 1 component among 800K LOC | 28.13s (Full rerun) | **0.31s** (700K LOC skipped in 0.00s) | **-98.9% faster** |
| **Interactive Live Hotfix (`-i`)** | Fix syntax/type error and save file | 28.13s (Cold restart) | **0.05s** (In-memory hot recheck) | **-99.8% instant feedback** |
| **AI Agent Diagnostic Payload** | Compiler error/warning dump | ANSI log (~3,400 Tokens) | **11 Tokens** (45B JSON) | **-99.8% token diet** |

---

## ⚡ Key Architecture & 3 Pillars

1. **Concurrent Multi-Track Execution (Critical Path Convergence)**
   - Simultaneously runs static checkers across 7 languages (`cargo check`, `g++`, `dotnet build`, `javac`, `svelte-check`, `go vet`, `py_compile`) inside non-blocking asynchronous workers, reducing total wait time to only the slowest component.
2. **AI Causal Memory Graph (Zero-Cost Smart Skipping)**
   - Intersects `git status -uall` diffs with plugin trigger trees, ensuring untouched subsystems and crates are skipped in **0.00s** without invoking compilers.
3. **99.8% Token Diet for AI Coding Agents (`--compact`)**
   - Emits a minified 1-line JSON response (`{"ok":true,"duration":"0.31s"}`) instead of noisy 3,000-token terminal logs, saving context window bandwidth for agents like Claude Code, Cursor, Cline, and Antigravity.

---

## 🚀 Quick Start

### 1. Installation
```bash
bun add -d synapse-kit
# Or invoke directly via bunx:
bunx synapse-kit check
```

### 2. Initialize Configuration (`synapse init`)
```bash
bunx synapse-kit init
```

Generates an optimized `synapse.config.ts` in your project root:

```typescript
import {
  defineConfig,
  rustChecker,
  svelteChecker,
  javaChecker,
  schemaChecker,
} from 'synapse-kit';

export default defineConfig({
  // Enable AI Causal Graph (Smart Skipping)
  aiMemory: {
    enabled: true,
    smartSkipping: true,
  },

  // Register verification plugins
  plugins: [
    rustChecker({ workspaceDir: './src-tauri' }),
    svelteChecker({ tsconfig: './tsconfig.json' }),
    javaChecker({ sourceDir: './services/gateway' }),
    schemaChecker({
      targets: [{ path: './src-tauri/tauri.conf.json' }],
    }),
  ],

  // Ultra-fast incremental build tracks
  buildTracks: [
    {
      name: 'Frontend Build',
      command: ['bun', 'run', 'build'],
      sources: ['src/'],
      artifacts: ['dist/'],
    },
  ],
});
```

---

## 💻 CLI Command Reference

```bash
# Smart verification (inspects git changes and skips untouched tracks)
bunx synapse-kit check

# Force full verification across all registered plugins
bunx synapse-kit check --all

# Parallel incremental build (0.00s skip when sources are unchanged)
bunx synapse-kit build

# High-speed single NSIS installer bundling
bunx synapse-kit package

# Minisign / Ed25519 cryptographic binary signing
bunx synapse-kit sign

# AI agent mode with minimal JSON output (11 tokens on pass)
bunx synapse-kit check --compact

# Interactive hotfix loop (pauses on error; hot-rechecks in 0.05s upon file save)
bunx synapse-kit check --interactive
```

---

## 🌐 Internationalization (i18n)

Synapse Kit automatically detects your **OS system locale** (English / Korean) to render the CLI output. You can also explicitly specify your preferred language via CLI flags or environment variables:

```bash
# Force English output
bunx synapse-kit check --lang=en

# Force Korean output
bunx synapse-kit check --lang=ko

# Specify via environment variable
export SYNAPSE_LANG=en
```

---

## 🤖 AI Coding Agent Integration

### Cursor (`.cursorrules`) or Claude Code (`CLAUDE.md`)
Add this directive to your agent prompt or rule files to prevent terminal token bloat:

```markdown
After editing code, verify using Synapse Kit compact mode instead of full log checks:
$ bunx synapse-kit check --compact
- Returns a single-line 11-token JSON on success, saving 99.8% of context window tokens.
```

---

## 🧩 Built-in Checker Plugins

| Plugin Function | Target Ecosystem | Behavior & Causal Trigger |
| :--- | :--- | :--- |
| `rustChecker()` | Rust / Cargo | Listens to `Cargo.toml`, `*.rs` ➜ runs non-blocking `cargo check` |
| `svelteChecker()` | Svelte 5 / TypeScript | Listens to `src/**/*.svelte`, `*.ts` ➜ runs TS 7.1 native checker |
| `javaChecker()` | Java / Spring / Gradle | Listens to `pom.xml`, `build.gradle`, `*.java` ➜ runs `javac` bytecode check |
| `cppChecker()` | C / C++ Native Kernels | Listens to `*.cpp`, `*.hpp`, `*.h` ➜ runs `g++ -fsyntax-only` |
| `csharpChecker()` | C# / .NET Solutions | Listens to `*.cs`, `*.csproj`, `*.sln` ➜ runs `dotnet build -c Release` |
| `goChecker()` | Go Backend Services | Listens to `*.go`, `go.mod` ➜ runs `go vet ./...` |
| `pythonChecker()` | Python DSP & AI Scripts | Listens to `*.py`, `pyproject.toml` ➜ runs `python -m py_compile` |
| `schemaChecker()` | Tauri / JSON Config | Verifies structural validity of `tauri.conf.json` and `package.json` |
| `nativeChecker()` | C/C++ PE DLL / Binaries | Validates machine headers (x64) and export symbols for Windows DLLs |
| `nsisChecker()` | NSIS Installer Script | Validates `.nsi` template syntax and referenced file targets |

---

## 📄 License
MIT License &copy; 2026 Vesper / Minseok (https://synapse.minseok.online)
