import { describe, it, expect, beforeEach, vi } from 'vitest';

function vec384(pos = 0, val = 1) {
  const a = new Array(384).fill(0);
  a[pos] = val;
  return a;
}

// ── VectorStore base class ──────────────────────────────────────────────

describe('VectorStore (base class)', () => {
  let VectorStore;
  let store;

  beforeEach(async () => {
    const mod = await import('../src/store/vector-store.js');
    VectorStore = mod.VectorStore;
    store = new VectorStore();
  });

  it('add throws not implemented', async () => {
    await expect(store.add('a', [1, 2, 3])).rejects.toThrow('not implemented');
  });
  it('addBatch throws not implemented', async () => {
    await expect(store.addBatch([{ id: 'a', vector: [1, 2, 3] }])).rejects.toThrow('not implemented');
  });
  it('remove throws not implemented', async () => {
    await expect(store.remove('a')).rejects.toThrow('not implemented');
  });
  it('search throws not implemented', async () => {
    await expect(store.search([1, 2, 3])).rejects.toThrow('not implemented');
  });
  it('build throws not implemented', async () => {
    await expect(store.build([])).rejects.toThrow('not implemented');
  });
  it('clear throws not implemented', async () => {
    await expect(store.clear()).rejects.toThrow('not implemented');
  });
  it('size returns 0', () => {
    expect(store.size).toBe(0);
  });
});

// ── FlatVectorStore ─────────────────────────────────────────────────────

describe('FlatVectorStore', () => {
  let store;

  beforeEach(async () => {
    const mod = await import('../src/store/flat-store.js');
    store = new mod.FlatVectorStore();
  });

  it('is empty on creation', () => {
    expect(store.size).toBe(0);
  });

  it('search on empty store returns []', async () => {
    expect(await store.search([1, 0, 0])).toEqual([]);
  });

  it('add + search returns nearest match', async () => {
    await store.add('skill-a', [1, 0, 0]);
    await store.add('skill-b', [0, 1, 0]);
    const res = await store.search([0.99, 0.01, 0]);
    expect(res).toHaveLength(2);
    expect(res[0].skill_id).toBe('skill-a');
    expect(res[0].score).toBeCloseTo(0.9999, 2);
  });

  it('addBatch adds multiple entries', async () => {
    await store.addBatch([
      { id: 'a', vector: [1, 0, 0] },
      { id: 'b', vector: [0, 1, 0] },
    ]);
    expect(store.size).toBe(2);
  });

  it('remove removes an entry by id', async () => {
    await store.add('a', [1, 0, 0]);
    await store.add('b', [0, 1, 0]);
    await store.remove('a');
    expect(store.size).toBe(1);
    const res = await store.search([1, 0, 0]);
    expect(res[0].skill_id).toBe('b');
  });

  it('removing from empty store does not throw', async () => {
    await expect(store.remove('nonexistent')).resolves.not.toThrow();
  });

  it('build replaces all entries', async () => {
    await store.add('old-a', [1, 0, 0]);
    await store.build([
      { skill_id: 'new-a', vector: [0, 1, 0] },
    ]);
    expect(store.size).toBe(1);
    const res = await store.search([0.99, 0.01, 0]);
    expect(res[0].skill_id).toBe('new-a');
  });

  it('build with empty array clears the store', async () => {
    await store.add('a', [1, 0, 0]);
    await store.build([]);
    expect(store.size).toBe(0);
  });

  it('clear empties the store', async () => {
    await store.add('a', [1, 0, 0]);
    await store.clear();
    expect(store.size).toBe(0);
  });

  it('search respects topK limit', async () => {
    for (let i = 0; i < 10; i++) {
      await store.add(`skill-${i}`, [i / 10, 0, 0]);
    }
    const res = await store.search([1, 0, 0], 3);
    expect(res).toHaveLength(3);
  });

  it('multiple chunks for same skill return best score', async () => {
    await store.add('same-skill', [0.5, 0.5, 0]);
    await store.add('same-skill', [0.9, 0.4, 0]);
    const res = await store.search([1, 0, 0]);
    expect(res).toHaveLength(1);
    expect(res[0].skill_id).toBe('same-skill');
    expect(res[0].score).toBeGreaterThan(0.9);
  });

  it('cosine identity scores 1', async () => {
    await store.add('a', [1, 0, 0]);
    const res = await store.search([1, 0, 0]);
    expect(res[0].score).toBeCloseTo(1, 4);
  });

  it('cosine opposite scores -1', async () => {
    await store.add('a', [1, 0, 0]);
    const res = await store.search([-1, 0, 0]);
    expect(res[0].score).toBeCloseTo(-1, 4);
  });

  it('accepts Float32Array as vector input', async () => {
    await store.add('a', new Float32Array([1, 0, 0]));
    const res = await store.search(new Float32Array([1, 0, 0]));
    expect(res[0].skill_id).toBe('a');
  });

  it('handles 384-dim vectors (realistic size)', async () => {
    const a = Array.from({ length: 384 }, (_, i) => Math.sin(i));
    const b = Array.from({ length: 384 }, (_, i) => Math.cos(i));
    await store.add('a', a);
    await store.add('b', b);
    const res = await store.search(a);
    expect(res[0].skill_id).toBe('a');
    expect(res[0].score).toBeCloseTo(1, 2);
  });
});

// ── HNSWVectorStore ─────────────────────────────────────────────────────

describe('HNSWVectorStore', () => {
  let store;

  beforeEach(async () => {
    const mod = await import('../src/store/hnsw-store.js');
    store = new mod.HNSWVectorStore();
  });

  it('is empty on creation', () => {
    expect(store.size).toBe(0);
  });

  it('search on empty store returns []', async () => {
    expect(await store.search(vec384(0))).toEqual([]);
  });

  it('add + search returns nearest match', async () => {
    await store.add('skill-a', vec384(0));
    await store.add('skill-b', vec384(1));
    const res = await store.search(vec384(0));
    expect(res[0].skill_id).toBe('skill-a');
    expect(res[0].score).toBeGreaterThan(0.99);
  });

  it('addBatch adds multiple entries', async () => {
    await store.addBatch([
      { id: 'a', vector: vec384(0) },
      { id: 'b', vector: vec384(1) },
    ]);
    expect(store.size).toBe(2);
  });

  it('remove removes an entry by id', async () => {
    await store.add('a', vec384(0));
    await store.add('b', vec384(1));
    await store.remove('a');
    expect(store.size).toBe(1);
    const res = await store.search(vec384(0));
    expect(res[0].skill_id).toBe('b');
  });

  it('removing from empty store does not throw', async () => {
    await expect(store.remove('nonexistent')).resolves.not.toThrow();
  });

  it('build replaces all entries', async () => {
    await store.add('old-a', vec384(0));
    await store.build([
      { skill_id: 'new-a', vector: vec384(1) },
    ]);
    expect(store.size).toBe(1);
    const res = await store.search(vec384(1, 0.99));
    expect(res[0].skill_id).toBe('new-a');
  });

  it('build with empty array clears the store', async () => {
    await store.add('a', vec384(0));
    await store.build([]);
    expect(store.size).toBe(0);
  });

  it('clear empties the store', async () => {
    await store.add('a', vec384(0));
    await store.clear();
    expect(store.size).toBe(0);
  });

  it('search respects topK limit', async () => {
    for (let i = 0; i < 10; i++) {
      await store.add(`skill-${i}`, vec384(i % 384));
    }
    const res = await store.search(vec384(0), 3);
    expect(res).toHaveLength(3);
  });

  it('multiple chunks for same skill return best score', async () => {
    await store.add('same-skill', vec384(0, 0.5));
    await store.add('same-skill', vec384(0, 0.9));
    const res = await store.search(vec384(0));
    expect(res).toHaveLength(1);
    expect(res[0].skill_id).toBe('same-skill');
    expect(res[0].score).toBeGreaterThan(0.9);
  });

  it('handles 384-dim realistic vectors', async () => {
    const a = Array.from({ length: 384 }, (_, i) => Math.sin(i));
    const b = Array.from({ length: 384 }, (_, i) => Math.cos(i));
    await store.add('a', a);
    await store.add('b', b);
    const res = await store.search(a);
    expect(res[0].skill_id).toBe('a');
    expect(res[0].score).toBeGreaterThan(0.99);
  });

  it('auto-rebuilds when maxElements exceeded', async () => {
    for (let i = 0; i < 15; i++) {
      await store.add(`s${i}`, vec384(i % 384));
    }
    expect(store.size).toBe(15);
    const res = await store.search(vec384(0), 5);
    expect(res.length).toBeGreaterThanOrEqual(1);
  });
});

// ── store/index.js ─────────────────────────────────────────────────────

describe('store/index.js', () => {
  beforeEach(async () => {
    const { resetStore } = await import('../src/store/index.js');
    resetStore();
  });

  it('getStore without args returns FlatVectorStore by default', async () => {
    const storeMod = await import('../src/store/index.js');
    const FlatVectorStore = (await import('../src/store/flat-store.js')).FlatVectorStore;
    expect(storeMod.getStore()).toBeInstanceOf(FlatVectorStore);
  });

  it('getStore("hnsw") returns HNSWVectorStore', async () => {
    const storeMod = await import('../src/store/index.js');
    const HNSWVectorStore = (await import('../src/store/hnsw-store.js')).HNSWVectorStore;
    expect(storeMod.getStore('hnsw')).toBeInstanceOf(HNSWVectorStore);
  });

  it('getStore returns singleton', async () => {
    const storeMod = await import('../src/store/index.js');
    expect(storeMod.getStore()).toBe(storeMod.getStore());
  });

  it('resetStore creates new instance on next getStore call', async () => {
    const storeMod = await import('../src/store/index.js');
    const a = storeMod.getStore('flat');
    storeMod.resetStore();
    expect(storeMod.getStore('flat')).not.toBe(a);
  });
});

// ── ann.js ──────────────────────────────────────────────────────────────

vi.mock('../src/store/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resetStore: vi.fn(actual.resetStore),
    getStore: vi.fn(actual.getStore),
  };
});

describe('ann.js', () => {
  beforeEach(async () => {
    const { resetStore } = await import('../src/store/index.js');
    resetStore();
    vi.clearAllMocks();
  });

  it('resetAnnIndex calls resetStore', async () => {
    const storeMod = await import('../src/store/index.js');
    const ann = await import('../ann.js');
    ann.resetAnnIndex();
    expect(storeMod.resetStore).toHaveBeenCalledOnce();
  });

  it('annSearch returns null when store is empty', async () => {
    const ann = await import('../ann.js');
    expect(await ann.annSearch(vec384(0))).toBeNull();
  });

  it('annSearch returns results when store has items', async () => {
    const { getStore, resetStore } = await import('../src/store/index.js');
    resetStore();
    const store = getStore('flat');
    await store.add('skill-a', [1, 0, 0]);
    await store.add('skill-b', [0, 1, 0]);

    const ann = await import('../ann.js');
    const result = await ann.annSearch([1, 0, 0], 5);
    expect(result).not.toBeNull();
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].skill_id).toBe('skill-a');
  });

  it('annSearch respects topK parameter', async () => {
    const { getStore, resetStore } = await import('../src/store/index.js');
    resetStore();
    const store = getStore('flat');
    for (let i = 0; i < 10; i++) {
      await store.add(`s${i}`, [(10 - i) / 10, 0, 0]);
    }

    const ann = await import('../ann.js');
    const result = await ann.annSearch([1, 0, 0], 3);
    expect(result).toHaveLength(3);
  });

  it('buildAnnIndex handles empty db gracefully', async () => {
    vi.mock('../db.js', () => ({
      getDb: () => ({
        prepare: () => ({ all: () => [] }),
      }),
      blobToVec: () => new Float32Array(384),
    }));

    const ann = await import('../ann.js');
    await expect(ann.buildAnnIndex()).resolves.not.toThrow();
    vi.restoreAllMocks();
  });

  it('buildAnnIndex handles db error gracefully', async () => {
    vi.mock('../db.js', () => ({
      getDb: () => { throw new Error('db connection failed'); },
      blobToVec: () => new Float32Array(384),
    }));

    const ann = await import('../ann.js');
    await expect(ann.buildAnnIndex()).resolves.not.toThrow();
    vi.restoreAllMocks();
  });
});
