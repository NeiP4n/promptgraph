import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isSkillFile, filterWithClassifier, parseSkillFile } from '../parser.js';
import { hardFilter } from '../src/filter/hard-filter.js';
import { getFeatureVector, classify } from '../src/filter/classifier.js';

const tmp = path.join(os.tmpdir(), 'pg-parser-score-test');

beforeAll(() => fs.mkdirSync(tmp, { recursive: true }));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(name, content) {
  const fp = path.join(tmp, name);
  fs.writeFileSync(fp, content);
  return fp;
}

describe('hardFilter', () => {
  it('rejects readme filenames', () => {
    expect(hardFilter('/x/README.md').pass).toBe(false);
    expect(hardFilter('/x/readme.md').pass).toBe(false);
  });

  it('rejects files in docs/ directory', () => {
    expect(hardFilter('/project/docs/my-file.md').pass).toBe(false);
    expect(hardFilter('/project/DOCS/index.md').pass).toBe(false);
  });

  it('rejects LICENSE and CHANGELOG', () => {
    expect(hardFilter('/x/LICENSE.md').pass).toBe(false);
    expect(hardFilter('/x/CHANGELOG.md').pass).toBe(false);
  });

  it('rejects badge-only content', () => {
    const r = hardFilter('/x/skill.md', '[![Build](https://img.shields.io/badge/build-passing-green)]');
    expect(r.pass).toBe(false);
  });

  it('rejects content starting with # Readme', () => {
    const r = hardFilter('/x/skill.md', '# Readme\nContent');
    expect(r.pass).toBe(false);
  });

  it('passes valid skill paths', () => {
    expect(hardFilter('/repo/skills/scan-net.md').pass).toBe(true);
    expect(hardFilter('/repo/commands/deploy.md').pass).toBe(true);
  });
});

describe('getFeatureVector', () => {
  it('returns a 14-element array', () => {
    const vec = getFeatureVector('# Test\n\n## Steps\n\nDo something.\n');
    expect(vec).toHaveLength(14);
  });

  it('detects instructional headers', () => {
    const withHeaders = getFeatureVector('# Test\n\n## Steps\n\nDo step 1.\n');
    const without = getFeatureVector('Just some random text.');
    expect(withHeaders[2]).toBe(1);
    expect(without[2]).toBe(0);
  });

  it('detects code blocks', () => {
    const v = getFeatureVector('# Test\n\n## Steps\n\n```bash\necho hi\n```\n');
    expect(v[4]).toBe(1);
  });

  it('detects numbered lists', () => {
    const v = getFeatureVector('# Test\n\n## Usage\n\n1. First step\n2. Second step\n');
    expect(v[5]).toBe(1);
  });

  it('detects bullet lists', () => {
    const v = getFeatureVector('# Test\n\n- Item one\n- Item two\n');
    expect(v[6]).toBe(1);
  });

  it('detects short content as negative', () => {
    const v = getFeatureVector('tiny');
    expect(v[12]).toBe(1);
  });

  it('detects missing headers as negative', () => {
    const v = getFeatureVector('Just a paragraph of text without any markdown headers in it.');
    expect(v[13]).toBe(1);
  });

  it('detects doc-like first header', () => {
    const v = getFeatureVector('# Overview\n\n## Section\n\nContent here.');
    expect(v[9]).toBe(1);
  });
});

describe('classify', () => {
  const norm = 384 ** 0.5;
  const mockCentroids = {
    good: Array(384).fill(1 / norm),
    bad: Array(384).fill(-1 / norm),
  };

  it('returns fallback label when no centroids', () => {
    const r = classify([], null);
    expect(r.label).toBe('skill');
    expect(r.method).toBe('fallback');
  });

  it('returns skill for vector close to good centroid', () => {
    const vec = Array(384).fill(0.9 / norm);
    const r = classify(vec, mockCentroids);
    expect(r.label).toBe('skill');
    expect(r.method).toBe('centroid');
  });

  it('returns reject for vector close to bad centroid', () => {
    const vec = Array(384).fill(-0.9 / norm);
    const r = classify(vec, mockCentroids);
    expect(r.label).toBe('reject');
  });
});

describe('isSkillFile hard rejections', () => {
  it('rejects README.md', () => {
    expect(isSkillFile('/x/README.md')).toBe(false);
  });

  it('rejects files in docs/', () => {
    expect(isSkillFile('/project/docs/my-file.md')).toBe(false);
  });

  it('rejects LICENSE.md', () => {
    expect(isSkillFile('/x/LICENSE.md')).toBe(false);
  });

  it('accepts valid skill with frontmatter', () => {
    const fp = write('valid-skill.md', '---\nname: my-valid-skill\ndescription: A valid skill for testing\n---\n\n# My Valid Skill\n\n## Steps\n\nStep one.\n\n## Usage\n\nHow to use.\n\n```sh\necho test\n```');
    expect(isSkillFile(fp)).toBe(true);
  });

  it('accepts valid skill without frontmatter', () => {
    const fp = write('no-fm.md', '# How to Use This Tool\n\n## Steps\n\nFollow these carefully.\n\n## Usage\n\nDo it.\n\n- Step one\n- Step two\n\n```bash\nnpm install\n```');
    expect(isSkillFile(fp)).toBe(true);
  });
});

describe('filterWithClassifier', () => {
  it('returns all skills when no model exists', async () => {
    const skills = [
      { name: 'a', content: '# Test\n\n## Steps\n\nDo it.\n' },
      { name: 'b', content: '# Another\n\nSome text.\n' },
    ];
    const result = await filterWithClassifier(skills);
    expect(result).toHaveLength(2);
  });
});
