import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { globSync } from 'glob';
import { chunkText } from '../chunker.js';
import { cosineSimilarity } from '../embedder.js';
import { isSkillFile } from '../parser.js';
import { skillId } from '../db.js';

const tmp = path.join(os.tmpdir(), 'pg-indexing-chunk-ann-test');

beforeAll(() => fs.mkdirSync(tmp, { recursive: true }));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('chunkText', () => {
  it('returns single chunk for short text under 800 words', () => {
    const text = Array(100).fill('word').join(' ');
    expect(chunkText(text)).toHaveLength(1);
  });

  it('splits text > 800 words into multiple chunks', () => {
    const text = Array(2000).fill('word').join(' ');
    expect(chunkText(text).length).toBeGreaterThan(1);
  });

  it('never returns empty array for non-empty string', () => {
    expect(chunkText('hello').length).toBeGreaterThan(0);
    expect(chunkText(' ').length).toBeGreaterThan(0);
  });

  it('never exceeds MAX_CHUNKS (32) regardless of input size', () => {
    const text = Array(5000).fill('word').join(' ');
    expect(chunkText(text).length).toBeLessThanOrEqual(32);
  });

  it('preserves markdown headers at chunk boundaries', () => {
    const text = '## Section A\n' + Array(380).fill('a').join(' ') + '\n## Section B\n' + Array(380).fill('b').join(' ');
    const chunks = chunkText(text);
    expect(chunks.some(c => c.includes('Section A'))).toBe(true);
    expect(chunks.some(c => c.includes('Section B'))).toBe(true);
  });

  it('each chunk stays within 800 word limit', () => {
    const text = Array(1600).fill('word').join(' ');
    for (const chunk of chunkText(text)) {
      const wordCount = chunk.split(/\s+/).filter(Boolean).length;
      expect(wordCount).toBeLessThanOrEqual(800);
    }
  });
});

describe('cosineSimilarity', () => {
  it('identical unit vectors give dot product of 1', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  });

  it('orthogonal vectors give dot product of 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('opposite vectors give dot product of -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });

  it('zero vector gives 0 regardless of other vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('handles vectors of different lengths safely', () => {
    const a = [1, 2];
    const b = [1, 2, 3];
    const result = cosineSimilarity(a, b);
    expect(result).toBe(5);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('handles very small numbers without NaN', () => {
    const a = [1e-15, 1e-15];
    const b = [1e-15, 1e-15];
    const result = cosineSimilarity(a, b);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });
});

describe('Indexer-related logic', () => {
  it('same content produces identical md5 hash', () => {
    const content = 'some skill content here';
    const h1 = createHash('md5').update(content).digest('hex');
    const h2 = createHash('md5').update(content).digest('hex');
    expect(h1).toBe(h2);
  });

  it('different content produces different md5 hashes', () => {
    const h1 = createHash('md5').update('content A').digest('hex');
    const h2 = createHash('md5').update('content B').digest('hex');
    expect(h1).not.toBe(h2);
  });

  it('skillId formats source::name pattern (commands::pg)', () => {
    expect(skillId('commands', 'pg')).toBe('commands::pg');
    expect(skillId('marketplace', 'test-skill')).toBe('marketplace::test-skill');
  });

  it('non-.md files are not matched by globSync pattern used in indexer', () => {
    const txtFile = path.join(tmp, 'not-a-skill.txt');
    const mdFile = path.join(tmp, 'real-skill.md');
    fs.writeFileSync(txtFile, 'text');
    fs.writeFileSync(mdFile, '# Skill');
    const matches = globSync(`${tmp.replace(/\\/g, '/')}/**/*.md`);
    const resolved = matches.map(m => path.resolve(m));
    expect(resolved).toContain(path.resolve(mdFile));
    expect(resolved).not.toContain(path.resolve(txtFile));
    fs.unlinkSync(txtFile);
    fs.unlinkSync(mdFile);
  });

  it('rejects .md files inside node_modules directory', () => {
    const nmDir = path.join(tmp, 'node_modules');
    fs.mkdirSync(nmDir, { recursive: true });
    const fp = path.join(nmDir, 'some-lib.md');
    fs.writeFileSync(fp, '# Some library docs');
    expect(isSkillFile(fp)).toBe(false);
  });

  it('rejects files in .github directory', () => {
    const ghDir = path.join(tmp, '.github');
    fs.mkdirSync(ghDir, { recursive: true });
    const fp = path.join(ghDir, 'workflow.md');
    fs.writeFileSync(fp, '# Workflow docs');
    expect(isSkillFile(fp)).toBe(false);
  });

  it('rejects files in docs/ directory', () => {
    const docsDir = path.join(tmp, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    const fp = path.join(docsDir, 'guide.md');
    fs.writeFileSync(fp, '# Guide docs');
    expect(isSkillFile(fp)).toBe(false);
  });

  it('passes a valid skill file with frontmatter name through all pre-checks', () => {
    const fp = path.join(tmp, 'valid-skill.md');
    fs.writeFileSync(fp, '---\nname: valid-skill\ndescription: A real skill\n---\n\n# Valid Skill\n\nThis skill does something useful.\n\n## How to use\n\nRun the following command.\n\n```bash\necho done\n```\n');
    expect(isSkillFile(fp)).toBe(true);
  });
});
