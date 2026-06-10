# Changelog

## 2.9.43 (2026-06-10)

### Features
- **Auto-open browser + clipboard paste**: `pg bundle add-repo` now opens GitHub issue page in browser, copies issue body to clipboard. User just pastes (Ctrl+V) and submits.

### Fixes
- **pg bundle add-repo UX**: Compact JSON in issue URL to reduce length; Windows URL handling via PowerShell Start-Process to preserve `%` characters.
- **Bot: JSON code block parsing**: Registry bot now reads JSON from ```json...``` code blocks in issue body (format from `pg bundle publish`).
- **Bundle issue template**: Replaced .yml form with .md template to support URL pre-fill of issue body.

## 2.9.42 (2026-06-10)

### Fixes
- **Compact JSON in URLs**: Use minified JSON (no spaces) to reduce issue URL length for Windows terminal compatibility.

## 2.9.41 (2026-06-10)

### Fixes
- **Windows URL open**: Use PowerShell `Start-Process` instead of `cmd /c start` to preserve `%` characters in encoded URLs.

## 2.9.40 (2026-06-10)

### Features
- **Auto-open browser**: `pg bundle add-repo` automatically opens GitHub in browser after detecting gh CLI is not installed.

## 2.9.39 (2026-06-10)

### Improvements
- **UX clarity**: Updated `pg bundle add-repo` instructions to clarify that JSON is already pre-filled in the browser link.

## 2.9.38 (2026-06-10)

### Fixes
- **pg init removal**: Deleted `pg init` command entirely (was simplified to detect platform via `setup` handler).
- **README rewrite**: Full documentation of Quick Start, platform support table, OpenCode `/pg` slash commands, marketplace bundles with tools, troubleshooting.

## 2.9.37 (2026-06-10)

### Features
- **MCP prompts for OpenCode**: Added `/pg <query>` and `/pg-list` slash commands via MCP `ListPromptsRequestSchema` and `GetPromptRequestSchema`.
- **Platform-aware skills directories**: `pg setup <platform>` now sets platform-specific skills directory (`.claude/skills-store`, `.config/opencode/skills`, etc.).
- **Bundle tool files support**: Bundles can include `.py`, `.sh`, `.js` scripts alongside `.md` skills. Installer downloads and makes executable on Linux/macOS.
- **pg marketplace visibility**: Fixed `markDeadRepo` triggering on any validation error (was marking valid repos as dead). Now only on HTTP 404.

### Improvements
- **Embedding progress bar + ETA**: Added progress display during `pg reindex` with moving ETA (not frozen at 0s/1s). Separate timer tracks actual processing start time.
- **MAX_EMBEDDING_CALLS raised**: 10,000 → 1,000,000 to support large skill reindex without queue overflow.
- **EBUSY fix on pg update**: Use `wmic process where ... delete` instead of killing all node.exe (was killing the update process itself).

---

## History (< 2.9.37)

See git log for earlier versions. Older releases focused on: core indexing, HNSW vector store, trust levels, reranker, and marketplace bootstrap.
