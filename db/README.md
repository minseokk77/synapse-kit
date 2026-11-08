# 🗄️ synapse-db
> **Universal Markdown-First & In-Memory Connectome Database for AI-Native Systems**  
> Part of [Synapse Kit](https://github.com/minseokk77/synapse-kit) | Official Docs: [https://synapse.minseok.online](https://synapse.minseok.online)

## Installation
```bash
bun add synapse-db
# or
npm install synapse-db
```

## Quick Start
```typescript
import { SynapseDB } from 'synapse-db';

const db = new SynapseDB({
  vaultDir: './vault',
  autoWatch: true,
});
await db.init();

const notes = db.collection<{ title: string; tags: string[] }>('notes');

await notes.save({
  id: 'arch-01',
  data: { title: 'Synapse Architecture', tags: ['core', 'db'] },
  body: '# Architecture\n\nConnected to [[notes/arch-02]].',
});

// O(1) lookup, bidirectional wikilink synapses, and Korean/English BM25 search
const doc = notes.get('arch-01');
const backlinks = notes.synapses('arch-02').incoming();
const hits = notes.search('Architecture');

// Export Connectome graph directly to Obsidian Canvas (.canvas)
db.exportCanvas('./vault/connectome.canvas');
```

## Features
- **Markdown-First Storage**: Lossless YAML Frontmatter + Markdown body persistence with atomic `.tmp` rename writes.
- **In-Memory Connectome**: $O(1)$ hash lookup and automatic bidirectional `[[collection/id|alias]]` wikilink wiring with mathematically verified graph symmetry invariants.
- **Korean 2-gram + English BM25 Search**: Zero-dependency inverted index with automatic ghost-token elimination on update/delete.
- **Legacy Migrator**: Built-in `migrateFromSqlite` (with SQL injection identifier guard) and `migrateFromJsonArray`.
- **Obsidian Canvas Exporter**: Generates interactive `.canvas` files for visual graph inspection in Obsidian.

## License
MIT
