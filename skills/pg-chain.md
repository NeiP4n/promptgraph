---
name: pg-chain
description: Skill orchestrator — chains skills in a loop (search → execute → reassess → next) until the whole task is done
---

# PromptGraph Chain Orchestrator

Use this when a request needs **more than one skill** to finish — a multi-step task
where you execute one skill, then discover you need another, and another, until the
goal is met. Builds on the `pg` router (single lookup) by wrapping it in a controlled loop.

## The loop

```
1. PLAN      → restate the goal in one sentence + list the obvious sub-tasks.
2. SELECT    → take the next unfinished sub-task.
3. FIND      → pg_search(<sub-task in English keywords>).
                 score ≥ 0.60 → use the skill   |   score < 0.60 → handle directly (no skill).
4. CHAIN?    → pg_callees(<skill id>) — does this skill explicitly call others?
                 If yes, those are the next chain links (follow them before re-searching).
5. EXECUTE   → Read the skill file at `path` (MANDATORY), then run its instructions fully.
6. REASSESS  → Is the GOAL complete?
                 • Done            → STOP, summarize what was chained.
                 • Gap remains     → name the next sub-task, go to step 2.
                 • Stuck/no skill  → handle directly, or report the blocker and STOP.
```

## Stop conditions (hard — never skip)

The loop **must** terminate. Stop when ANY of these is true:

- **Goal met** — the original request is fully satisfied (state it explicitly).
- **Max 7 skill executions** in one chain. If you hit 7, stop and report progress + what's left.
- **No progress** — if a sub-task's skill ran but the goal didn't move closer, do NOT
  re-run the same skill. Mark it tried, pick a different approach or stop.
- **Repeat guard** — keep a list of executed skill ids. Never execute the same skill id
  twice for the same sub-task. Re-running a skill on identical input is a loop, not progress.
- **No match + can't proceed** — if `pg_search` < 0.60 and you can't handle it directly, stop and ask the user.

## State to track out loud

Keep a short visible ledger so the chain is auditable:

```
Goal: <one sentence>
Done: [skill-a ✓, skill-b ✓]
Now:  <current sub-task> → <skill being used>
Left: <remaining sub-tasks, or "none">
```

Update it after every EXECUTE step. This is what prevents silent infinite loops.

## Two ways skills connect

1. **Explicit chain** — a skill's file references another skill (e.g. `/run-tests`).
   `pg_callees` surfaces these. Follow declared chains first — the author intended them.
2. **Emergent need** — mid-task you realize you need something new. `pg_search` for it.
   This is where the orchestrator earns its keep.

Prefer explicit chains (deterministic) over emergent search (discovered) when both apply.

## Worked example

```
User: "Add a feature flag, then make sure nothing broke and write the commit."

Goal: ship a feature flag safely with a commit.
Done: []
Now:  add a feature flag → pg_search("add feature flag toggle config")
      → feature-flag (0.81) → Read → execute.   Done: [feature-flag ✓]
Reassess: code changed but untested.
Now:  verify nothing broke → pg_search("run tests verify no regression")
      → safe-verify (0.78) → Read → execute.    Done: [feature-flag ✓, safe-verify ✓]
Reassess: tests green, change not committed.
Now:  write commit → pg_search("write git commit message")
      → commit-message (0.91) → Read → execute.  Done: [..., commit-message ✓]
Reassess: GOAL MET → STOP.

Summary: chained feature-flag → safe-verify → commit-message (3 skills).
```

## When NOT to chain

- Single-skill tasks → just use `pg` (this orchestrator is overhead for one step).
- Pure-knowledge questions with no skill match → answer directly.
- If two sub-tasks are independent, you may do them in either order — don't invent
  false dependencies.

## Honesty rules

- A skill running ≠ the sub-task being done. Verify the **outcome**, then advance.
- If no skill fits a step, say so and handle it directly — do not force a low-score skill
  just to keep the chain going.
- Report the final chain (which skills, in what order) so the user can audit it.
