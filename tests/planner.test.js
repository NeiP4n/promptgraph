import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Build an isolated SQLite DB with a known skill graph, then exercise buildPlan.
let buildPlan, _db;
const tmpDir = path.join(os.tmpdir(), 'pg-planner-test-' + Date.now());

beforeAll(async () => {
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.PROMPTGRAPH_DIR = tmpDir; // not used by db directly, but harmless
  const Database = (await import('better-sqlite3')).default;
  _db = new Database(path.join(tmpDir, 'g.db'));
  _db.exec(`
    CREATE TABLE skills (id TEXT PRIMARY KEY, name TEXT, source TEXT);
    CREATE TABLE edges (from_skill TEXT, to_skill TEXT, PRIMARY KEY(from_skill,to_skill));
  `);
  const skills = [['s::a','a'],['s::b','b'],['s::c','c'],['s::d','d'],['s::e','e']];
  for (const [id, name] of skills) _db.prepare('INSERT INTO skills VALUES (?,?,?)').run(id, name, 's');
  // a → b, a → c, b → d, c → d, d → e   (diamond + tail). e is a leaf.
  const edges = [['s::a','s::b'],['s::a','s::c'],['s::b','s::d'],['s::c','s::d'],['s::d','s::e']];
  for (const [f, t] of edges) _db.prepare('INSERT INTO edges VALUES (?,?)').run(f, t);

  // Mock getDb to return our test db, then import planner.
  vi.doMock('../db.js', () => ({ getDb: () => _db }));
  ({ buildPlan } = await import('../planner.js'));
});

afterAll(() => {
  try { _db.close(); } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe('buildPlan — acyclic diamond', () => {
  it('collects the full transitive dependency set', () => {
    const p = buildPlan('a');
    expect(p.count).toBe(5);
    expect(p.acyclic).toBe(true);
    expect(Object.keys(p.nodes).sort()).toEqual(['s::a','s::b','s::c','s::d','s::e']);
  });

  it('orders dependencies before dependents (e first, a last)', () => {
    const p = buildPlan('a');
    const pos = (id) => p.order.indexOf(id);
    expect(pos('s::e')).toBeLessThan(pos('s::d'));
    expect(pos('s::d')).toBeLessThan(pos('s::b'));
    expect(pos('s::d')).toBeLessThan(pos('s::c'));
    expect(pos('s::b')).toBeLessThan(pos('s::a'));
    expect(pos('s::c')).toBeLessThan(pos('s::a'));
    expect(p.order[p.order.length - 1]).toBe('s::a');
  });

  it('groups parallelizable skills into levels (b and c share a level)', () => {
    const p = buildPlan('a');
    // levels: [e] [d] [b,c] [a]
    expect(p.levels[0]).toEqual(['s::e']);
    expect(p.levels[1]).toEqual(['s::d']);
    expect(p.levels[2].sort()).toEqual(['s::b','s::c']);
    expect(p.levels[p.levels.length - 1]).toEqual(['s::a']);
  });

  it('reports no cycles or unresolved refs', () => {
    const p = buildPlan('a');
    expect(p.cycles).toEqual([]);
    expect(p.unresolved).toEqual([]);
  });

  it('a single leaf skill plans to just itself', () => {
    const p = buildPlan('e');
    expect(p.count).toBe(1);
    expect(p.order).toEqual(['s::e']);
    expect(p.levels).toEqual([['s::e']]);
  });
});

describe('buildPlan — cycles & dangling refs', () => {
  it('detects a cycle and reports its path', () => {
    _db.prepare('INSERT OR IGNORE INTO edges VALUES (?,?)').run('s::e', 's::a'); // e → a closes a cycle
    const p = buildPlan('a');
    expect(p.acyclic).toBe(false);
    expect(p.cycles.length).toBeGreaterThan(0);
    // the cycle should contain a, (b|c), d, e
    const flat = p.cycles.flat();
    expect(flat).toContain('s::a');
    expect(flat).toContain('s::e');
    _db.prepare('DELETE FROM edges WHERE from_skill=? AND to_skill=?').run('s::e', 's::a');
  });

  it('flags referenced-but-not-indexed skills as unresolved', () => {
    _db.prepare('INSERT OR IGNORE INTO edges VALUES (?,?)').run('s::e', 'ghost-skill');
    const p = buildPlan('a');
    expect(p.unresolved).toContain('ghost-skill');
    _db.prepare('DELETE FROM edges WHERE to_skill=?').run('ghost-skill');
  });

  it('returns an error for an unknown root', () => {
    const p = buildPlan('does-not-exist');
    expect(p.error).toMatch(/not found/i);
  });
});
