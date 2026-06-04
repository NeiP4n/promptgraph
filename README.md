# PromptGraph

Semantic skill router for Claude Code. Instead of loading all your skills into context on every request, PromptGraph indexes them with vector embeddings and loads only the relevant one on demand.

## The Problem

Claude Code loads all `.md` files from `~/.claude/commands/` into the system prompt on every session. With 40+ skills, that's **20,000–50,000 tokens wasted per conversation** — before you've even said hello.

## The Solution

```
~/.claude/commands/
  pg.md          ← one tiny router skill (~150 tokens)

~/.claude/skills-store/
  game-audit.md
  chain.md
  hunt-sqli.md
  ...            ← 40+ skills, NOT loaded into context
```

When you ask Claude a question, it calls `pg_search("your task")` → finds the right skill via vector search → reads only that file. **One skill loaded instead of forty.**

## Features

- **Vector search** via `fastembed` (`BGE-Small-EN`, 23MB, runs locally, no API needed)
- **Semantic matching** — Russian query finds English skill, synonyms work
- **Auto-reindex** via file watcher when skills change
- **Graph edges** — tracks which skills call other skills
- **MCP server** — integrates directly into Claude Code and Claude Desktop

## Installation

### Via npx (recommended)

```bash
npx promptgraph-mcp init
```

### From source

```bash
git clone https://github.com/NeiP4n/promptgraph
cd promptgraph
npm install
npm link
promptgraph-mcp init
```

`init` will:
1. Ask for extra skill directories (optional)
2. Download the embedding model (~23MB, one time)
3. Index all your skills
4. Print the config snippet to add to `settings.json`

## Setup

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

### Claude Desktop

Add the same block to `claude_desktop_config.json`.

### Router skill (`~/.claude/commands/pg.md`)

```markdown
---
name: pg
description: PromptGraph router — finds and loads the right skill for any task
---

# PromptGraph Router

You have access to a semantic skill index via the `promptgraph` MCP server.

## How to handle any task

1. Call `pg_search` with the user's task as query (in English)
2. Pick the top result with score > 0.6
3. Read the skill file at the returned `path`
4. Execute that skill's instructions

## If no good match (score < 0.6)

Handle the task directly without a skill.
```

Move all your other skills from `commands/` to `skills-store/`:

```bash
mkdir -p ~/.claude/skills-store
mv ~/.claude/commands/*.md ~/.claude/skills-store/
mv ~/.claude/skills-store/pg.md ~/.claude/commands/
```

## Commands

```bash
promptgraph-mcp init      # First-time setup (interactive)
promptgraph-mcp reindex   # Re-index all skills
```

## MCP Tools

| Tool | Description |
|---|---|
| `pg_search` | Semantic search by task description |
| `pg_list` | List all indexed skills |
| `pg_context` | Full details for a skill |
| `pg_callers` | Which skills reference this one |
| `pg_callees` | Which skills this one references |
| `pg_impact` | What breaks if this skill changes |

## Token Savings

| | Before | After |
|---|---|---|
| Skills in context | All 40+ | 1 (router) |
| Tokens per session | ~20,000–50,000 | ~150 + 1 skill |

> **Search:** Uses HNSW index (via [vectra](https://github.com/Stevenic/vectra)) for O(log N) approximate nearest neighbor search. Falls back to brute-force on first run before index is built.

## File Structure

```
promptgraph/
  index.js       ← MCP server + CLI
  config.js      ← Config management
  db.js          ← SQLite setup
  embedder.js    ← fastembed wrapper
  indexer.js     ← Skill indexer
  parser.js      ← .md parser
  search.js      ← Vector search + graph queries
  watcher.js     ← File watcher (auto-reindex)

~/.claude/.promptgraph/
  promptgraph.db       ← SQLite index
  model-cache/         ← Embedding model cache
  config.json          ← Skill directory config
```

## Requirements

- Node.js 18+
- Claude Code or Claude Desktop

---

*Generated with [Claude](https://claude.ai) by Anthropic*
