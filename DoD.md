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
