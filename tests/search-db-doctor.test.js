import { vi, describe, it, expect, beforeEach, beforeAll } from 'vitest';

// ── Mutable mock state (hoisted before vi.mock) ──────────────────────────────
const { mockDb } = vi.hoisted(() => {
  const db = { prepare: vi.fn() };
  db.prepare = vi.fn(() => db);
  db.run = vi.fn(() => ({ changes: 0 }));
  db.get = vi.fn();
  db.all = vi.fn(() => []);
  db.pragma = vi.fn();
  db.exec = vi.fn();
  return { mockDb: db };
});

// ── Mock db module for search / doctor tests ─────────────────────────────────
vi.mock('../db.js', () => ({
  getDb: () => mockDb,
  skillId: (a, b) => `${a}::${b}`,
  vecToBlob: (v) => Buffer.from(new Float32Array(v).buffer),
  blobToVec: (b) => {
    if (typeof b === 'string') return JSON.parse(b);
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
  },
}));

// ── Imports (db.js pure functions use vi.importActual) ──────────────────────
import { cosineSimilarity } from '../embedder.js';
import { validateBundle } from '../validator.js';
import { parseSkillFile } from '../parser.js';

import { listAll, getContext, getCallees } from '../search.js';

let realDb;

beforeAll(async () => {
  realDb = await vi.importActual('../db.js');
});

beforeEach(() => {
  mockDb.run.mockReset().mockReturnValue({ changes: 0 });
  mockDb.get.mockReset().mockReturnValue(undefined);
  mockDb.all.mockReset().mockReturnValue([]);
  mockDb.pragma.mockReset();
  mockDb.exec.mockReset();
});

// ═══════════════════════════════════════════════════════════════════════════════
// db.js — 6 tests (pure functions, no mock needed)
// ═══════════════════════════════════════════════════════════════════════════════

describe('skillId', () => {
  it('formats source and name correctly', () => {
    expect(realDb.skillId('commands', 'pg')).toBe('commands::pg');
  });

  it('handles hyphens and special characters', () => {
    expect(realDb.skillId('custom-source', 'my-cool-skill')).toBe('custom-source::my-cool-skill');
  });
});

describe('vecToBlob / blobToVec', () => {
  it('vecToBlob returns a Buffer of correct byte length', () => {
    const vec = Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1));
    const blob = realDb.vecToBlob(vec);
    expect(Buffer.isBuffer(blob)).toBe(true);
    expect(blob.length).toBe(384 * 4);
  });

  it('blobToVec roundtrips 384 floats from vecToBlob', () => {
    const vec = Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1));
    const back = realDb.blobToVec(realDb.vecToBlob(vec));
    expect(back).toHaveLength(384);
    for (let i = 0; i < 384; i++) {
      expect(back[i]).toBeCloseTo(vec[i], 5);
    }
  });

  it('blobToVec handles legacy JSON string format', () => {
    const vec = [0.1, 0.2, 0.3];
    const json = JSON.stringify(vec);
    expect(realDb.blobToVec(json)).toEqual(vec);
  });

  it('blob is smaller than JSON for 384-length vector', () => {
    const vec = Array.from({ length: 384 }, () => Math.random());
    const blob = realDb.vecToBlob(vec);
    const json = JSON.stringify(vec);
    expect(blob.length).toBeLessThan(json.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// embedder.js — 2 tests (pure functions)
// ═══════════════════════════════════════════════════════════════════════════════

describe('cosineSimilarity', () => {
  it('returns dot product for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// validator.js — 3 tests (pure functions)
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateBundle', () => {
  it('accepts valid bundle with skills array', () => {
    const r = validateBundle({
      id: 'web-dev',
      name: 'Web Development',
      description: 'A collection of web dev skills for frontend and backend work',
      skills: ['react', 'node', 'css'],
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('rejects bundle missing id', () => {
    const r = validateBundle({
      name: 'Web',
      description: 'Some description here for testing',
      skills: ['react'],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /missing.*id/i.test(e))).toBe(true);
  });

  it('accepts bundle with repo_url instead of skills', () => {
    const r = validateBundle({
      id: 'gh-repo',
      name: 'GitHub Repo Bundle',
      description: 'Bundle sourced from a GitHub repository',
      repo_url: 'owner/repo',
    });
    expect(r.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// parser.js — 5 tests (via raw option, no disk reads)
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseSkillFile', () => {
  it('reads name and description from frontmatter', () => {
    const r = parseSkillFile('test.md', 'src', {
      raw: '---\nname: my-skill\ndescription: Does a thing\n---\nBody content',
    });
    expect(r.name).toBe('my-skill');
    expect(r.description).toBe('Does a thing');
    expect(r.source).toBe('src');
  });

  it('falls back to first paragraph when description missing', () => {
    const r = parseSkillFile('test.md', 'src', {
      raw: '---\nname: my-skill\n---\nFirst paragraph here\n\nSecond paragraph',
    });
    expect(r.name).toBe('my-skill');
    expect(r.description).toBe('First paragraph here');
  });

  it('truncates description at 200 chars when falling back', () => {
    const long = 'A'.repeat(300);
    const r = parseSkillFile('test.md', 'src', {
      raw: `---\nname: my-skill\n---\n${long}`,
    });
    expect(r.description.length).toBe(200);
    expect(r.description).toBe('A'.repeat(200));
  });

  it('handles file with no frontmatter', () => {
    const r = parseSkillFile('no-fm.md', 'src', {
      raw: '# Just a heading\n\nSome body text',
    });
    expect(r.name).toBe('no-fm');
    expect(r.description).toBe('Some body text');
  });

  it('handles empty file content', () => {
    const r = parseSkillFile('empty.md', 'src', { raw: '' });
    expect(r.name).toBe('empty');
    expect(r.description).toBe('');
    expect(r.content).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// search.js — 4 tests (mocked getDb)
// ═══════════════════════════════════════════════════════════════════════════════

describe('search (mocked db)', () => {
  it('listAll returns empty when no skills', () => {
    expect(listAll()).toEqual([]);
  });

  it('listAll returns skill rows when present', () => {
    const rows = [
      { id: 'src::skill-a', name: 'skill-a', description: 'first', source: 'src' },
      { id: 'src::skill-b', name: 'skill-b', description: 'second', source: 'src' },
    ];
    mockDb.all.mockReturnValueOnce(rows);
    expect(listAll()).toEqual(rows);
  });

  it('getContext returns error for unknown skill', () => {
    const result = getContext('nonexistent');
    expect(result).toEqual({ error: expect.stringContaining('not found') });
  });

  it('getCallees returns callees for a known skill', () => {
    mockDb.get.mockReturnValueOnce({ id: 'src::skill' });
    mockDb.all.mockReturnValueOnce([
      { to_skill: 'src::callee1' },
      { to_skill: 'src::callee2' },
    ]);
    expect(getCallees('skill')).toEqual(['src::callee1', 'src::callee2']);
  });
});
