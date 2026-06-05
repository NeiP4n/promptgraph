import { describe, it, expect } from 'vitest';
import { skillId, vecToBlob, blobToVec } from '../db.js';

describe('skillId', () => {
  it('formats correctly', () => {
    expect(skillId('commands', 'pg')).toBe('commands::pg');
  });
});

describe('vecToBlob / blobToVec roundtrip', () => {
  it('preserves values within float32 precision', () => {
    const vec = Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1));
    const blob = vecToBlob(vec);
    const back = blobToVec(blob);
    expect(back).toHaveLength(384);
    for (let i = 0; i < 384; i++) {
      expect(back[i]).toBeCloseTo(vec[i], 5);
    }
  });

  it('blobToVec handles legacy JSON string', () => {
    const vec = [0.1, 0.2, 0.3];
    const json = JSON.stringify(vec);
    const back = blobToVec(json);
    expect(back).toEqual(vec);
  });

  it('blob is smaller than JSON', () => {
    const vec = Array.from({ length: 384 }, (_, i) => Math.random());
    const blob = vecToBlob(vec);
    const json = JSON.stringify(vec);
    expect(blob.length).toBeLessThan(json.length);
  });
});
