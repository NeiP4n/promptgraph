# Changelog

## 2.6.3 (2026-06-07)

### Fixes
- **IPv6 → IPv4 fallback for Windows networks without IPv6 reachability**: Added `dns.setDefaultResultOrder('ipv4first')` at the top of `index.js` and `family: 4` to `update.js` `https.get`. Without this, `raw.githubusercontent.com` (and other hosts with AAAA records) would timeout on networks where IPv6 is unreachable, breaking `pg marketplace` and `pg update`.

## 2.6.2 (2026-06-07)

### Fixes
- **`index.js` import fix**: `mod.handler` → `mod.default` — `export default function handler()` does not create a named export `handler` in Node.js ESM. All CLI commands were broken with `TypeError: mod.handler is not a function`.

## 2.6.1 (2026-06-07)

### Fixes
- **`package.json` `files` field fixed**: added `commands/` and `src/` (was `"*.js"` which only matches root-level .js files, causing `ERR_MODULE_NOT_FOUND` for `pg marketplace` and other command imports)

### Reputation & Trust
- **calcPopularity rewritten**: `downloads * (rating+1)` → `log10(downloads+1) × normalized_rating × 100` with 180-day half-life time decay. Downloads no longer dominate quality.
- **Trust level now boosts search ranking**: `verified ×1.15`, `official ×1.10`, `trusted ×1.05`, `community ×1.0`, `unknown ×0.95` — applied in `applyRatingBoost()`
- **Popularity boost in search**: top 20% of skills by popularity get +5% score bump
- **Auto-promotion**: skills auto-graduate trust levels at 100 (`trusted`) / 1000 (`official`) / 10000 (`verified`) downloads
- **CLI `--trust` filter**: `pg search deploy --trust=verified` — filters results by trust level

### Improvements
- **HNSW is now default vector store** — was opt-in `PG_VECTOR_STORE=hnsw`, now default. Set `PG_VECTOR_STORE=flat` for brute-force fallback
- **MAX_CHUNKS raised 4 → 32** — long skill docs now keep much more context. Configurable via `PG_MAX_CHUNKS` env var
- **Reranker substantially improved**: bigram/trigram overlap, IDF-weighted TF scoring, exact phrase proximity boost, header position boost. Still heuristic (not a cross-encoder), but significantly smarter
- **Reranker candidate pool scaled**: `Math.max(50, topK × 6)` instead of hardcoded 20 — large `topK` queries no longer lose candidates
- **README fully synced** — architecture description, benchmarks, search modes, and env var reference now match the current hybrid/ANN/reranker reality
- **Architecture.md updated** — stale "flat by default" and "max 4 chunks" refs corrected to HNSW default and configurable chunk limit

## 2.6.0 (2026-06-07)

### Refactor
- **index.js split**: monolith (913 lines) → 12 modular `commands/*.js` files
- **Schema migrations**: ad-hoc ALTER TABLE → versioned `MIGRATIONS[]` with `_schema_version` table

### Quality
- **ESLint**: `.eslintrc` added (ESM, no-semicolons, strict equality rules)
- **Version sync**: hardcoded `'1.0.0'` in `index.js` → reads from `package.json`
- **spawnSync timeouts**: all git operations now have 15-60s timeouts (was: blocked Node.js on hang)
- **bundle-counts.js**: `httpsGet` string concat O(n²) → `chunks.push()` + timeout + error handling
- **Benchmarks**: `benchmarks/search-benchmark.js` and `benchmarks/index-benchmark.js` added

## 2.5.0 (2026-06-07)

### Features
- **Reranker layer**: hybrid search → top 20 → term-overlap reranker → top 5. Disable via `PG_RERANKER=0`
- **Trust system**: `verified` / `official` / `community` / `trusted` / `unknown` levels for registry entries
- **Reputation tracking**: `downloads`, `rating` (0-5), `popularity` per skill
- **Safety limits**: configurable max download size (50MB), file count (50000), repo size (500MB), extension whitelist
- **Rate limiter**: sliding window with serialized `acquire()` (TOCTOU-safe) for GitHub API and raw downloads
- **Batch indexing**: event-loop yield between batches to prevent memory exhaustion
- **External data isolation**: `sanitizeExternalContent()` strips null bytes, truncates oversized content, validates extensions

### Security
- **Rate limiter**: TOCTOU race condition fixed (promise-chain serialization)
- **Global mutable state**: `embedWeight`/`bm25Weight` in `search.js` → local `const` (fixes concurrent mutation in MCP server)
- **`sanitizeExternalContent`**: null-guard added (crash on `null`/`undefined`)
- **Prototype pollution**: `Object.assign(Object.create(null), ...)` in marketplace spread operations
- **tar CVE**: `overrides` bumped from `^6.2.1` → `^7.5.11` (6 known high-severity CVEs fixed)
- **Redirect loop**: `streamDownload` and `httpsGet` capped at 5 redirects
- **String concat DoS**: O(n²) `d += c` → O(n) `chunks.push(c)` + `join('')`
- **Query term limit**: reranker capped at 50 terms to prevent CPU exhaustion
- **Security.md**: private disclosure channel added (email + GitHub Advisories)

### Cleanup
- **`cluster.js`**, **`dedup.js`**: removed from source (were dead code — moved to `archive/` then deleted)
- **5 `console.error('DEBUG ...')` lines**: removed from `indexer.js` (were spamming MCP stderr)
- **Dead code**: `setHybridWeights()` and `adaptWeights()` removed (race condition vector)

### Bug Fixes
- **`indexBatch` not exported**: `api.js` could not call `update()` (runtime `TypeError`)
- **`BATCH_SIZE` from wrong module**: `api.js` imported from `embedder.js` where it doesn't exist
- **`api.js::index()`**: `BATCH_SIZE` now correctly imported from `config.js`

### Documentation
- `Architecture.md` — 13 layers, data flows, dependency map, 10 design decisions
- `CONTRIBUTING.md` — setup, tests, code style, PR process, skill publishing
- `Security.md` — 6-layer defense model, trust levels, vulnerability reporting
- `Benchmark.md` — metrics, perf testing methodology, future work
- `CHANGELOG.md` — this file

### Tests
- 14 test files, 256+ tests, all passing
- New: `tests/reranker.test.js` (8 tests), `tests/safety-limits.test.js` (24 tests)
- Coverage: security (validator-security), vector store, marketplace, safety limits

## 2.4.8 (2026-06-06)

- Path traversal guards in marketplace, api, validator
- Adaptive BM25 weights
- HNSW persistence (save/load/fromDir)
- Embedder queue cap (10000 calls)
- pruneInvalidRepos fix for Windows relative paths
