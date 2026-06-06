# Contributing to PromptGraph

## Project Setup

```bash
git clone https://github.com/NeiP4n/promptgraph.git
cd promptgraph
npm install
```

Requires Node.js 18+. Some features need build tools (better-sqlite3, hnswlib-node) — if native compilation fails, install `windows-build-tools` (Windows) or `build-essential` (Linux).

## Running Tests

```bash
npm test                    # all tests (vitest)
npx vitest run              # same as above
npx vitest                  # watch mode
npx vitest run tests/search-db-doctor.test.js  # single file
npx vitest --coverage       # with coverage report
```

Tests use mocked SQLite (vi.mock) so they run without a real database or embedding model. No GPU required.

## Testing After Changes

Before submitting changes, verify the test suite passes:

```bash
npm test
```

If you add new functionality, add tests in `tests/` following the existing patterns (mocked DB, hoisted mock state, `vi.hoisted` for shared mocks).

## Running Locally

```bash
node index.js help          # CLI help
node index.js reindex       # index all skills
node index.js search "test" # search from terminal
node index.js               # start MCP server
```

Set `PG_VECTOR_STORE=hnsw` for HNSW vector index (requires `hnswlib-node`).

## Running Benchmarks

```bash
time node index.js reindex                         # full indexing time
time node index.js reindex --fast                  # keyword-only indexing
hyperfine 'node index.js search "deploy api"'       # search latency
```

Benchmarks depend on the number of indexed skills. See `Benchmark.md` for current measurements.

## Code Style

### Conventions

- **ESM modules only** — `import`/`export`, no `require()` (except `createRequire` for version checks)
- **No semicolons** — project convention
- **2-space indentation**
- **Single quotes** for strings
- **`async/await`** preferred over raw promises
- **No trailing commas** — except in multi-line arrays/objects
- **Early returns** for guard clauses
- **Destructuring** for imports (e.g. `import { getDb } from './db.js'`)

### Naming

| Construct | Convention | Example |
|-----------|-----------|---------|
| Variables | camelCase | `queryVec` |
| Functions | camelCase | `skillWithSnippet()` |
| Classes   | PascalCase | `FlatVectorStore` |
| Constants | UPPER_SNAKE | `MAX_FILE_SIZE` |
| Files     | kebab-case | `rate-limiter.js` |

### File Organization

- One main export per module (default or named)
- Internal helpers at module bottom
- Module-level constants at top
- Dynamic imports for heavy deps (fastembed, hnswlib-node, better-sqlite3)

## How to Add a New Skill

1. Create a `.md` file with frontmatter:

```markdown
---
name: my-skill
description: What this skill does (min 15 chars)
---

## Usage

Instructions here (min 200 chars).

## Steps

1. First step
2. Second step
```

2. Validate: `node index.js validate path/to/my-skill.md`

3. Place it in any indexed directory (`~/.claude/skills/`, `~/.claude/skills-store/`, etc.)

4. Reindex: `node index.js reindex`

Or publish to the marketplace (requires GitHub CLI):

```bash
node index.js marketplace publish path/to/my-skill.md
```

## How to Contribute Code

### PR Process

1. Open an issue describing the change (unless trivial)
2. Fork the repo
3. Create a feature branch: `git checkout -b feat/my-change`
4. Make changes following code style
5. Add/update tests
6. Run `npm test` (all tests must pass)
7. Commit with a descriptive message
8. Open a PR against `main`

### PR Checklist

- [ ] Tests pass (`npm test`)
- [ ] New code has tests (if applicable)
- [ ] No semicolons
- [ ] ESM imports only
- [ ] Lazy imports for heavy dependencies
- [ ] Console.error (not console.log) for server-mode messages
- [ ] No debugger statements or commented-out code

### What Gets Reviewed

- Correctness (does it work?)
- Safety (path traversal, input validation, rate limits)
- Performance (is the hot path efficient?)
- Code style (consistent with project conventions)

## Project Structure

```
index.js           — Entry point: CLI + MCP server
search.js          — Search pipeline (hybrid embed + BM25 + reranker)
indexer.js         — Indexing pipeline
db.js              — SQLite schema + connection
parser.js          — File parsing + frontmatter + reference extraction
embedder.js        — BGE-Small-EN ONNX embeddings
ann.js             — ANN vector index (bridges store layer)
chunker.js         — Semantic text chunking
config.js          — Config management + safety limits
marketplace.js     — Registry client + install/publish + trust system
validator.js       — Skill/bundle validation + security scanning
github-import.js   — GitHub repo import (sparse clone)
watcher.js         — File watcher for auto-reindex
doctor.js          — DB cleanup (orphaned rows)
api.js             — Public API wrapper
cli.js             — Terminal output helpers
tui.js             — Marketplace terminal UI
platform.js        — MCP platform auto-detection + config
src/
  store/           — Vector index (Flat / HNSW)
  filter/          — Content quality classifier
  reranker/        — Term-overlap reranker (replace with BGE cross-encoder)
  utils/           — Rate limiter
tests/             — Vitest test suite
```

## Adding a New Source Directory

```bash
# via MCP tool
pg_config action=add_source dir=/path/to/skills source=custom:my-skills

# then reindex
node index.js reindex
```
