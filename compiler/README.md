# ⚡ @synapse-kit/compiler
> **Blazing-Fast Polyglot Compiler & Incremental Verification Engine for 10 Languages & Systems**  
> Part of [Synapse Kit](https://github.com/minseokk77/synapse-kit) | Official Docs: [https://synapse.minseok.online](https://synapse.minseok.online)

## Installation
```bash
bun add -d @synapse-kit/compiler
# or
npm install -D @synapse-kit/compiler
```

## CLI Usage
```bash
bunx synapse check          # Everyday causal smart check
bunx synapse check --all    # Full check across all 10 checkers
bunx synapse check -i       # Live hotfix loop (0.05s in-memory re-check)
bunx synapse build          # Multi-track incremental parallel build
bunx synapse package        # Fast NSIS installer packaging
bunx synapse sign           # Minisign / Ed25519 digital signature
```

## Features
- **10 Standard Checkers**: Rust, Svelte 5, TypeScript, C++, C#, Java, Go, Python, Schema, Native PE x64 DLL, NSIS.
- **Causal Smart Skip**: 0.00s skip for unmodified subsystems using Git worktree analysis.
- **Concurrency**: Fully non-blocking parallel execution across isolated worker threads.

## License
MIT
