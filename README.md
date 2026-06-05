# PromptGraph

**Stop burning 50,000 tokens on skills you won't use.**

PromptGraph is an MCP server that gives Claude Code a semantic skill index — vector search, skill graph, and a community marketplace. Instead of cramming every `.md` into your system prompt, Claude finds and loads only the one skill it needs.

[![npm](https://img.shields.io/npm/v/promptgraph-mcp?color=7C3AED&label=npm)](https://www.npmjs.com/package/promptgraph-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Why

Claude Code loads skill metadata from `~/.claude/commands/` each session. With 40+ skills that's thousands of tokens in routing overhead before you say a word. More importantly, when Claude loads and executes a full skill file (typically 1,000–5,000 tokens each), the cost multiplies fast.

PromptGraph replaces that with one tiny router skill (`~150 tokens`) and a local vector index. Claude calls `pg_search` → gets the right skill path + a content snippet → reads only that file when needed.

```
Before:  route across all 40 skills  →  40 × read overhead
After:   1 pg_search call + snippet  →  read only what you need
```

---

## Features

- 🔍 **Semantic search** — finds skills by meaning, not just keywords (HNSW, O(log N))
- 📦 **Marketplace** — browse and install community skills with one command
- 🧩 **Skill bundles** — install curated packs (e.g. `engineering-essentials`)
- 🔗 **Dependency graph** — tracks which skills call other skills (`pg_callers`, `pg_impact`)
- ⚡ **Local embeddings** — `fastembed` BGE-Small-EN, 23 MB, no API key needed
- 👁️ **File watcher** — auto-reindexes when you add or edit skills
- 🛡️ **Validator** — blocks malicious/junk skills before they reach your machine
- 🌐 **MCP-native** — works with Claude Code, Claude Desktop, Cline, OpenCode, Cursor, Windsurf, and any MCP client

---

## Quick Start

```bash
# one-time global install (recommended — faster than npx every time)
npm install -g promptgraph-mcp@latest
pg init

# or without installing
npx promptgraph-mcp init
```

`init` downloads the embedding model (~23 MB, once), indexes your skills, and prints the config to paste into `settings.json`.

### Add to Claude Code (`~/.claude/settings.json`)

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

### Add to OpenCode (`~/.config/opencode/opencode.json`)

```json
{
  "mcp": {
    "promptgraph": {
      "type": "local",
      "command": ["npx", "promptgraph-mcp", "mcp"],
      "enabled": true
    }
  }
}
```

> `pg setup` auto-detects OpenCode and writes this config for you.

### Move your skills out of `commands/`

```bash
mkdir -p ~/.claude/skills-store
mv ~/.claude/commands/*.md ~/.claude/skills-store/
mv ~/.claude/skills-store/pg.md ~/.claude/commands/   # keep only the router
```

---

## Marketplace

Browse and install community skills without leaving your terminal:

```bash
pg marketplace        # browse skills
pg marketplace bundles  # browse bundles
```

Or ask Claude directly:

```
install pg-a1b2c3          # by code
install systematic-debugging  # by name
```

**Publish your own skill:**

```bash
pg publish ~/.claude/skills-store/my-skill.md
```

> Skills are validated automatically — dangerous patterns, prompt injection, and junk are rejected by CI before they enter the registry.

---

## CLI

```bash
pg init             # first-time setup
pg reindex          # re-index all skills
pg search "deploy"  # search from terminal
pg list             # list all indexed skills
pg marketplace      # browse registry
pg import owner/repo   # import any GitHub repo full of .md skills
pg validate my-skill.md
pg doctor           # clean up orphaned data
```

---

## MCP Tools (used by Claude automatically)

| Tool | What it does |
|---|---|
| `pg_search` | Semantic skill search by task description |
| `pg_list` | List all indexed skills |
| `pg_context` | Full skill details + callers/callees |
| `pg_callers` | Which skills reference this one |
| `pg_callees` | Which skills this one calls |
| `pg_impact` | What breaks if this skill changes |
| `pg_marketplace_browse` | Browse community registry |
| `pg_marketplace_install` | Install a skill by code, id, or name |
| `pg_bundle_browse` | Browse skill bundles |
| `pg_bundle_install` | Install a bundle |
| `pg_top_rated` | Highest-rated local skills |
| `pg_rate` | Rate a skill (success/fail) |

---

## Token Savings

| | Before PromptGraph | After PromptGraph |
|---|---|---|
| Skills in system prompt | All 40+ every session | 1 router (~150 tokens) |
| Tokens per session | 20,000 – 50,000 | ~300 + 1 skill on demand |
| Skills you can have | ~30 before it gets painful | Unlimited |

---

## How It Works

```
pg_search("refactor without breaking tests")
  → embed query  →  HNSW ANN search  →  rank by cosine + rating boost
  → return top skill path
  → Claude reads only that file
```

Embeddings are stored in SQLite. The HNSW index ([vectra](https://github.com/Stevenic/vectra)) keeps search sub-millisecond even at thousands of skills. Skills are re-indexed automatically via `chokidar` file watcher.

---

## Requirements

- Node.js 18+
- Claude Code or Claude Desktop (any MCP-compatible client)

---

## Related

- 📋 [promptgraph-registry](https://github.com/NeiP4n/promptgraph-registry) — community skill registry

---

*Built with [Claude](https://claude.com/claude-code) by Anthropic.*
