# Changelog

## 2.9.45 (2026-06-11)

### Fixes
- **Scripts preserved on clone**: `cleanupRepoRoot` and `cleanupRepoDir` now keep `.py/.sh/.bash/.js/.ts/.rb` files instead of deleting them. Previously sparse-checkout fetched scripts but cleanup immediately deleted them.
- **`importFromGitHubLight` now clones scripts**: The light clone path (used by bundle install) was only fetching `*.md` files. Now also fetches `*.py/*.sh/*.js/*.ts/*.rb/*.bash` and makes them executable on unix after checkout.
- **Validator: invalid name → warning, not error**: Skills with `name: Commit Message` (uppercase/spaces) now pass validation with a warning and have their name derived from the filename. Previously they failed with an error causing "Downloaded skill failed validation" in the TUI.
- **`bundle add-repo` works for root-level repos**: `detectSkillsDirFromAPI` now returns `{ subdir: null, label: 'root' }` when a repo has .md files at root (no skills/ subdir). Previously it returned null and `bundle add-repo` bailed out.
- **GitHub token from gh CLI**: `httpsGet` now falls back to `gh auth token` when `GITHUB_TOKEN` env var is not set. Previously API calls failed silently (rate-limited at 60/hr) when the user was logged in via gh but hadn't set `GITHUB_TOKEN`.

### Features
- **`has_tools` auto-detect for installed bundles**: Marketplace TUI now detects script files in the cloned repo dir and shows 🔧 badge automatically, even if the registry entry doesn't have `has_tools: true`.
- **7 new bundles added to registry**: git workflow and Claude skills bundles — `netresearch/git-workflow-skill`, `SpillwaveSolutions/mastering-git-cli-agent-skill`, `softaworks/agent-toolkit`, `rockorager/skills`, `shinpr/claude-code-workflows`, `applied-artificial-intelligence/claude-code-toolkit`, `glebis/claude-skills`.

### Docs
- **README updated**: Fixed incorrect CLI commands (`pg add`, `pg list` don't exist as CLI). Added `pg status`, `pg import`, `pg bundle update/install/add-repo`. Added Features section, Publishing section, License. Improved Troubleshooting.

## 2.9.44 (2026-06-11)

### Changes
- **Publishing now requires an authenticated GitHub CLI**: `pg publish`, `pg bundle add-repo` (with and without `--push`), and the MCP tools `pg_marketplace_publish` / `pg_bundle_publish` now check `gh auth status` and refuse to publish unless `gh` is installed **and** signed in. The previous "no gh" manual-Gist fallback (which let anyone publish without an account) was removed; users without `gh` get an actionable error pointing to `gh auth login`. New `requireGhAuth()` export + 4 tests.
- **Hands-off publishing (no manual confirmation)**: Since `gh` is now guaranteed authenticated, publishing auto-submits the registry issue via `gh issue create` — the old "open browser → paste JSON → click Submit" step is gone. `publishBundle` files the issue with the bundle JSON inline (the format the registry bot reads); `publishSkill` files it with the Gist link. Both return the created `issue_url`. The manual browser/clipboard fallback in `pg bundle add-repo` was removed. +4 tests.

### Fixes
- **Marketplace bundles broken (critical)**: `localSkillCount()` referenced an unimported `SKILLS_STORE_DIR`, throwing a `ReferenceError`. **What broke**: listing bundles (`browseMarketplace`/`browseBundles`) returned `Registry unavailable` and repo-bundle installs reported a false failure after a successful clone. **Why**: only `getSkillsStoreDir` was imported from `config.js`. **How fixed**: resolve the github dir via `getSkillsStoreDir()`. Added regression tests for `localSkillCount`.

### Performance
- **Embedding cache + dedup (indexing)**: Embedding (the ONNX model) dominates indexing time on weak devices. Two layers cut it:
  - **Dedup** — identical chunk texts (common boilerplate across a skill collection) are embedded once and fanned back out. First-time indexing of a 200-chunk batch with 50 unique texts now runs the model 50 times, not 200.
  - **Persistent disk cache** (`~/.claude/.promptgraph/embed-cache.db`, content-addressed by `md5(model + text)`) — re-indexing unchanged content after a DB rebuild/migration runs the model **zero** times. Measured: a 200-text batch went 13.3s cold → **5ms** fully cached, with identical vectors.
  - Disable with `PG_NO_EMBED_CACHE=1`. Cache is model-tagged, so a model change invalidates it cleanly.
- **Indexing peak RAM cut ~3–7× (weak-device first index)**: onnxruntime's CPU memory arena scales ~linearly with the embedding batch, while CPU throughput is essentially batch-independent (~0.26 s/text either way). Measured: batch 16 → ~0.7 GB peak, 32 → ~1.2 GB, 64 → ~2.6 GB, 256 (the old default) → ~5.8 GB — all at the same wall-clock. The embed batch is now **16** by default, so a full first index holds ~0.85 GB on the real reindex path (was 2.6–5.8 GB) and no longer OOM/swaps a 2–4 GB machine. Override via `PG_EMBED_BATCH`. The embedding model is also released (`freeModel()`) before the ANN build so the two phases don't co-reside in memory.

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
