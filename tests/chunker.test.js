import { describe, it, expect } from 'vitest';
import { chunkText } from '../chunker.js';

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    expect(chunkText('hello world').length).toBe(1);
  });

  it('splits long text into multiple chunks', () => {
    const words = Array(2000).fill('word').join(' ');
    const chunks = chunkText(words);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('never returns empty for non-empty input', () => {
    expect(chunkText('a').length).toBeGreaterThan(0);
  });

  it('preserves markdown header boundaries', () => {
    const text = 'intro\n## Section A\nfoo\n## Section B\nbar';
    const chunks = chunkText(text);
    expect(chunks.some(c => c.includes('intro'))).toBe(true);
    expect(chunks.some(c => c.includes('Section A'))).toBe(true);
  });

  it('each chunk stays within word limit', () => {
    const big = Array(1600).fill('w').join(' ');
    for (const chunk of chunkText(big)) {
      expect(chunk.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(800);
    }
  });
});
