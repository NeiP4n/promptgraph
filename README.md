# PromptGraph

**Semantic skill router and marketplace for Claude Code and OpenCode.**

Instead of loading every `.md` skill into context, Claude calls `pg_search` and loads only the skill it needs — saving 20k+ tokens per session.

[![npm](https://img.shields.io/npm/v/promptgraph-mcp?color=7C3AED&label=npm)](https://www.npmjs.com/package/promptgraph-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Installation

**Requirements:** Node.js 18+ — [nodejs.org](https://nodejs.org)

```bash
npm install -g promptgraph-mcp@latest
```

Check version:
```bash
pg --version
```

Update to latest:
```bash
pg update
# or
npm install -g promptgraph-mcp@latest
```

Uninstall:
```bash
npm uninstall -g promptgraph-mcp
```

---

## Quick Start

```bash
npm install -g promptgraph-mcp@latest
pg init
```

`pg init` auto-detects your installed editor, downloads the embedding model (~23 MB, once), indexes your skills, and writes the config automatically.

---

## Setup

### Claude Code

**Option 1 — auto (recommended):**
```bash
pg init
# or
pg setup claude-code
```

**Option 2 — manual.** Add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "promptgraph": {
      "command": "npx",
      "args": ["promptgraph-mcp"]
    }
  }
}
```

**Option 3 — official plugin:**
```
/plugin install promptgraph@claude-community
```

### OpenCode

**Option 1 — auto (recommended):**
```bash
pg init
# or
pg setup opencode
```

**Option 2 — manual.** Add to `~/.config/opencode/opencode.json`:
```json
{
  "plugin": ["promptgraph-mcp/plugin"]
}
```

### Other clients

| Client | Command |
|---|---|
| Claude Desktop | `pg setup claude-desktop` |
| Cursor | `pg setup cursor` |
| Windsurf | `pg setup windsurf` |
| Cline | `pg setup cline` |
| OpenAI Codex CLI | `pg setup codex` |

---

## Install skill bundles

```bash
pg install engineering-best-practices
pg install pg-000001
pg install "LLM Prompts"
```

Or browse interactively:
```bash
pg marketplace
```

---

## CLI

```bash
pg init                    # first-time setup (auto-detects editor)
pg setup <platform>        # register MCP in a specific editor
pg install <name>          # install a bundle by name, code, or id
pg marketplace             # browse + search + install (interactive TUI)
pg status                  # show indexed sources, repos, installed bundles
pg reindex                 # full reindex (semantic + keyword)
pg reindex --fast          # keyword-only reindex (~30 s)
pg search "deploy"         # search from terminal
pg import owner/repo       # import any GitHub repo of .md skills
pg bundle update           # update all installed bundles
pg validate my-skill.md    # validate before publishing
pg doctor                  # clean orphaned DB rows
pg update                  # update to latest version
```

---

## How it works

```
pg_search("refactor without breaking tests")
  → embed query (BGE-Small-EN, 384-dim)
  → HNSW ANN index — topK×4 candidates
  → BM25 FTS5 — topK×4 candidates
  → hybrid merge (cosine + BM25, adaptive weights)
  → term-overlap reranker (TF + header-position boost)
  → return topK skill paths + snippets
  → Claude reads only the files it needs
```

**Index:** SQLite + Float32 BLOB embeddings + HNSW. No external vector DB, no API key, no cloud.

---

## Marketplace

```bash
pg marketplace             # 🛠 Engineering  💻 Coding  🤖 AI  🔒 Security  🎨 Creative
pg marketplace bundles     # curated GitHub repos as skill bundles
```

**Bundles** clone a GitHub repo and index only the skill files — auto-detects `skills/`, `commands/`, `prompts/` subdirectory.

**Publish your skill** — open an issue on [promptgraph-registry](https://github.com/NeiP4n/promptgraph-registry) with label `skill-submission`. The bot validates, commits, and closes automatically.

---

## MCP Tools

Claude uses these automatically when the server is running:

| Tool | Description |
|---|---|
| `pg_search` | Semantic search by task description |
| `pg_list` | List all indexed skills |
| `pg_context` | Full skill details + callers/callees |
| `pg_callers` | Which skills reference this one |
| `pg_callees` | Which skills this one calls |
| `pg_impact` | What breaks if this skill changes |
| `pg_marketplace_browse` | Browse community registry |
| `pg_marketplace_install` | Install a skill by code or name |
| `pg_bundle_browse` | Browse skill bundles |
| `pg_bundle_install` | Install a bundle |
| `pg_top_rated` | Highest-rated skills |
| `pg_rate` | Rate a skill after use |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PG_VECTOR_STORE` | `hnsw` | `hnsw` (ANN) or `flat` (brute-force cosine) |
| `PG_RERANKER` | `1` | Term-overlap reranker — set `0` to disable |
| `PG_MAX_CHUNKS` | `8` | Max semantic chunks per skill file |

---

## Skill filtering

When importing a GitHub repo, PromptGraph:
1. Looks for a dedicated subdir (`skills/`, `commands/`, `prompts/`, `agents/`, etc.) — indexes only that if found
2. Falls back to repo root with a content quality filter: min 150 chars, 2+ headers, code blocks or bullets required, skips readme/changelog/license

---

## Benchmarks

| Operation | Result |
|---|---|
| 88 new skills (cold ONNX) | **49.5 s** |
| 88 skills (unchanged, hash match) | **< 1 s** |
| `pg reindex --fast` (3000 files) | **~30 s** |
| Semantic search (HNSW) | **< 50 ms** |
| Model size (BGE-Small-EN-v1.5, one-time) | **23 MB** |

---

## Requirements

- Node.js 18+
- Claude Code, OpenCode, Cursor, Windsurf, Cline, or any MCP-compatible client

---

## Related

- 📋 [promptgraph-registry](https://github.com/NeiP4n/promptgraph-registry) — community skill registry

---

*Built with [Claude Code](https://claude.com/claude-code).*
