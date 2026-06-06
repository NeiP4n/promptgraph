# Architecture

## Overview

PromptGraph is a **semantic skill router** for MCP-compatible AI clients (Claude Code, Cursor, Windsurf, etc.). It indexes `.md` skill files, embeds them using a local ONNX model (BGE-Small-EN-v1.5, 384-dim), and serves hybrid search (embedding + BM25) over the MCP protocol.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        MCP Client (Claude Code)                      │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ JSON-RPC over stdio
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                           index.js (Entry Point)                     │
│  CLI dispatcher (pg search, pg reindex, pg marketplace, ...)         │
│  MCP server (pg_search, pg_context, pg_rate, pg_marketplace_*, ...)   │
└────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬─────────┘
     │      │      │      │      │      │      │      │      │
     ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼
  search  indexer market-  parser embedder  ann   chunker  api   cli
   .js     .js    place    .js    .js     .js     .js    .js   .js
                    .js
     │      │              │      │       │              │
     │      │              │      │       │              │
     ▼      ▼              ▼      ▼       ▼              ▼
   ┌──────────────────────────────────────────────────────────┐
   │                    db.js (SQLite via better-sqlite3)      │
   │  skills │ chunks (BLOB) │ edges │ ratings │ skills_fts   │
   └──────────────────────────────────────────────────────────┘
     │      │              │
     ▼      ▼              ▼
   ┌──────────────────────────────────────────────────────────┐
   │              src/store/ (Vector Index)                    │
   │  index.js → FlatVectorStore or HNSWVectorStore           │
   └──────────────────────────────────────────────────────────┘
     │
     ▼
   ┌──────────────────────────────────────────────────────────┐
   │          src/filter/ (Quality Classifier)                 │
   │  hard-filter.js  │  classifier.js  │  train.js           │
   └──────────────────────────────────────────────────────────┘
     │
     ▼
   ┌──────────────────────────────────────────────────────────┐
   │       src/reranker/reranker.js (Cross-Encoder Reranker)   │
   └──────────────────────────────────────────────────────────┘
     │
     ▼
   ┌──────────────────────────────────────────────────────────┐
   │        src/utils/rate-limiter.js (GitHub API Throttle)    │
   └──────────────────────────────────────────────────────────┘
```

## Layers

### 1. Registry (`registry/training/`)
Contains classification training data:
- `good/` — example skill files used to train the centroid classifier
- `bad/` — non-skill documents (READMEs, changelogs, docs, etc.)

Training computes centroid vectors (mean embeddings) for good vs. bad, stored in `~/.claude/.promptgraph/model.json`.

### 2. Search Layer (`search.js`)
The search pipeline:

```
query → embed(query)                    ← embedder.js (BGE-Small-EN-v1.5)
     → runEmbeddingSearch(db, vec, K)   ← ANN (HNSW) with flat fallback
     → runBM25Search(db, query, K)      ← SQLite FTS5
     → hybrid fusion (weighted sum)     ← adaptive weights (0.7/0.3 or 0.5/0.5)
     → Reranker.rerank(query, top20)    ← term overlap rescoring
     → applyRatingBoost()               ← success/fail history
     → skillWithSnippet()               ← format results
```

Adaptive weighting: if query contains uppercase or digits (technical terms), embed/bm25 weights shift from 70/30 to 50/50.

### 3. Store Layer (`src/store/`)
Vector index abstraction with two implementations:
- **FlatVectorStore** (default, env `PG_VECTOR_STORE=flat`) — brute-force cosine in Float32Array. Zero dependencies, always correct.
- **HNSWVectorStore** (env `PG_VECTOR_STORE=hnsw`) — approximate nearest neighbor via `hnswlib-node`. Faster at scale, requires native module.

The `VectorStore` base class defines: `add`, `addBatch`, `remove`, `search`, `build`, `clear`, `size`.

### 4. Classifier Layer (`src/filter/`)
Two-stage content quality filter:
- **Hard Filter** (`hard-filter.js`) — reject by filename (README, LICENSE, CHANGELOG, etc.), directory (docs/, tests/, node_modules/), and header patterns (`# Readme`, badges).
- **Soft Classifier** (`classifier.js`) — feature-vector scoring (headers, code blocks, lists, verb count) + centroid similarity (cosine distance to good/bad centroids). Rule A override catches adversarial false negatives.

### 5. Filter Layer (`src/filter/` continued)
- **train.js** — computes centroid model from training data in `registry/training/`. Called via `pg train`.
- **classifier.js** — 14-dim feature vector + centroid cosine similarity. Thresholds: `>= 0.35` skill, `>= 0.15` unsure, below rejects.

### 6. Indexer Layer (`indexer.js`)
Full indexing pipeline:

```
indexAll()
  1. glob all sources → collect .md files
  2. reconcile DB: remove stale/deleted/renamed skills
  3. for each file:
     a. stat (size gate 5 MB)
     b. hash (MD5) — skip if unchanged
     c. isSkillFile() — hard filter + content check
     d. parseSkillFile() — frontmatter + body + skill references
     e. batch → filterWithClassifier() → indexBatch()
  4. indexBatch():
     a. chunkText() → semantic chunks (max 2 per skill)
     b. embedBatch() → BGE-Small-EN vectors
     c. upsert skills, chunks (BLOB), edges, FTS5
  5. buildAnnIndex() → rebuild vector index
```

### 7. Database Layer (`db.js`)
SQLite via `better-sqlite3`, WAL journal mode. Tables:
- **skills** — id, name, description, path, source, content, hash, version, author, license, updated_at, downloads, verified, trust_level, rating, rating_count, popularity, last_update
- **chunks** — skill_id, chunk_index, text, embedding (Float32 BLOB)
- **edges** — from_skill → to_skill (skill reference graph)
- **ratings** — skill_id, uses, success, fail
- **skills_fts** — FTS5 virtual table for BM25 keyword search
- **registry_entries** — id, trust_level, downloads, rating, popularity

Embeddings stored as raw Float32Array BLOBs (~1.5 KB per 384-dim vector), not JSON.

### 8. Reranker Layer (`src/reranker/reranker.js`)
Lightweight cross-encoder reranker applied to the top 20 hybrid results. Computes term overlap ratio and blends with original score (`0.8 * originalScore + 0.2 * termOverlap`). Disabled via `PG_RERANKER=0`.

### 9. Parser Layer (`parser.js`)
- Reads frontmatter (YAML via `gray-matter`)
- Extracts name, description, content
- Finds skill references via regex `/([a-z0-9][a-z0-9-]{2,})/g` (bare path-like references)
- Builds edge list for the dependency graph

### 10. Utility Layer (`src/utils/`, `cli.js`, `chunker.js`, `config.js`)
- **RateLimiter** — sliding-window rate limiter for GitHub API calls (30 req/min for API, 60 req/min for downloads)
- **chunker.js** — splits skill content by markdown headers, then by word count (800 words, 100 overlap, max 2 chunks)
- **config.js** — JSON config management (sources, safety limits)
- **cli.js** — terminal output (colors, spinners, progress bars)
- **chunkText** — splits on h1/h2/h3 boundaries

### 11. Marketplace Layer (`marketplace.js`)
- Registry client (fetches from GitHub raw `registry.json`)
- Skill/bundle installation (atomic write + validate)
- Trust system (setTrustLevel, getByTrustLevel)
- Download tracking (incrementDownloads)
- Rating system (rateSkill, getTopRated)

### 12. GitHub Import Layer (`github-import.js`)
- Sparse checkout via `git sparse-checkout` (only skills subdirectory)
- Full clone fallback for root-level repos
- Repo validation via GitHub API (detect skills dir, validate all `.md` files)
- Cleanup (removes docs, non-skill files, empty dirs)
- Dual rate limiter: GitHub API + download stream

### 13. Watcher Layer (`watcher.js`)
- `chokidar` file watcher for auto-reindex on `.md` add/change/delete
- Only active in MCP server mode
- Handles rename detection (old id vs new id)

## Data Flow: Query

```
User query         MCP tool         search.js              embedder.js
  "deploy api"  →  pg_search      → adaptWeights()       → embed(query)
                                         │                       │
                                         │                 BGE-Small-EN
                                         │                 384-dim vector
                                         ▼                       │
                                   runEmbeddingSearch() ◄───────┘
                                        │ flat / HNSW
                                        ▼
                                   runBM25Search()
                                        │ FTS5
                                        ▼
                                   hybrid fusion
                                        │ 0.7*embed + 0.3*bm25
                                        ▼
                                   Reranker.rerank()
                                        │ term overlap rescore
                                        ▼
                                   applyRatingBoost()
                                        │ success/fail ratio
                                        ▼
                                   skillWithSnippet()
                                        │
                                        ▼
                                   JSON result to MCP client
```

## Data Flow: Indexing

```
Filesystem               indexer.js              parser.js
  .md files  →  indexAll()  →  stat + hash + isSkillFile()
                                         │
                                         ▼
                                   parseSkillFile()
                                         │ frontmatter + calls
                                         ▼
              ┌──────────────────── batch[100] ────────────────────┐
              │                                                     │
              ▼                                                     ▼
        filterWithClassifier()                               indexBatch()
        (embed + centroid)                                       │
              │                                          chunker.js
              ▼                                        (header-split)
        hard-filter.js + classifier.js                        │
                                                     embedBatch()
                                                         │
                                                         ▼
                                                   SQLite upsert
                                              skills + chunks + edges
                                                         │
                                                         ▼
                                                   buildAnnIndex()
                                              (Flat or HNSW rebuild)
```

## Trust System

Stored in `registry_entries` table:

| Level     | Meaning |
|-----------|---------|
| verified  | Official, manually audited |
| official  | First-party or trusted publisher |
| trusted   | Community but reputation-verified |
| community | Public contributions (default) |
| unknown   | Not yet assessed |

`calcPopularity(downloads, rating)` = `downloads * (rating + 1)`. Used for ranking.

## Safety Limits Architecture

All limits defined in `config.js`:

| Constant              | Value    | Enforced In |
|-----------------------|----------|-------------|
| MAX_DOWNLOAD_SIZE     | 50 MB    | validator.js, github-import.js |
| MAX_FILE_COUNT        | 100000   | indexer.js, github-import.js |
| MAX_REPO_SIZE         | 500 MB   | github-import.js |
| RATE_LIMIT_REQUESTS   | 30       | github-import.js |
| RATE_LIMIT_WINDOW_MS  | 60000 ms | github-import.js |
| MAX_FILE_SIZE         | 5 MB     | indexer.js |
| MAX_EMBEDDING_CALLS   | 10000    | embedder.js |
| BATCH_SIZE            | 100      | indexer.js |

## Key Design Decisions

1. **Local-first, zero cloud** — Embedding via local ONNX model, SQLite DB, no API keys.
2. **Lazy imports** — Heavy modules (fastembed, better-sqlite3, hnswlib-node) are dynamically imported only when needed. CLI help starts instantly.
3. **Hybrid search** — Embedding cosine + BM25 FTS5 with adaptive weights. Best of semantic and keyword.
4. **Flat vector store by default** — HNSW is opt-in (`PG_VECTOR_STORE=hnsw`). Flat is simpler, always correct, and fast enough for < 10K vectors.
5. **Float32 BLOB storage** — Embeddings stored as raw binary buffers instead of JSON, ~10x smaller.
6. **Two-stage filtering** — Cheap hard filter (filename/dir/header checks) before expensive classifier (embedding + centroid).
7. **EOF delimiters removed** — Chunk embedding count limited to 2 per skill to cap inference cost.
8. **Sparse checkout for repos** — Only the skills subdirectory is cloned, not the entire repo.
9. **Atomic skill writes** — Validate to temp file, then rename. No partial installs.
10. **Hash-based incremental indexing** — MD5 hash on content; unchanged files skip parsing + embedding + DB write.

## Module Dependency Map

```
index.js (entry)
  ├── config.js              ── no deps
  ├── cli.js                 ── chalk, boxen
  ├── parser.js              ── gray-matter, src/filter/*
  ├── embedder.js             ── fastembed
  ├── chunker.js              ── no deps
  ├── db.js                  ── better-sqlite3
  ├── search.js              ── embedder, db, ann, src/reranker
  ├── indexer.js             ── glob, parser, embedder, db, chunker, ann, cli
  ├── ann.js                 ── db, src/store
  ├── marketplace.js          ── db, validator, config, github-import
  ├── github-import.js        ── config, validator, parser, src/utils
  ├── validator.js            ── gray-matter, config
  ├── doctor.js               ── db
  ├── watcher.js              ── chokidar, indexer, db, config
  ├── api.js                 ── search, indexer, db, config
  ├── platform.js            ── config
  ├── tui.js                 ── (marketplace terminal UI)
  ├── bundle-counts.js        ── config
  ├── pg-hook.js              ── (post-commit hook)
  └── validate-repo-action.js ── github-import, validator
         │
src/store/index.js            ── flat-store, hnsw-store
src/store/vector-store.js     ── (abstract base)
src/store/flat-store.js       ── vector-store
src/store/hnsw-store.js       ── vector-store, hnswlib-node
src/filter/hard-filter.js     ── fs
src/filter/classifier.js      ── embedder
src/filter/train.js           ── glob, embedder
src/reranker/reranker.js      ── no deps
src/utils/rate-limiter.js     ── no deps
```
