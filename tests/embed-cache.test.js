import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = path.join(os.tmpdir(), 'pg-embed-cache-test');
fs.mkdirSync(tmp, { recursive: true });

vi.mock('../config.js', () => ({ PROMPTGRAPH_DIR: tmp }));

const { hashText, cacheGetMany, cachePutMany } = await import('../embed-cache.js');

afterAll(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe('hashText', () => {
  it('is deterministic for the same text', () => {
    expect(hashText('hello world')).toBe(hashText('hello world'));
  });
  it('differs for different text', () => {
    expect(hashText('a')).not.toBe(hashText('b'));
  });
});

describe('embed cache round-trip', () => {
  it('returns nothing for unknown hashes', () => {
    const got = cacheGetMany([hashText('nope')]);
    expect(got.size).toBe(0);
  });

  it('persists and reads back vectors by hash', () => {
    const h1 = hashText('skill one');
    const h2 = hashText('skill two');
    const v1 = [0.1, -0.2, 0.3];
    const v2 = [1, 2, 3, 4];
    cachePutMany([[h1, v1], [h2, v2]]);

    const got = cacheGetMany([h1, h2]);
    expect(got.size).toBe(2);
    // Float32 round-trip — compare with tolerance
    got.get(h1).forEach((x, i) => expect(x).toBeCloseTo(v1[i], 5));
    expect(got.get(h2)).toEqual(v2);
  });

  it('only returns hashes that exist', () => {
    const known = hashText('known');
    cachePutMany([[known, [0.5]]]);
    const got = cacheGetMany([known, hashText('missing')]);
    expect(got.has(known)).toBe(true);
    expect(got.has(hashText('missing'))).toBe(false);
  });

  it('ignores empty put without error', () => {
    expect(() => cachePutMany([])).not.toThrow();
  });
});
