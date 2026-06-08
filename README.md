# PromptGraph

**Semantic skill router and marketplace for Claude Code, OpenCode, and more.**

Instead of loading every `.md` skill into context, Claude calls `pg_search` and loads only the skill it needs — saving 20k+ tokens per session.

[![npm](https://img.shields.io/npm/v/promptgraph-mcp?color=7C3AED&label=npm)](https://www.npmjs.com/package/promptgraph-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

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
pg setup <platform>     # Setup MCP config + skills dir for a platform
pg search <query>       # Semantic search across your skills
pg list                 # List all indexed skills
pg add <file>           # Add a skill file and index it
pg reindex              # Re-index all skills (with progress bar + ETA)
pg marketplace          # Browse community skill bundles (TUI)
pg install <id>         # Install a skill or bundle by ID
pg doctor               # Check database integrity
pg doctor --reset-dead  # Restore bundles hidden after install errors
pg update               # Update promptgraph-mcp to latest version
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
pg marketplace          # Interactive TUI browser
pg install pg-xxxxxx    # Install by bundle ID
```

Bundles marked with 🔧 include tool scripts (`.py`, `.sh`, `.js`) alongside `.md` skill files. Scripts are installed to the platform's skills directory and made executable automatically.

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

---

## Requirements

- Node.js ≥ 18
- ~45 MB disk for the embedding model (downloaded on first use)
