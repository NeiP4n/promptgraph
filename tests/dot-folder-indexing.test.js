import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { globSync } from 'glob';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isSkillFile, parseSkillFile } from '../parser.js';
import { skillId } from '../db.js';

// End-to-end (no DB / no network) reproduction of the layouts that previously
// indexed wrong: dot-folders skipped by glob, .github skill dirs filtered out,
// and generic SKILL.md filenames colliding on name.
const root = path.join(os.tmpdir(), 'pg-dotfolder-test');

const SKILL_BODY = '# Heading\n\nA real skill with enough content.\n\n- step one\n- step two\n';

const files = {
  'skills/refactor/SKILL.md': SKILL_BODY,                 // nested folder skill
  'skills/cloud/deploy/SKILL.md': SKILL_BODY,             // deeper nesting
  'skills/cloud/infra/SKILL.md': SKILL_BODY,              // sibling, same filename
  '.github/skills/ms-skill/SKILL.md': SKILL_BODY,         // Copilot dot-folder
  '.github/prompts/handy.md': SKILL_BODY,                 // Copilot prompts
  '.github/workflows/ci.md': SKILL_BODY,                  // must be skipped
  'docs/guide.md': SKILL_BODY,                            // must be skipped
  'README.md': SKILL_BODY,                                // must be skipped
};

beforeAll(() => {
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(root, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('dot-folder + nested indexing pipeline', () => {
  it('glob with dot:true finds .md inside dot-folders', () => {
    const withDot = globSync(`${root}/**/*.md`, { absolute: true, dot: true });
    const withoutDot = globSync(`${root}/**/*.md`, { absolute: true });
    expect(withDot.length).toBe(Object.keys(files).length);     // all 8
    expect(withoutDot.length).toBeLessThan(withDot.length);      // dot-folders missed
  });

  it('isSkillFile keeps real skills, drops docs/workflows/readme', () => {
    const all = globSync(`${root}/**/*.md`, { absolute: true, dot: true });
    const kept = all.filter(fp => isSkillFile(fp));
    const rel = kept.map(fp => fp.slice(root.length + 1).replace(/\\/g, '/')).sort();
    expect(rel).toEqual([
      '.github/prompts/handy.md',
      '.github/skills/ms-skill/SKILL.md',
      'skills/cloud/deploy/SKILL.md',
      'skills/cloud/infra/SKILL.md',
      'skills/refactor/SKILL.md',
    ]);
  });

  it('produces unique skill ids (no SKILL.md collision)', () => {
    const all = globSync(`${root}/**/*.md`, { absolute: true, dot: true });
    const kept = all.filter(fp => isSkillFile(fp));
    const ids = kept.map(fp => skillId('test', parseSkillFile(fp, 'test').name));
    expect(new Set(ids).size).toBe(kept.length);
    const names = kept.map(fp => parseSkillFile(fp, 'test').name);
    expect(names).toContain('refactor');
    expect(names).toContain('deploy');
    expect(names).toContain('infra');
    expect(names).toContain('ms-skill');
  });
});
