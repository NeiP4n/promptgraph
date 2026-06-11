# Definition of Done (DoD)

## Feature / Enhancement

- [ ] Code written, reviewed, and merged to main
- [ ] Tests added (unit or integration) — or skip reason documented
- [ ] CHANGELOG.md updated with user-facing change + rationale
- [ ] README.md updated if new command/flag/behavior
- [ ] MCP API changes documented in `.mcp.json`
- [ ] No breaking changes to CLI or config format (or major version bump if breaking)
- [ ] npm publish executed (version bump in package.json)
- [ ] Git tag created (optional, for major releases)
- [ ] No console errors or warnings on typical workflows

## Bug Fix

- [ ] Root cause identified and documented (comment/CHANGELOG)
- [ ] Fix applied to minimal scope (don't refactor)
- [ ] Reproduction test added (unit or manual steps in CHANGELOG)
- [ ] CHANGELOG.md updated with: **What broke**, **Why**, **How fixed**
- [ ] Version bump (patch release)
- [ ] npm publish
- [ ] Tested on Windows + macOS/Linux (if platform-specific)

## Chore / Docs / Internal

- [ ] Change merged to main
- [ ] No version bump needed (unless significant tooling change)
- [ ] CHANGELOG updated only if user-visible impact

---

## Token Optimization

**For Claude Code sessions:**
- Load CHANGELOG (recent 3 releases only) + DoD in context from session start
- Use `/context-compression` to summarize project state if context > 60%
- Avoid re-reading git history — trust git log output
- Use git blame sparingly; prefer grep for symbol search
- Batch independent file reads/writes in parallel tool calls
- For large files (>500 lines): read only relevant sections with grep/offset

**For long sessions (>50 tool calls):**
- Suggest `/compact` to prune context
- Use LAST_SESSION.md handoff file at session end
- Store unfinished tasks in LAST_SESSION.md for next session

---

## Release Checklist (Before npm publish)

1. [ ] All fixes tested locally
2. [ ] CHANGELOG updated
3. [ ] Package version bumped
4. [ ] `npm publish` successful
5. [ ] `git add + commit + push` to GitHub
6. [ ] Tag created if major release

---

## Known Bugs (Current Issues to Fix)

### 1. **TAR Module Export Error** (CRITICAL) ✅ FIXED
- **Status**: ✅ RESOLVED
- **Severity**: Was Critical (prevented test suite)
- **Location**: `fastembed` → `tar@7.5.16` incompatibility
- **Problem**: 
  - tar 7.x removed default export, uses named exports only
  - fastembed (or onnxruntime-node) tried to use default export
- **Fix Applied**: 
  - Downgraded tar to 6.2.1 in `package.json` overrides
  - ✅ All 264 tests now pass (was: 139 pass + 6 fail suites)
- **Resolution Date**: 2026-06-10
- **Note**: tar 6.2.1 has some security warnings but works; consider upgrading fastembed when it supports tar 7.x

### 2. **Vitest Mock Hoisting Warnings** (MEDIUM) ⚠️ PARTIAL
- **Status**: ⚠️ STILL WARNINGS (2 warnings)
- **Severity**: Medium (will be error in future vitest)
- **Location**: `tests/vector-store.test.js` lines 357, 370
- **Problem**: 
  - vi.mock('../db.js') calls nested inside it() blocks (not module-level)
  - Vitest 4.1.8 warns about this hoisting behavior
- **Impact**: Tests pass, but future vitest versions will error
- **Recommended Fix**: 
  - Move `vi.mock('../db.js')` to top-level before describe blocks
  - Use vi.mocked() inside it() blocks to change behavior per-test
- **Todo**: [ ] Refactor vector-store.test.js ANN Index tests (lines 356-378)

---

## Feature Ideas & Enhancements (Backlog)

### User Requests (Add here)
- [ ] **Feature**: [description]
  - **Why**: [user request/pain point]
  - **Complexity**: Low/Medium/High
  - **Blocks**: [other features if any]

### Performance Ideas
- [ ] **Parallel skill indexing**: Index multiple directories concurrently
  - **Why**: Large skill directories (1000+ files) take too long
  - **Current**: Sequential indexing via glob + chunking
  - **Idea**: Use Worker threads or Promise.all batches
  - **Complexity**: Medium

- [ ] **Embedding caching strategy**: Cache embeddings between sessions
  - **Why**: Re-indexing same skills repeatedly wastes compute
  - **Idea**: Hash-based cache in ~/.claude/.promptgraph/embedding-cache/
  - **Complexity**: Medium

- [ ] **Lazy-load embedder model**: Don't init FlagEmbedding until first search
  - **Why**: `pg` CLI commands that don't search (install, list, etc.) spend 2-3s loading model
  - **Current**: Model loaded on every `getEmbedder()` call
  - **Idea**: Lazy init only for search operations
  - **Complexity**: Low

### Feature Ideas
- [ ] **Skill ratings & usage stats**: Track which skills Claude actually uses
  - **Why**: Know which installed skills are dead weight
  - **Implementation**: Log tool_use events, aggregate in ~/.claude/.promptgraph/stats.json
  - **Complexity**: Medium

- [ ] **Skill versioning**: Support skill@version in config
  - **Why**: Pinned versions prevent silent breaking changes
  - **Current**: Always uses latest
  - **Idea**: tag system + registry metadata
  - **Complexity**: High

- [ ] **Skill dependency management**: If skill A requires skill B, auto-install B
  - **Why**: Currently must manually install transitive deps
  - **Complexity**: High

- [ ] **MCP-native skill loading**: Load skills directly as MCP resources
  - **Why**: Skills are already SKILL.md files; could be MCP-served
  - **Current**: pg loads via filesystem
  - **Idea**: Expose skills as MCP tool library
  - **Complexity**: High

### UX Ideas
- [ ] **Search result ranking by skill freshness**: Newer skills ranked higher
  - **Why**: Old deprecated skills often score high despite being abandoned
  - **Complexity**: Low

- [ ] **Interactive skill browser UI**: Web UI for browsing/installing skills
  - **Why**: CLI search feels clunky for discovery
  - **Current**: `pg search query` + manual install
  - **Complexity**: High

- [ ] **Skill preview before install**: Show first 200 chars of SKILL.md
  - **Why**: Users install skills blind, then regret
  - **Complexity**: Low

---

## Test Coverage Status

**Current**: ✅ **264 TESTS PASSING** (2026-06-10)
- ✅ All 14 test suites passing:
  - ✅ chunker.test.js
  - ✅ db.test.js
  - ✅ github-import.test.js
  - ✅ import-config-cleanup.test.js
  - ✅ indexing-chunk-ann.test.js
  - ✅ marketplace.test.js (fixed mock issue)
  - ✅ parser-score.test.js
  - ✅ parser.test.js
  - ✅ reranker.test.js
  - ✅ safety-limits.test.js
  - ✅ search-db-doctor.test.js
  - ✅ validator-security.test.js
  - ✅ validator.test.js
  - ✅ vector-store.test.js

**Remaining warnings**: 2 vitest hoisting warnings (non-blocking, fix recommended)

**Run tests**: 
```bash
npm test
# Result: Test Files  14 passed (14) | Tests  264 passed (264)
```
