# PromptGraph

**Semantic skill router and marketplace for Claude Code.**

Instead of loading every `.md` skill into your context, Claude calls `pg_search` and loads only the one skill it needs.

[![npm](https://img.shields.io/npm/v/promptgraph-mcp?color=7C3AED&label=npm)](https://www.npmjs.com/package/promptgraph-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## How it works

```
pg_search("refactor without breaking tests")
  → embed query (BGE-Small-EN, 384-dim)
  → flat cosine similarity over in-memory index
  → return top skill path + snippet
  → Claude reads only that file
```

**Index:** SQLite + Float32 BLOB embeddings, flat cosine search in-memory.
No external vector DB, no API key, no cloud.

**File watcher:** `chokidar` detects `.md` changes and reindexes automatically (MCP server mode only).

---

## Benchmarks (measured on real hardware)

| Operation | Result |
|---|---|
| 88 new skills indexed (first time, cold ONNX) | **49.5 s** |
| 88 skills reindexed (unchanged, hash match) | **< 1 s** |
| `pg reindex --fast` (3000 files, keyword only) | **~30 s** |
| `pg reindex` full embed (3000 files) | **~30 min** |
| Semantic search query | **< 50 ms** |
| Model size (BGE-Small-EN-v1.5, one-time download) | **23 MB** |
| Embedding dimensions | **384** |
| Max chunks per skill | **2** |
| Embedding batch size | **256** |

> ONNX model initialization (~2–3 min) happens once on first use and is cached in `~/.claude/.promptgraph/model-cache/`.

---

## Quick Start

```bash
npm install -g promptgraph-mcp@latest
pg init
```

`pg init` downloads the model (~23 MB, once), indexes your local skills, and prints the config snippet.

### Claude Code (`~/.claude/settings.json`)

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

### Claude Desktop / Cursor / Windsurf / Cline

Same config — any MCP-compatible client works.

### OpenCode (`~/.config/opencode/opencode.json`)

```json
{
  "mcp": {
    "promptgraph": {
      "type": "local",
      "command": ["npx", "promptgraph-mcp"],
      "enabled": true
    }
  }
}
```

> `pg setup` auto-detects installed clients and writes config automatically.

---

## CLI

```bash
pg init                    # first-time setup
pg status                  # show indexed sources, repos, installed bundles
pg reindex                 # full reindex (semantic search, slow)
pg reindex --fast          # keyword-only reindex (~30s, no embeddings)
pg search "deploy"         # search from terminal
pg import owner/repo       # clone and index any GitHub repo of .md skills
pg marketplace             # browse skills by category
pg marketplace bundles     # browse curated bundles
pg bundle install <id>     # install a bundle
pg validate my-skill.md    # validate before publishing
pg doctor                  # clean orphaned DB rows
pg update                  # update to latest version
```

---

## Marketplace

```bash
pg marketplace             # 🛠 Engineering  💻 Coding  🤖 AI Tools  🔒 Security  🎨 Creative
pg marketplace Engineering # filter by category
pg marketplace bundles     # install whole repos as skill bundles
```

**Bundles** install an entire GitHub repo as a skill source — auto-detects `skills/`, `commands/`, `prompts/` subdirectory.

Example:
```bash
pg bundle install elementalsouls-claude-bughunter   # 88 security skills from GitHub
pg bundle install engineering-essentials            # 4 curated workflow skills
```

**Publish your skill** (auto-validated, no manual review):

Open an issue on [promptgraph-registry](https://github.com/NeiP4n/promptgraph-registry) with label `skill-submission`. The bot fetches, validates, commits, and closes the issue automatically.

Anti-spam checks: min 200 chars, 2+ headers, code/bullets required, prompt injection detection, duplicate URL/description check, 3 submissions per user per 24h.

---

## MCP Tools

Claude uses these automatically when the MCP server is running:

| Tool | What it does |
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

## Search modes

Search falls back to FTS5 automatically if no embeddings exist. When embeddings are
available, results are a hybrid of semantic similarity (embedding cosine) and keyword
relevance (BM25) — giving you the best of both approaches.

---

## Skill filtering

When importing a GitHub repo, PromptGraph:
1. Looks for a dedicated subdir (`skills/`, `commands/`, `prompts/`, `agents/`, `templates/`, etc.) — indexes only that dir if found with 2+ `.md` files
2. Falls back to repo root with content quality filter: min 150 chars, 2+ headers, must have code blocks or bullet points, skips readme/changelog/license/docs

---

## Requirements

- Node.js 18+
- Any MCP-compatible client (Claude Code, Claude Desktop, Cline, OpenCode, Cursor, Windsurf…)

---

## Related

- 📋 [promptgraph-registry](https://github.com/NeiP4n/promptgraph-registry) — community skill registry and auto-publish bot

---

*Built with [Claude Code](https://claude.com/claude-code).*
