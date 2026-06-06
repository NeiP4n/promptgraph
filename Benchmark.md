# Benchmarks

## Current Benchmarks

Measured on real hardware (verification in progress — these are approximate):

| Operation | Result |
|-----------|--------|
| First-time index, 88 skills (cold ONNX) | 49.5 s |
| Reindex, 88 skills (unchanged, hash skip) | < 1 s |
| `pg reindex --fast`, 3000 files (keyword only) | ~30 s |
| `pg reindex` full embed, 3000 files | ~30 min |
| Semantic search query | < 50 ms |
| Model download (BGE-Small-EN-v1.5, one-time) | 23 MB |
| Embedding dimensions | 384 |
| Max chunks per skill | 2 |
| Embedding batch size | 256 |

> ONNX model initialization takes ~2-3 min on first startup and is cached in `~/.claude/.promptgraph/model-cache/`.

## How to Measure

### Indexing Time

```bash
# Full index with embeddings
time node index.js reindex

# Fast index (keyword-only, no embeddings)
time node index.js reindex --fast

# Incremental (unchanged files)
time node index.js reindex
```

### Search Latency

```bash
# Single search (using time or hyperfine)
time node index.js search "deploy kubernetes"

# With hyperfine (recommended)
npx hyperfine 'node index.js search "deploy api"'
npx hyperfine 'node index.js search "refactor react component"'
```

### Memory Usage

```bash
# Peak memory during reindex
node --max-old-space-size=4096 index.js reindex

# RSS after startup
node -e "const {search} = await import('./search.js'); setInterval(() => console.log(process.memoryUsage().rss / 1024 / 1024 + ' MB'), 1000)"
```

## Metrics Tracked

### Search Quality (manual)

- **Precision@K**: fraction of relevant results in top K
- **Recall@K**: fraction of all relevant results found in top K
- **Mean Reciprocal Rank (MRR)**: 1/rank of first relevant result, averaged over queries

To evaluate:

```bash
# Search for known skills and verify ranking
node index.js search "skill-name" 10
# Check: is the correct skill in top 1/3/5/10?
```

### Performance Metrics (automated)

- **Index time per 1000 files**: minutes per thousand skills
- **Search P50/P95 latency**: median and 95th percentile query time
- **Memory RSS**: resident set size during idle and search
- **DB size**: `~/.claude/.promptgraph/promptgraph.db` size per 1000 skills
- **ANN build time**: time to rebuild HNSW index
- **Reranker overhead**: extra latency from Reranker.rerank()

## Measurement Methodology

1. Warm up the ONNX model with one search query before timing
2. For search latency, run 10+ queries and report median
3. For indexing, start from clean DB (`rm -rf ~/.claude/.promptgraph/promptgraph.db`)
4. Record model cache state (cold vs warm ONNX)
5. Note hardware (CPU, RAM, disk type, OS)

## Benchmark Dataset

The `registry/training/` directory contains:
- `good/` — 22 example skill files (~400-2000 chars each)
- `bad/` — 55 non-skill documents (READMEs, changelogs, license files)

These are used for classifier training, not for search quality benchmarks. A dedicated search benchmark suite does not yet exist.

## Future Benchmark Work

- [ ] Automated precision/recall evaluation script
- [ ] Standard query set (20-50 queries with known expected results)
- [ ] Cross-encoder reranker quality comparison (current term-overlap vs BGE Reranker)
- [ ] HNSW vs Flat store performance comparison at various scales
- [ ] Index time breakdown (parsing vs embedding vs DB write vs ANN build)
- [ ] Memory profiling at 1000/5000/10000 skill scales

## Current Status

Benchmarks are in early stages. The README values above were measured on a single machine and may not generalize. Contributions welcome — add benchmark tests and share results.
