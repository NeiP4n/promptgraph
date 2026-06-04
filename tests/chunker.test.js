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
});
