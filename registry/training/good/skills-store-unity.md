# Next-Gen Unity Cognitive Orchestrator (NGUCO)

Central intelligence for **any** Unity 6 project. Claude is the sole reasoning core.
OpenCode agents are execution workers — they do not plan, reason globally, or own state.

Invoke: `/unity <topic>`

## System Rules (always enforced)

**OpenCode for large tasks:** Any task with `complexity: high` OR more than 3 parallel nodes MUST be dispatched through OpenCode agents, not handled by Claude directly. Claude reasons and plans — OpenCode executes.

**One OpenCode CLI:** Always use `--attach http://localhost:4100` to connect to the single running server. NEVER start multiple `opencode-cli serve` processes. All parallelism happens inside OpenCode via Task subagents — one CLI, unlimited agents.

**MCP Unity:** This project has MCP Unity available. Prefer MCP Unity tools for Editor operations (creating objects, running menu items, reading hierarchy, compiling) over writing YAML scene files manually. MCP tools are faster and don't require scene file parsing.

**Free models — use in order of task type:**
| Task | Model |
|---|---|
| Orchestration, simulation, planning dispatch | `opencode/big-pickle` |
| Research, web search, validation, asset work | `opencode/qwen3.6-plus-free` |
| C# code generation, repair, logic | `opencode/deepseek-v4-flash-free` |
| Fast checks, world state, build | `opencode/qwen3.6-plus-free` |

---

## Maturity Levels

Every request targets a maturity level. Default: **Level 4 (Production-Ready)**.

| Level | Name | What it means |
|---|---|---|
| 0 | Snippet | Throwaway function, no context |
| 1 | Example | Tutorial code, hardcoded values |
| 2 | Prototype | Functional but fragile, no abstraction |
| 3 | MVP | Working feature, basic tests, minimal error handling |
| 4 | Production-Ready | Abstracted, tested, documented, error-handled |
| 5 | Scalable | DI, full test suite, performance budgeted, CI/CD |
| 6 | Enterprise | Versioned APIs, backward compat, audit trail |

**Enforcement per level:**
- Level ≤ 2: No gates. Quick execution.
- Level 3: production-critic only.
- Level ≥ 4: Full pipeline — maturity-classifier → depth-expander → system-designer → interface-generator → coder → testing-enforcer → production-critic.
- Level ≥ 5: Add multi-pass-planner before execution.

## Anti-Demo Rules (ABSOLUTE — never override)

These rules exist because LLMs default to tutorial/demo quality. They must never be bypassed.

**NEVER:**
- Create a MonoBehaviour that owns more than one game system
- Write hardcoded string/object references (`Find("Player")`, `FindObjectOfType`)
- Skip interface definitions for any public system contract
- Write `TODO`, `FIXME`, or `NotImplementedException` in implementation code
- Create "placeholder" logic that isn't real logic
- Simplify core systems to make them "easier to understand"
- Skip serialization for any runtime state that should persist
- Skip error handling in any public method
- Use `Resources.Load` at runtime
- Create a script without a namespace

**ALWAYS:**
- Design systems, not scripts
- Define interfaces before implementation
- Write tests alongside implementation
- Handle failure paths explicitly
- Document public APIs with XML comments
- Put persistence design in the SDD before any code
- Think about extensibility (can another developer add a feature without touching this class?)

---

## PHASE 0 — Bootstrap

### 0.1 Confirm Unity project
```bash
ls Assets/ 2>/dev/null && echo "UNITY_PROJECT" || echo "NOT_UNITY"
```
If NOT_UNITY → stop. Tell user: "Open Claude Code from the Unity project folder (the one containing Assets/)."

### 0.2 Get project name
```bash
basename "$(pwd)"
```

### 0.3 Check world state
```bash
ls .project-state/WORLD_STATE.json 2>/dev/null && echo "INITIALIZED" || echo "FIRST_RUN"
```

If FIRST_RUN → run **First-Run Setup** below, then continue.

### 0.4 Check OpenCode server
```bash
curl -s http://localhost:4100/health 2>&1 | head -1
```
If not responding → tell user:
> OpenCode server not running. Open this project in VSCode (it auto-starts), or run: `opencode-cli serve --port 4100`
Then stop.

### 0.5 Check MCP Unity
Check if the Unity MCP server is reachable:
```powershell
try { (Invoke-WebRequest -Uri "http://localhost:27112/mcp" -UseBasicParsing -TimeoutSec 2).StatusCode } catch { $_.Exception.Response.StatusCode }
```
- Response `200` or `406` → MCP Unity **CONNECTED** — set `MCP_UNITY=true`
- Timeout / connection refused → MCP Unity **UNAVAILABLE**

If UNAVAILABLE → try starting the server:
```powershell
$exe = Get-ChildItem ".\Library\mcp-server\win-x64\unity-mcp-server.exe" -ErrorAction SilentlyContinue
if ($exe) { Start-Process $exe.FullName -WorkingDirectory $exe.DirectoryName -WindowStyle Hidden; Start-Sleep 3 }
```
Re-check. If still unavailable → continue without MCP (OpenCode scene-tool fallback).

Note MCP Unity status in session: `MCP Unity: CONNECTED | UNAVAILABLE`

### 0.6 If world state exists but LAST_INDEXED is NOT_GENERATED_YET → index now
```bash
opencode-cli run --attach http://localhost:4100 --agent world-state-manager \
  "Index this Unity project. Scan all .cs files in Assets/, extract: class names, public/serialized fields, MonoBehaviour types, ScriptableObject types, event declarations, Addressable references, scene names from Assets/Scenes/. Scan Packages/manifest.json for installed packages. Write complete WORLD_STATE.json to .project-state/WORLD_STATE.json. Set LAST_INDEXED to current ISO timestamp."
```

---

## First-Run Setup

```bash
mkdir -p .project-state/RESULTS .project-state/MEMORY
```

Create `.project-state/WORLD_STATE.json`:
```json
{
  "project": { "name": "PLACEHOLDER", "phase": "PROTOTYPE", "lastUpdated": "", "lastIndexed": "NOT_GENERATED_YET" },
  "sceneGraph": { "hierarchy": [], "transforms": {}, "components": {} },
  "gameplayGraph": { "systems": [], "triggers": [], "aiStates": {} },
  "physicsGraph": { "colliders": [], "navmesh": { "baked": false, "agents": [] } },
  "renderingGraph": { "pipeline": "URP", "materials": [], "lights": [], "postProcessing": {} },
  "assetManifest": { "prefabs": [], "textures": [], "audio": [], "addressableGroups": [] },
  "dependencyGraph": { "scripts": {}, "packages": [] },
  "performanceMetrics": { "drawCalls": 0, "triangleCount": 0, "memoryMB": 0, "targetFPS": 60 },
  "codeQualityMetrics": {
    "avgClassLines": 0,
    "maxClassLines": 0,
    "interfaceCoverageRatio": 0,
    "namespaceCoverageRatio": 0,
    "xmlDocCoverageRatio": 0,
    "testRatio": 0,
    "todoCount": 0,
    "hardcodedStringCount": 0,
    "avgMethodLines": 0
  },
  "architectureMemory": { "systems": [], "decisions": [], "constraints": [], "patterns": [] },
  "designGoals": { "primaryGoal": "", "secondaryGoals": [], "nonGoals": [], "maturityTarget": 4 },
  "technicalConstraints": { "platforms": [], "maxDrawCalls": 0, "maxMemoryMB": 0, "targetFPS": 60, "bannedPatterns": [] },
  "systemContracts": [],
  "passHistory": [],
  "openIssues": [],
  "lastSimulation": null,
  "lastValidation": null
}
```
Replace `PLACEHOLDER` with the actual project name.

Create `.project-state/TASK_GRAPH.json`:
```json
{ "session": "", "intent": {}, "nodes": [], "status": "idle" }
```

Create `.project-state/VALIDATION_RESULTS.json`:
```json
{ "timestamp": "", "overall": "NONE", "categories": {} }
```

Create `.project-state/SIMULATION_RESULTS.json`:
```json
{ "timestamp": "", "verdict": "NONE", "risks": [], "predictions": {} }
```

Create `.project-state/MEMORY/semantic.md`:
```
# Semantic Memory
_Concepts, patterns, reusable logic discovered in this project._
```

Create `.project-state/MEMORY/episodic.md`:
```
# Episodic Memory
_Session history: what was built, what failed, what was repaired._
```

Create `.project-state/MEMORY/procedural.md`:
```
# Procedural Memory
_Reusable workflows discovered during execution._
```

Create `opencode.json` (if missing):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/qwen3.6-plus-free",
  "instructions": [".opencode/rules.md"]
}
```
Note: `opencode/big-pickle`, `opencode/qwen3.6-plus-free`, `opencode/deepseek-v4-flash-free` are all free OpenCode models. Agents can override with `model:` in their frontmatter. Do NOT add plugins — they slow down every startup.

Create `.mcp.json` (if missing):
```json
{
  "mcpServers": {
    "ai-game-developer": {
      "type": "http",
      "url": "http://localhost:8080"
    }
  }
}
```

Copy agent definitions:
```bash
mkdir -p .opencode/agents
cp "C:/Users/Sasha/.claude/plugins/unity-dev/templates/agents/"* .opencode/agents/
```

Copy VSCode config:
```bash
mkdir -p .vscode
cp "C:/Users/Sasha/.claude/plugins/unity-dev/templates/.vscode/settings.json" .vscode/settings.json
```

Create `.vscode/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Unity MCP: Start Server",
      "type": "shell",
      "command": "${workspaceFolder}/Library/mcp-server/win-x64/unity-mcp-server.exe",
      "options": { "cwd": "${workspaceFolder}/Library/mcp-server/win-x64" },
      "runOptions": { "runOn": "folderOpen" },
      "isBackground": true,
      "presentation": { "reveal": "silent", "panel": "dedicated", "tab": "Unity MCP" },
      "problemMatcher": { "pattern": { "regexp": "^$" }, "background": { "activeOnStart": true, "beginsPattern": ".", "endsPattern": "Start listening" } }
    },
    {
      "label": "OpenCode: Start Server",
      "type": "shell",
      "command": "C:\\Users\\Sasha\\AppData\\Local\\OpenCode\\opencode-cli.exe serve --port 4100",
      "options": { "cwd": "${workspaceFolder}" },
      "runOptions": { "runOn": "folderOpen" },
      "isBackground": true,
      "presentation": { "reveal": "silent", "panel": "dedicated", "tab": "OpenCode" },
      "problemMatcher": {
        "pattern": { "regexp": "^$" },
        "background": { "activeOnStart": true, "beginsPattern": ".", "endsPattern": "Listening" }
      }
    }
  ]
}
```

Tell user: "First-run setup complete. Reload VSCode (Ctrl+Shift+P → Reload Window). Then run `/unity <topic>` again."
Stop here.

---

## PHASE 1 — Intent Interpreter

**Claude does this reasoning directly. No agent call.**

Parse `$ARGUMENTS` into structured intent. Output:
```json
{
  "topic": "<original text>",
  "domain": "<environment|gameplay|systems|visual|audio|build|fix|optimize>",
  "actions": ["create|fix|optimize|refactor|delete"],
  "requiredSystems": ["navmesh|inventory|spawner|ai|physics|audio|ui|..."],
  "visualRequirements": ["fog|rain|neon|lighting|shadows|postfx|..."],
  "aiRequirements": ["patrol|traffic|crowd|combat|perception|..."],
  "constraints": {
    "targetPlatform": "PC|Mobile|Console|WebGL",
    "perfBudget": { "drawCallsMax": 300, "memoryMaxMB": 1024, "targetFPS": 60 }
  },
  "complexity": "low|medium|high",
  "riskLevel": "low|medium|high"
}
```

Rules for complexity/risk:
- `low`: single system, no new dependencies, < 5 files
- `medium`: 2-4 systems, moderate dependencies
- `high`: 5+ systems, new architecture, cross-system dependencies

Print the parsed intent before continuing.

---

## PHASE 1B — Maturity Classification

**Claude dispatches immediately after Phase 1.**

```bash
opencode-cli run --attach http://localhost:4100 --agent maturity-classifier \
  "<topic from $ARGUMENTS>. Classify target maturity and return Development Intent JSON. Do NOT use the Task tool."
```

Claude reads the Development Intent JSON. Stores `target_maturity` and `enforcement_gates` for this session.

**If target_maturity ≤ 2:** Skip Phases 1C, 1D, 3B, 7B. Go directly to Phase 3 (Task Graph).
**If target_maturity = 3:** Skip 1C, 1D, 3B. Run production-critic in Phase 7B only.
**If target_maturity ≥ 4:** Run full pipeline including 1C, 1D, 3B, 7B.

## PHASE 1C — Depth Expansion (maturity ≥ 4 only)

**Claude dispatches depth-expander to reveal full system scope.**

```bash
opencode-cli run --attach http://localhost:4100 --agent depth-expander \
  "<topic>. Read WORLD_STATE.json. Expand to full subsystem map, interfaces, events, dependencies, persistence, testing. Do NOT use the Task tool."
```

Claude reads the expansion JSON. This drives the Task Graph in Phase 3 — every subsystem in the expansion becomes a node.

**Scope guard:** If depth-expander reveals > 15 subsystems, Claude checks with user: "This system has N subsystems. Should I implement all in this session, or prioritize a subset?"

## PHASE 1D — Architecture Gate (maturity ≥ 4 only)

**Claude dispatches architecture-enforcer to check if architecture exists.**

```bash
opencode-cli run --attach http://localhost:4100 --agent architecture-enforcer \
  "<topic>. Read depth-expander output and WORLD_STATE.json systemContracts. Produce SDD or verify existing one. Do NOT use the Task tool."
```

If architecture-enforcer returns PRODUCING ARCHITECTURE → Claude dispatches system-designer:
```bash
opencode-cli run --attach http://localhost:4100 --agent system-designer \
  "<topic>. Read depth-expander output. Write complete SDD to .project-state/DESIGNS/<feature>-SDD.md. Do NOT use the Task tool."
```

Then interface-generator:
```bash
opencode-cli run --attach http://localhost:4100 --agent interface-generator \
  "Read .project-state/DESIGNS/<feature>-SDD.md. Write all interface .cs files to Assets/Scripts/<System>/Interfaces/. Do NOT use the Task tool."
```

**Architecture gate is hard:** Claude does NOT proceed to implementation until architecture-enforcer returns APPROVED.

---

## PHASE 2 — World State Load

**Claude reads directly.**

```bash
cat .project-state/WORLD_STATE.json
cat .project-state/MEMORY/episodic.md
cat .project-state/MEMORY/semantic.md
```

From these, Claude determines:
- What systems already exist (avoid rebuilding)
- Current performance baseline (drawCalls, memoryMB)
- Past failures in this area (from episodic memory)
- Known patterns for this domain (from semantic memory)
- Any open issues that intersect this task

Print a 3-5 line **World State Summary** before continuing.

---

## PHASE 3 — Task Graph Construction

**Claude builds the DAG directly. No agent call.**

Build `TASK_GRAPH.json` based on intent + world state. Rules:
- Only include tasks for things that don't already exist in world state
- Assign correct agent per task type (see routing table below)
- Dependencies must be explicit — no implicit ordering
- Parallel nodes (same dep depth) will be dispatched simultaneously

Agent routing table:
| Task type | Agent | Model |
|---|---|---|
| Scene hierarchy, placement, terrain, navmesh, lighting | `scene-tool` | `opencode/big-pickle` |
| C# scripts, systems, gameplay logic, shaders | `coder` | `opencode/deepseek-v4-flash-free` |
| Asset import, optimize, LOD, atlas | `asset-tool` | `opencode/qwen3.6-plus-free` |
| Build, CI/CD, platform pipeline | `build-tool` | `opencode/qwen3.6-plus-free` |
| Performance profiling, metrics collection | `analytics-tool` | `opencode/qwen3.6-plus-free` |
| Constraint check | `constraint-validator` | `opencode/qwen3.6-plus-free` |
| Simulation | `simulation-engine` | `opencode/big-pickle` |
| World state read/write | `world-state-manager` | `opencode/qwen3.6-plus-free` |
| Repair | `repair-engine` | `opencode/deepseek-v4-flash-free` |

**MCP Unity first:** Before any `scene-tool` node runs, check if MCP Unity is connected. If yes — `scene-tool` uses MCP Unity tools (create objects, modify transforms, add components, run Editor menu items) instead of writing YAML. This is the preferred path.

**Large task rule:** If `complexity: high` OR node count > 5 → wrap all execution dispatch in `unity-orchestrator` so it fans out as Task subagents. Claude never directly calls 5+ sequential `opencode-cli run` commands.

Write the task graph:
```bash
# Claude writes this file with actual node content based on intent
cat > .project-state/TASK_GRAPH.json << 'EOF'
{
  "session": "<ISO timestamp>",
  "intent": <parsed intent JSON>,
  "nodes": [
    { "id": "<id>", "agent": "<agent>", "task": "<specific instruction>", "deps": [], "status": "pending" }
  ],
  "status": "planning"
}
EOF
```

Print the DAG structure (node ids and dep relationships) before continuing.

---

## PHASE 3B — Multi-Pass Planning (maturity ≥ 5 OR complexity: high)

When `target_maturity ≥ 5` or `complexity: high` — dispatch multi-pass-planner before execution:

```bash
opencode-cli run --attach http://localhost:4100 --agent multi-pass-planner \
  "<topic>. Read depth-expander output and SDD. Generate 7-pass plan. Write to .project-state/DESIGNS/<feature>-PASSES.md. Do NOT use the Task tool."
```

Claude reads the pass plan. The Task Graph in Phase 3 is built from Pass 4 (implementation) nodes. Passes 1-3 are already complete (done in Phases 1C-1D). Passes 5-7 are appended after execution.

For maturity ≤ 4, skip 3B — single-pass execution is sufficient.

---

## PHASE 4 — Pre-Execution Constraint Validation

Before touching any project files, validate the plan.

```bash
opencode-cli run --attach http://localhost:4100 --agent constraint-validator \
  "Pre-execution validation. Read .project-state/TASK_GRAPH.json and .project-state/WORLD_STATE.json. Check: (1) Scene constraints — will any planned objects cause collider overlaps? (2) Performance constraints — will planned asset additions exceed drawCallsMax or memoryMaxMB in performanceMetrics.perfBudget? (3) Dependency constraints — do all planned scripts reference systems that exist or will exist in this task graph? (4) Navmesh prerequisite — any AI spawner task requires a navmesh task as dependency. Write .project-state/VALIDATION_RESULTS.json with overall: PASS|WARN|FAIL and per-category details."
```

Read `.project-state/VALIDATION_RESULTS.json`.

Decision:
- `PASS` → continue to Phase 5
- `WARN` → log warnings in world state open issues, continue with caution
- `FAIL` → revise TASK_GRAPH.json to fix violations, re-run Phase 4 (max 2 retries), then continue

---

## PHASE 5 — Simulation

Predict consequences before execution.

```bash
opencode-cli run --attach http://localhost:4100 --agent simulation-engine \
  "Simulate execution of .project-state/TASK_GRAPH.json against .project-state/WORLD_STATE.json. Predict: (1) Performance impact — estimate draw call delta and memory delta from planned asset additions and new systems. (2) Conflict detection — detect any two planned objects that would occupy overlapping transforms. (3) AI reachability — verify all planned AI spawners will have navmesh coverage after navmesh tasks complete. (4) Physics validity — check planned collider configurations for validity. Write .project-state/SIMULATION_RESULTS.json with verdict SAFE|RISKY|BLOCKED, risk notes per category, and predictions object."
```

Read `.project-state/SIMULATION_RESULTS.json`.

Decision:
- `SAFE` → proceed to Phase 6
- `RISKY` → append risks to WORLD_STATE.json openIssues, proceed with caution, flag risks in final report
- `BLOCKED` → **HARD STOP**. Report blocker to user with full diagnosis from SIMULATION_RESULTS.json. Do not proceed.

---

## PHASE 6 — Execution Dispatch

Execute the Task Graph level-by-level. A "level" is all nodes whose dependencies are already COMPLETE.

**For each level:**

1. Identify all nodes at this level (deps all COMPLETE or level 0)
2. If single node → dispatch directly:
```bash
opencode-cli run --attach http://localhost:4100 --agent <agent> \
  "<task instruction from node>. Read .project-state/WORLD_STATE.json for project context. Write result to .project-state/RESULTS/<node-id>-<timestamp>.md with STATUS: PASS|FAIL|BLOCKED at the top."
```

3. If multiple parallel nodes → dispatch via unity-orchestrator:
```bash
opencode-cli run --attach http://localhost:4100 --agent unity-orchestrator \
  "Dispatch these parallel nodes as independent Task subagents. Each reads WORLD_STATE.json, executes its job, writes result to .project-state/RESULTS/<node-id>-<timestamp>.md with STATUS: PASS|FAIL|BLOCKED. Nodes: <JSON array of nodes at this level>"
```

4. After level completes — Claude reads ALL result files for this level:
```bash
ls .project-state/RESULTS/ | tail -<N>   # N = nodes in this level
cat .project-state/RESULTS/<result-file>
```

5. Update world state via world-state-manager:
```bash
opencode-cli run --attach http://localhost:4100 --agent world-state-manager \
  "Merge results from these files into WORLD_STATE.json: <list of result files>. Update sceneGraph, assetManifest, dependencyGraph, performanceMetrics as indicated in each result. Mark these task graph nodes as COMPLETE in TASK_GRAPH.json: <node ids>"
```

6. If any node STATUS: FAIL → add to repair list, continue with remaining levels
7. If any node STATUS: BLOCKED → stop level, report blocker, ask user for input

**RISK: HIGH rule:** If `riskLevel` is HIGH in intent, Claude reads every result file's full diff section personally before reporting progress.

---

## PHASE 7 — Post-Execution Verification

After all levels complete, run full verification pass.

```bash
opencode-cli run --attach http://localhost:4100 --agent constraint-validator \
  "Full post-execution verification pass. Read .project-state/WORLD_STATE.json. Check all constraint categories: (1) Compile validity — scan Assets/Scripts/ for missing using directives, unresolved type references, broken [SerializeField] types. (2) Scene validity — no broken prefab references, no missing MonoBehaviour scripts on GameObjects, no overlapping colliders. (3) Gameplay validity — all AI spawner components have navmesh coverage, all trigger zones have registered handlers, no unreachable game states. (4) Performance validity — current metrics within perfBudget thresholds. Write .project-state/VALIDATION_RESULTS.json with full detail per failure."
```

Read `.project-state/VALIDATION_RESULTS.json`.

Collect all `FAIL` items → build repair list.

---

## PHASE 7B — Production Critic (maturity ≥ 3)

After verification, run production-critic regardless of constraint-validator result:

```bash
opencode-cli run --attach http://localhost:4100 --agent production-critic \
  "Review all files changed in this session. Check for: god classes, missing interfaces, hardcoded references, missing tests, missing namespaces, missing error handling. Read WORLD_STATE.json for context. Do NOT use the Task tool."
```

Claude reads verdict:
- `APPROVE` → proceed to Phase 8 (Reflection/Repair for technical issues only)
- `REJECT` → add all BLOCKER items to repair list with type `architecture`, then run repair-engine before Phase 8

Architecture repair via repair-engine:
```bash
opencode-cli run --attach http://localhost:4100 --agent repair-engine \
  "Repair architecture failure: <blocker description>. Type: architecture. Read WORLD_STATE.json. Apply fix: extract interface, remove hardcoded reference, add namespace, add error handling. Do NOT use the Task tool."
```

After architecture repairs → re-run production-critic. If still REJECT after 2 iterations → surface to user with diagnosis.

**Testing pass (maturity ≥ 4 only):**
```bash
opencode-cli run --attach http://localhost:4100 --agent testing-enforcer \
  "Generate tests for all systems implemented in this session. Read SDD from .project-state/DESIGNS/. Target coverage: <from Development Intent>. Do NOT use the Task tool."
```

---

## PHASE 8 — Reflection / Repair Loop

For each item in repair list, dispatch repair-engine. Max **3 repair iterations total**.

```bash
opencode-cli run --attach http://localhost:4100 --agent repair-engine \
  "Repair this failure: <failure description from VALIDATION_RESULTS>. Failure type: <compile|scene|dependency|performance|gameplay>. Read .project-state/WORLD_STATE.json for full project context. Apply targeted fix only — do not touch unrelated systems. Write result to .project-state/RESULTS/repair-<id>-<timestamp>.md with STATUS: REPAIRED|NEEDS_HUMAN and root cause analysis."
```

After each repair batch → re-run constraint-validator for affected subsystem only:
```bash
opencode-cli run --attach http://localhost:4100 --agent constraint-validator \
  "Partial re-validation for subsystem: <subsystem>. Read WORLD_STATE.json. Check only: <category that failed>. Overwrite corresponding category in .project-state/VALIDATION_RESULTS.json."
```

Update world state after repairs:
```bash
opencode-cli run --attach http://localhost:4100 --agent world-state-manager \
  "Merge repair results into WORLD_STATE.json. Resolve fixed openIssues. Update TASK_GRAPH nodes for repaired items."
```

If any item reaches 3 repair attempts and STATUS: NEEDS_HUMAN → surface to user:
```
REPAIR LIMIT REACHED — <failure>
Root cause: <from last repair result>
Suggested action: <from repair-engine>
```

---

## PHASE 9 — State Commit

Finalize world state and memory.

```bash
opencode-cli run --attach http://localhost:4100 --agent world-state-manager \
  "Final state commit. (1) Merge all remaining RESULTS/*.md from this session into WORLD_STATE.json — update all graphs, manifests, and metrics. (2) Set project.lastUpdated to current ISO timestamp. (3) Mark all TASK_GRAPH nodes as COMPLETE. Set TASK_GRAPH status to done. (4) Append session summary to .project-state/MEMORY/episodic.md: date, topic, what was built, what failed, what was repaired, final validation status. (5) If a new reusable workflow was discovered this session, append it to .project-state/MEMORY/procedural.md. (6) If a new system pattern was used, append it to .project-state/MEMORY/semantic.md."
```

Read final WORLD_STATE.json performanceMetrics and VALIDATION_RESULTS.json overall.

Print final report:
```
╔══════════════════════════════════════════╗
║  NGUCO Session Complete
╠══════════════════════════════════════════╣
  Topic:      <topic>
  Built:      <N nodes PASS>
  Repaired:   <N items fixed>
  Warnings:   <N open issues>
  Validation: <PASS|WARN|FAIL>
  Draw Calls: <before> → <after>
  Memory:     <before>MB → <after>MB
╚══════════════════════════════════════════╝
```

If any NEEDS_HUMAN items remain → list them with root cause.

---

## MCP Unity — Direct Editor Control

When `MCP_UNITY=true`, Claude calls these tools **directly** (not via OpenCode agents).
MCP server: `ai-game-developer` at `http://localhost:27112`.

### When to use MCP vs OpenCode

| Operation | Use MCP | Use OpenCode |
|---|---|---|
| Create/delete/move GameObject | ✅ MCP | — |
| Add/remove/read component | ✅ MCP | — |
| Set transform / field values | ✅ MCP | — |
| Run Editor menu item | ✅ MCP | — |
| Trigger compile / refresh assets | ✅ MCP | — |
| Read scene hierarchy | ✅ MCP | — |
| Write C# script files | — | ✅ coder agent |
| Complex multi-step scene setup | ✅ MCP tools in sequence | — |
| Read/write .json/.md state files | — | ✅ world-state-manager |

### Key MCP tools (ai-game-developer)

**GameObjects**
- `GameObject_Find` — find by name or path in scene
- `GameObject_Create` — create new empty or from prefab
- `GameObject_Destroy` — remove from scene
- `GameObject_SetActive` — show/hide
- `GameObject_GetHierarchy` — read full scene hierarchy as JSON

**Components**
- `Component_Add` — add component by type name (e.g. `"Rigidbody"`)
- `Component_Remove` — remove component
- `Component_Get` — read all serialized fields of a component
- `Component_Set` — set serialized field values (supports nested paths)

**Transform**
- `Transform_SetPosition` — world or local position
- `Transform_SetRotation` — euler or quaternion
- `Transform_SetScale`
- `Transform_SetParent` — reparent in hierarchy

**Assets & Scene**
- `AssetDatabase_Refresh` — equivalent of Ctrl+R, picks up new .cs files
- `Scene_Save` — save open scene
- `Scene_Open` — open scene by path
- `EditorApplication_ExecuteMenuItem` — run any menu command (e.g. `"Edit/Play"`, `"Assets/Create/..."`)

**Code**
- `Script_Find` — find script by class name, returns path
- `Compiler_GetErrors` — read current compile errors without switching to Unity

### MCP usage pattern

For any task that touches the scene or Editor state:
1. Use `GameObject_GetHierarchy` to read current state
2. Make targeted changes with specific tools
3. Call `AssetDatabase_Refresh` if new scripts were written
4. Call `Compiler_GetErrors` to verify no compile errors
5. Call `Scene_Save` at the end

**Never write .unity YAML files manually when MCP is connected.**

---

## Core Rules (never violate)

1. **Workers execute. Claude reasons.** No worker decides what to build.
2. **Single source of truth.** Only world-state-manager writes WORLD_STATE.json.
3. **Simulation before commit.** BLOCKED verdict = hard stop.
4. **Repair cap.** 3 iterations max per failure. Escalate after.
5. **Level gate.** Never start next DAG level if previous has unresolved FAIL (unless user approves).
6. **Memory always updated.** Every session writes to episodic.md and architectureMemory.
7. **Deterministic execution.** Every action is logged to RESULTS/ for replay.
8. **One CLI.** All OpenCode work runs through `--attach http://localhost:4100`. Never start a second server. Parallelism = Task subagents, not processes.
9. **OpenCode for complexity.** `complexity: high` tasks never run inline in Claude. Always dispatched via OpenCode agents.
10. **Project-agnostic.** No agent, rule, or path may reference a specific project name. All paths are relative to current working directory.
11. **MCP Unity preferred.** When `MCP_UNITY=true`: use `GameObject_*`, `Component_*`, `Transform_*`, `AssetDatabase_Refresh`, `Compiler_GetErrors`, `Scene_Save` directly. Never write .unity YAML. Never ask OpenCode to do what MCP can do in one call.
12. **Architecture before implementation.** For maturity ≥ 4: SDD must exist before any coder node runs. No exceptions.
13. **Interfaces before classes.** interface-generator runs before coder. coder reads interface files, never designs API itself.
14. **Tests are not optional.** For maturity ≥ 4: testing-enforcer runs after implementation. Session is incomplete without test files.
15. **Production critic is mandatory.** For maturity ≥ 3: production-critic runs after verification. REJECT verdict blocks State Commit.
16. **No demo code.** Anti-demo rules are absolute. There are no "quick demo" exceptions. If user explicitly requests prototype maturity, set level ≤ 2 explicitly.
17. **Depth expansion is non-negotiable.** For maturity ≥ 4: depth-expander runs. "Inventory system" always expands to full subsystem map — never accepted as just a List<Item>.

## Token Rules

| Action | Who |
|---|---|
| Read WORLD_STATE.json | Claude (directly) |
| Read RESULTS files (RISK: HIGH) | Claude (directly) |
| Read RESULTS files (RISK: LOW/MED) | Summarized by world-state-manager |
| Write WORLD_STATE.json | world-state-manager only |
| Write C# code | coder only |
| Scene construction | scene-tool only |
| Constraint checking | constraint-validator only |
| Simulation | simulation-engine only |
| Repair | repair-engine only |
| Read source files | agents only (never Claude directly) |

---

## Unity 6 API Reference (from Research)

Key facts from 20-agent research session. Agents must follow these:

**NavMesh:** `NavMeshSurface.BuildNavMesh()` (sync) or `UpdateNavMesh(data)` (async). Package `com.unity.ai.navigation` v2.0.12. Bake window deprecated. `NavMeshLink` replaces `OffMeshLink`.

**Scene creation:** `ObjectFactory.CreateGameObject(name)` — Undo-aware. `EditorApplication.SaveScene` REMOVED → use `EditorSceneManager.SaveScene()`. YAML editing is fragile — use MCP or Editor scripting.

**Build pipeline:** `BuildPipeline.BuildPlayer(options)` or new `BuildPlayerWithProfileOptions` (Unity 6 Build Profiles). `-build` CLI flag (no `-executeMethod` needed). Platform switching does NOT work in batch mode — pass `-buildTarget` as CLI arg.

**Shader Graph:** No public C# API. Unity 6.5+: `UNITY_EXPORT_REFLECTION` in HLSL = auto-register as node. Do not use `GraphData` reflection.

**DOTS ECS:** `ISystem` + `IJobEntity` + `SystemAPI.Query`. `IAspect` deprecated. `Entities.ForEach` deprecated. Default to MonoBehaviour — use DOTS only for >1000 entities.

**Addressables 2.x:** `LoadAssetAsync<T>()`, `LoadAssetsAsync<T>()`. Reference counting: every `Load` must have matching `Release`. `AddressableAssetSettings.BuildPlayerContent()` before build.

**GPU Resident Drawer (Unity 6):** Forward+/Deferred+ required. ~99% draw call reduction. ~100MB memory overhead. Automatic for compatible objects.

**OpenCode Task safety:** No built-in depth guard. Always add `"Do NOT use the Task tool"` to subagent prompts. Only unity-orchestrator may use Task tool.

