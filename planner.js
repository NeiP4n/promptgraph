import { getDb } from './db.js';

// ── DAG execution planner ─────────────────────────────────────────────────────
// Skills reference other skills (edge A→B means "A calls/uses B"). This builds the
// full transitive dependency graph for a goal skill and produces a deterministic
// execution plan BEFORE anything runs: topological order, parallelizable levels,
// cycle detection (with the actual cycle path), and dangling/unresolved refs.

function resolveId(db, nameOrId) {
  const byId = db.prepare('SELECT id FROM skills WHERE id = ?').get(nameOrId);
  if (byId) return { id: byId.id };
  const byName = db.prepare('SELECT id FROM skills WHERE name = ?').all(nameOrId);
  if (byName.length === 1) return { id: byName[0].id };
  if (byName.length > 1) {
    return { error: `Ambiguous name "${nameOrId}" — use a full id: ${byName.map(r => r.id).join(', ')}` };
  }
  return { error: `Skill not found: ${nameOrId}` };
}

// Find every cycle reachable in the dependency subgraph (DFS with a recursion stack).
function findCycles(nodeIds, adj) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(nodeIds.map(id => [id, WHITE]));
  const stack = [];
  const cycles = [];
  const seenCycle = new Set();

  function dfs(u) {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of adj.get(u) || []) {
      if (!color.has(v)) continue;            // edge to a node outside the set (unresolved)
      if (color.get(v) === GRAY) {
        // back-edge → cycle from v..u then back to v
        const i = stack.indexOf(v);
        const cycle = stack.slice(i).concat(v);
        const key = [...cycle].sort().join('|');
        if (!seenCycle.has(key)) { seenCycle.add(key); cycles.push(cycle); }
      } else if (color.get(v) === WHITE) {
        dfs(v);
      }
    }
    stack.pop();
    color.set(u, BLACK);
  }

  for (const id of nodeIds) if (color.get(id) === WHITE) dfs(id);
  return cycles;
}

export function buildPlan(nameOrId) {
  const db = getDb();
  const res = resolveId(db, nameOrId);
  if (res.error) return res;
  const rootId = res.id;

  // 1. Gather the transitive dependency subgraph (root + everything it reaches via callees).
  const nodes = new Map();   // id -> { id, name, present, callees: [] }
  const adj = new Map();     // id -> [calleeIds]
  const unresolved = new Set();
  const stack = [rootId];
  const seen = new Set();

  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const skill = db.prepare('SELECT id, name, source FROM skills WHERE id = ?').get(cur);
    const present = !!skill;
    const callees = db.prepare('SELECT to_skill FROM edges WHERE from_skill = ?').all(cur).map(r => r.to_skill);
    nodes.set(cur, { id: cur, name: skill?.name || cur, source: skill?.source || null, present, callees });
    adj.set(cur, callees);
    if (!present) { unresolved.add(cur); continue; }   // dangling ref — don't expand
    for (const c of callees) if (!seen.has(c)) stack.push(c);
  }

  const nodeIds = [...nodes.keys()];

  // 2. Cycle detection (report actual paths).
  const cycles = findCycles(nodeIds, adj);
  const acyclic = cycles.length === 0;

  // 3. Topological order (Kahn) — dependencies (callees) before dependents.
  //    indegree[n] = how many of n's callees are still unscheduled.
  const inSet = new Set(nodeIds);
  const indeg = new Map();
  const dependents = new Map(nodeIds.map(id => [id, []]));   // callee -> [callers]
  for (const id of nodeIds) {
    const deps = (adj.get(id) || []).filter(c => inSet.has(c));
    indeg.set(id, deps.length);
    for (const d of deps) dependents.get(d).push(id);
  }

  const order = [];
  const level = new Map();
  let queue = nodeIds.filter(id => indeg.get(id) === 0);
  for (const id of queue) level.set(id, 0);

  while (queue.length) {
    const next = [];
    for (const d of queue) {
      order.push(d);
      for (const caller of dependents.get(d)) {
        indeg.set(caller, indeg.get(caller) - 1);
        level.set(caller, Math.max(level.get(caller) || 0, (level.get(d) || 0) + 1));
        if (indeg.get(caller) === 0) next.push(caller);
      }
    }
    queue = next;
  }

  // 4. Parallelizable batches — nodes at the same level have no inter-dependency.
  const levels = [];
  if (acyclic) {
    const maxLevel = Math.max(0, ...[...level.values()]);
    for (let l = 0; l <= maxLevel; l++) {
      const batch = order.filter(id => level.get(id) === l);
      if (batch.length) levels.push(batch);
    }
  }

  return {
    root: { id: rootId, name: nodes.get(rootId).name },
    count: nodeIds.length,
    acyclic,
    order,                                   // dependencies first, root last
    levels,                                  // each batch can run in parallel
    cycles,                                  // [[a,b,c,a], …] if any
    unresolved: [...unresolved],             // referenced but not indexed
    nodes: Object.fromEntries(nodes),
  };
}
