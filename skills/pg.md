---
name: pg
description: PromptGraph router — finds and loads the right skill for any task
---

# PromptGraph Router

You have access to a semantic skill index via the `promptgraph` MCP server tools.

## Step-by-step for every task

1. **Translate** the user's request to English keywords (if needed)
2. **Call `pg_search`** with those keywords
3. **Evaluate results:**
   - score ≥ 0.75 → use it, high confidence
   - score 0.60–0.74 → use it, but stay alert if instructions feel off-topic
   - score < 0.60 → skip, handle the task directly
4. **Read the skill file** at the returned `path` using the Read tool — **MANDATORY. Do NOT skip this step even if the task seems obvious. Saying "using skill X" and then doing the task from memory is a protocol violation.**
5. **Execute** the skill's instructions fully

## Score thresholds

| Score | Action |
|---|---|
| ≥ 0.75 | Use skill, high confidence |
| 0.60–0.74 | Use skill, verify relevance |
| < 0.60 | Handle directly, no skill |

## Search query tips

- Write in English — the embedding model is English-only
- Use task-oriented phrases: "refactor without breaking tests", "debug memory leak", "write commit message"
- If first search returns low scores, try a shorter or more specific query

## Available MCP tools

| Tool | When to use |
|---|---|
| `pg_search` | Find a skill by task description — **always start here** |
| `pg_context` | Get full details + callers/callees for a known skill id |
| `pg_callers` | Which skills reference this one (dependency check) |
| `pg_callees` | Which skills this one calls (before executing a chain) |
| `pg_impact` | What breaks if a skill changes |
| `pg_list` | List all indexed skills (use when unsure what's available) |
| `pg_top_rated` | Best-rated skills by success/fail ratio |
| `pg_marketplace_browse` | Browse community registry |
| `pg_marketplace_install` | Install by code (`pg-xxxxxx`), id, or name |
| `pg_bundle_install` | Install a skill bundle |

## Skill sources indexed

- `~/.claude/commands/` — local command skills
- `~/.claude/skills-store/` — personal skills
- `~/.claude/skills-store/github/alirezarezvani-claude-skills` — 330+ engineering, product, marketing, compliance skills
- `~/.claude/skills-store/github/trailofbits-skills` — security research and audit skills
- `~/.claude/skills-store/github/OthmanAdi-planning-with-files` — project planning skills
- `~/.claude/skills-store/marketplace/` — installed community skills

## Examples

```
User: "отрефактори этот модуль без багов"
→ pg_search("safe refactor without breaking tests")
→ returns safe-refactor (score: 0.82) → Read → execute

User: "напиши commit message"
→ pg_search("write git commit message")
→ returns commit-message (score: 0.91) → Read → execute

User: "аудит безопасности кода"
→ pg_search("security audit vulnerability scan")
→ returns audit (score: 0.80) → Read → execute

User: "спланируй проект"
→ pg_search("project planning breakdown tasks")
→ returns planning skill → Read → execute
```

## If no skill matches (score < 0.60)

Handle the task directly with your own knowledge. Do not force a low-score skill.

## Multi-step tasks → use `pg-chain`

This router loads **one** skill. If the task needs several skills in sequence
(execute one → discover you need another → continue until done), switch to the
**`pg-chain`** orchestrator skill — it wraps this lookup in a controlled loop with
hard stop conditions. `pg` = single lookup; `pg-chain` = chained execution.
