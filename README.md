# PromptGraph

**Semantic skill router and marketplace for Claude Code, OpenCode, and more.**

Instead of loading every `.md` skill into context, Claude calls `pg_search` and loads only the skill it needs — saving 20k+ tokens per session.

[![npm](https://img.shields.io/npm/v/promptgraph-mcp?color=7C3AED&label=npm)](https://www.npmjs.com/package/promptgraph-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Features

- **Semantic search** — BGE-Small-EN embeddings, local, no API key required
- **Token savings** — loads one skill on demand instead of all `.md` files (~20k+ tokens/session)
- **Fast reindex** — persistent embed cache makes re-indexing unchanged skills near-instant
- **Low RAM** — first index uses ~0.85 GB (vs 5+ GB in older versions)
- **Marketplace** — browse and install community skill bundles via TUI or MCP tools
- **Publishing** — publish skills/bundles to the registry hands-off via GitHub CLI
- **Multi-platform** — Claude Code, OpenCode, Claude Desktop, Cursor, Windsurf, Cline, Codex

---

## Install

```bash
npm install -g promptgraph-mcp
```

## Quick start

```bash
pg setup claude-code      # Claude Code
pg setup opencode         # OpenCode (writes opencode.json MCP config)
pg setup claude-desktop   # Claude Desktop
pg setup cursor           # Cursor
```

`pg setup <platform>` does three things:
1. Writes the MCP server config for that platform
2. Sets the skills directory for that platform (e.g. `~/.config/opencode/skills`)
3. Runs a full index of your skills

Then restart your editor — the `promptgraph` MCP server will be available.

---

## Supported platforms

| Platform | Config written | Skills directory |
|---|---|---|
| `claude-code` | `~/.claude/settings.json` | `~/.claude/skills-store` |
| `claude-desktop` | `%APPDATA%/Claude/claude_desktop_config.json` | `~/.claude/skills-store` |
| `opencode` | `~/.config/opencode/opencode.json` | `~/.config/opencode/skills` |
| `cursor` | `.cursor/mcp.json` | `~/.cursor/skills` |
| `windsurf` | `.codeium/windsurf/mcp_config.json` | `~/.codeium/windsurf/skills` |
| `cline` | `.vscode/mcp.json` | `~/.vscode/skills` |
| `codex` | `~/.codex/config.yaml` | `~/.codex/skills` |

---

## CLI commands

```bash
# Setup & maintenance
pg setup <platform>             # Setup MCP config + skills dir for a platform
pg reindex                      # Re-index all skills (progress bar + ETA)
pg status                       # Show index health: sources, skill counts, DB path
pg doctor                       # Check database integrity
pg doctor --reset-dead          # Restore bundles hidden after install errors
pg update                       # Update promptgraph-mcp to latest version

# Search & discovery
pg search <query>               # Semantic search across your skills
pg marketplace                  # Browse community skill bundles (TUI)

# Install
pg install <id>                 # Install a skill by marketplace ID (pg-xxxxxx)
pg import <github-url>          # Import skills directly from a GitHub repo URL

# Bundles
pg bundle install <id>          # Install a bundle by ID
pg bundle update [repo]         # Pull latest from installed GitHub bundles
pg bundle add-repo <owner/repo> # Publish your GitHub repo to the registry (requires gh)
```

---

## OpenCode — `/pg` slash commands

After `pg setup opencode`, two slash commands are available inside OpenCode:

- `/pg <query>` — semantic search; returns the matching skill content
- `/pg-list` — lists all indexed skills

These are MCP prompts, not tools — they appear in the `/` command palette.

---

## Marketplace

Browse and install community skill bundles:

```bash
pg marketplace              # Interactive TUI browser
pg install pg-xxxxxx        # Install by bundle ID
pg bundle install pg-xxxxxx # Same, explicit subcommand form
```

Bundles marked with 🔧 include tool scripts (`.py`, `.sh`, `.js`) alongside `.md` skill files. Scripts are installed to the platform's skills directory and made executable automatically.

---

## Publishing

Publishing to the registry requires the [GitHub CLI](https://cli.github.com) signed in:

```bash
gh auth login               # one-time setup
```

**Publish your own skill:**
Use the `pg_marketplace_publish` MCP tool from inside Claude. It creates a Gist and automatically files a registry issue — no browser step, no paste.

**Publish a GitHub repo as a bundle:**
```bash
pg bundle add-repo <owner/repo>       # auto-submits registry issue
pg bundle add-repo <owner/repo> --push # same, with git push to the repo first
```

The registry bot reads the submitted JSON and publishes within minutes.

---

## Skill bundles with tools

A bundle can ship both skill files (`.md`) and tool scripts (`.py`, `.sh`, `.js`, etc.). When installed:
- All `.md` files go to the skills directory
- Script files are placed alongside them
- On Linux/macOS scripts are made executable (`chmod +x`)

Bundle authors: set `has_tools: true` and include `tool_files` entries in your bundle manifest.

---

## How it works

1. Your `.md` skills are embedded with BGE-Small-EN (fastembed, local, no API key)
2. Embeddings are stored in SQLite + HNSW index
3. When Claude calls `pg_search("refactor without breaking tests")`, only the matching skill is loaded into context
4. Skills are scored — `pg_top_rated` returns the best-performing ones

**Memory usage**: The first index uses ~0.85 GB RAM (batch=16 default). Override with `PG_EMBED_BATCH` if needed. Subsequent reindexes of unchanged content are near-instant thanks to a persistent embed cache.

---

## Troubleshooting

**Marketplace shows no bundles:**
```bash
pg doctor --reset-dead
```

**Reindex stuck / no progress:**
Progress bar with ETA appears automatically. First run downloads the embedding model (~45 MB).

**EBUSY error on `pg update`:**
Close any terminals running `pg` commands, then run `pg update` again.

**OpenCode not seeing MCP:**
Run `pg setup opencode` — it writes the correct `{ "type": "local", "command": ["cmd", "/c", "npx", "promptgraph-mcp"] }` entry to `~/.config/opencode/opencode.json`.

**Publishing fails with "gh auth":**
Install the [GitHub CLI](https://cli.github.com) and run `gh auth login`.

---

## Requirements

- Node.js ≥ 18
- ~45 MB disk for the embedding model (downloaded on first use)
- [GitHub CLI](https://cli.github.com) — only needed for publishing to the marketplace

---

## License

MIT
