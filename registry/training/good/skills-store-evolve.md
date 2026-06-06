# /evolve — Self-Evolution Loop for dev-os

Run the infinite self-improvement loop. Each cycle discovers new tech, analyzes the codebase, generates improvement proposals, runs experiments, and optionally applies safe changes.

## Usage

```
/evolve
```

On first invocation, ask the user:

1. **Mode**:
   - `once` — Run one evolution cycle now
   - `forever` — Infinite loop (runs every 6 hours)
   - `status` — Show evolution history and stats
   - `focus: llm` — Scan only new LLM models
   - `focus: prompts` — Evolve agent prompts only
   - `focus: features` — Discover new capabilities
   - `focus: tech` — Scan new libraries/tools
   - `focus: experimental` — Run strategy comparisons (ToT vs ReAct, MoA, Constitutional AI, prompt evolution)

2. **Auto-apply safe improvements?** — yes / no

## Execution by Mode

### once
```powershell
cd "C:\Users\Sasha\.claude\dev-os"
$env:PYTHONIOENCODING="utf-8"
python -c "
from dev_os.agents.evolution_loop import EvolutionLoop
loop = EvolutionLoop()
report = loop.run_once(focus='FOCUS_HERE')
import json
print(json.dumps(report, indent=2, ensure_ascii=False, default=str))
"
```

### forever
Start background process:
```powershell
Start-Process python -ArgumentList '-m dev_os.cli evolve --forever --interval 6' -WorkingDirectory "C:\Users\Sasha\.claude\dev-os" -WindowStyle Hidden
```

Alternatively, use `/loop` skill with this command to run every 6 hours:
```
/loop 6h python -c "from dev_os.agents.evolution_loop import EvolutionLoop; loop = EvolutionLoop(); loop.run_cycle(auto_apply=False)"
```

### status
```powershell
cd "C:\Users\Sasha\.claude\dev-os"
$env:PYTHONIOENCODING="utf-8"
python -c "
from dev_os.agents.evolution_loop import EvolutionLoop
import json
s = EvolutionLoop().status()
print(json.dumps(s, indent=2, ensure_ascii=False, default=str))
"
```

### what-changed
```powershell
cd "C:\Users\Sasha\.claude\dev-os"
$env:PYTHONIOENCODING="utf-8"
python -c "
from dev_os.agents.evolution_loop import EvolutionLoop
import json
changes = EvolutionLoop().what_changed()
print(json.dumps(changes, indent=2, ensure_ascii=False, default=str))
"
```

## Focus: experimental — Strategy Details

When the user selects `focus: experimental`, Claude MUST run experiments comparing:

1. **Tree of Thought vs ReAct** — Compare multi-step reasoning strategies on the LLM router agent
2. **Mixture of Agents** — Test having multiple agent instances collaborate on a single task
3. **Constitutional AI self-improvement** — Apply constitutional AI principles to the LLM router's prompt templates
4. **Prompt evolution** — Evolve prompts on the market analysis agent using the experiment engine

Steps for experimental focus:
1. Run `EvolutionLoop().run_once(focus="experimental")` which calls `ExperimentEngine.compare_strategies()`
2. Show the comparison results to the user
3. Recommend which strategy to integrate
4. If user agrees, implement the winning strategy using `mcp__opencode__opencode_run` or by spawning an agent

## Output

After any mode, display:

- What was discovered (new LLMs, trending repos, arxiv papers, free APIs)
- What proposals were generated
- What was applied (if auto_apply)
- What experiments ran and which ones passed
- Current system quality score
- Cycle number and next scheduled run (for `forever` mode)

