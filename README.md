# 🧠 Synapse Kit (`synapse-kit`)
> **AI-Native Unified Twin-Core: Polyglot Compiler Engine & Causal Memory 2.0 Brain**  
> 🌐 **Language / 언어**: **English (Global)** | [한국어 (Korean)](./README.ko.md)  
> **Official Website**: [https://synapse.minseok.online](https://synapse.minseok.online) | **Memory Portal**: [https://synapse.minseok.online/memory/](https://synapse.minseok.online/memory/)

[![npm version](https://img.shields.io/npm/v/synapse-kit.svg?style=flat-square&color=0a84ff)](https://www.npmjs.com/package/synapse-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.1+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Supported Languages](https://img.shields.io/badge/Languages-Rust_%7C_TypeScript_%7C_C%2B%2B_%7C_C%23_%7C_Java_%7C_Svelte_%7C_Go_%7C_Python-10b981?style=flat-square)]()

`Synapse Kit` is a next-generation AI-native twin-core framework coupling a **blazing-fast 10-language compiler engine (`compiler/`)** with an **AI agent 0-token causal memory brain (`memory/`)**.

---

## 📌 Table of Contents
1. [🏛️ Top-Level Twin-Core Architecture](#-top-level-twin-core-architecture)
2. [💾 Causal Memory 2.0 & 3 Core Safeguards](#-causal-memory-20--3-core-safeguards)
3. [📊 Empirical Benchmarks (800K Monorepo & 100K Memory)](#-empirical-benchmarks)
4. [🚀 Quick Start](#-quick-start)
5. [💻 Dual Independent CLI Commands](#-dual-independent-cli-commands)
6. [📦 Sub-path Imports Support](#-sub-path-imports-support)
7. [License](#-license)

---

## 🏛️ Top-Level Twin-Core Architecture

The repository and package layout strictly decouples the **compiler** and **memory** into equal peer modules at the root:

```text
synapse-kit/
├── compiler/           ➔ ⚡ [Synapse Compiler] Concurrent polyglot check, build & bundle
└── memory/             ➔ 💾 [Synapse Memory] 100,000-rule SQLite WAL causal memory brain
```

* **`synapse-kit/compiler`**: For teams and CI pipelines wanting pure, ultra-fast monorepo build acceleration.
* **`synapse-kit/memory`**: For Claude Code, Cursor, and Antigravity agents seeking 99.2% token compression.

---

## 💾 Causal Memory 2.0 & 3 Core Safeguards

Replaces unindexed text-dumping graphs with a structured **Cause ➔ Invariant ➔ Effect** resonance engine.

1. **🛡️ 2-Tier Hybrid Architecture (Zero Memory Loss)**
   - **Tier 1 (Global Invariants)**: Constant 50 tokens (preserves terminal prefs and global constraints in zero-shot tasks).
   - **Tier 2 (Domain Resonance)**: 10~30 tokens precisely injected only upon matched files/keywords; 0.00s skip for unrelated work.
2. **⚙️ Git & AST Auto-Harvesting (Zero Maintenance Cost)**
   - Automatically harvests and tunes file triggers from Git diffs and AST symbols upon passing `synapse check/build`.
3. **🔒 Single SQLite WAL Mode (Atomic Concurrency)**
   - Guarantees non-blocking concurrent reads and ACID atomic writes across multi-agent and dashboard environments via `PRAGMA journal_mode = WAL`.

---

## 📊 Empirical Benchmarks

| Domain | Scenario | Traditional CI / Toolchains | Synapse Kit v0.2.2 | Improvement |
| :--- | :--- | :--- | :--- | :--- |
| **Compiler** | 7-Language 800K LOC Full Check | 28.13s (Sequential sum) | **1.54s ~ 19.92s** (Parallel) | **Up to 28x faster** |
| **Compiler** | Svelte 5 + TS 7.1 Native Fusion | 149.21s (Legacy tsc) | **0.78s** (Native Oxc) | **-99.5% reduction** |
| **Compiler** | Single-File Edit Causal Skip | 28.13s (Full rerun) | **0.31s** (700K lines 0.00s) | **-98.9% faster** |
| **Memory** | 500-Warning Burst Context Diet | 42,673 Tokens (Raw ANSI) | **351 Tokens** (Min JSON) | **-99.2% diet (121.6x)** |
| **Memory** | 100,000 Causal Rules Evaluation | 450 ms (JSON parse) | **1.72 ms** (SQLite WAL) | **261x faster** |

---

## 🚀 Quick Start

```bash
# 1. Install package
bun add -d synapse-kit

# 2. Initialize configuration
bunx synapse init

# 3. Run causal verification (0.00s skip on clean files)
bunx synapse check

# 4. Minimal compact JSON mode for AI agents
bunx synapse check --compact
```

---

## 💻 Dual Independent CLI Commands

### 1. Compiler CLI (`synapse`)
```bash
bunx synapse check           # Everyday causal smart check
bunx synapse check --all     # Full verification across all 10 checkers
bunx synapse check -i        # Live in-memory hotfix watcher (0.05s upon save)
bunx synapse build           # Multi-track incremental parallel build
bunx synapse package         # Single NSIS target + zlib high-speed streaming
bunx synapse sign            # Cryptographic Minisign Ed25519 binary signing
```

### 2. Causal Memory CLI (`synapse-memory`)
```bash
bunx synapse-memory query --files "compiler/core/engine.ts"  # Query active invariants
bunx synapse-memory audit                                    # Integrity audit of 100k rules
bunx synapse-memory harvest                                  # Auto-harvest Git triggers
bunx synapse-memory serve --port 4242                        # Start local daemon & MCP stdio
```

---

## 📦 Sub-path Imports Support

Import only what you need:

```typescript
// 1. Unified Entrypoint
import { defineConfig, CausalMemoryStore } from 'synapse-kit';

// 2. Pure Compiler Module
import { rustChecker, svelteChecker, executeChecks } from 'synapse-kit/compiler';

// 3. Pure Causal Memory Module
import { CausalMemoryStore, runCausalQuery } from 'synapse-kit/memory';
```

---

## 📄 License

MIT License &copy; 2026 Vesper & Project Synapse Authors.
