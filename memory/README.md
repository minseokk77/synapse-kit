# 💾 synapse-kit-memory
> **AI-Native 0-Token Causal Memory Engine 2.0 with SQLite WAL Atomic Transactions & MCP Server**  
> Part of [Synapse Kit](https://github.com/minseokk77/synapse-kit) | Official Docs: [https://synapse.minseok.online/memory/](https://synapse.minseok.online/memory/)

## Installation
```bash
bun add -d synapse-kit-memory
# or
npm install -D synapse-kit-memory
```

## CLI Usage
```bash
bunx synapse-memory query --files "src/app.ts"  # Query active causal invariants
bunx synapse-memory audit                       # Audit 100k rules & integrity
bunx synapse-memory harvest                     # Auto-harvest Git diff triggers
bunx synapse-memory serve --port 4242           # Start local daemon & MCP stdio server
```

## 3 Core Safeguards
1. **2-Tier Hybrid Architecture**: Tier 1 Global Invariants (always 50 tokens) + Tier 2 Causal Resonance (0ms skip or 10-30 tokens). Completely eliminates early brainstorming memory loss.
2. **Git & AST Auto-Harvesting**: Zero manual schema maintenance. Automatically harvests file triggers from passing compiler builds.
3. **Single SQLite WAL Mode**: Non-blocking concurrent ACID transactions for multi-agent & dashboard environments.

## License
MIT
