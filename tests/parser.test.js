import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseSkillFile, isSkillFile } from '../parser.js';

const tmp = path.join(os.tmpdir(), 'pg-parser-test');

beforeAll(() => fs.mkdirSync(tmp, { recursive: true }));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(name, content) {
  const fp = path.join(tmp, name);
  fs.writeFileSync(fp, content);
  return fp;
}

describe('parseSkillFile', () => {
  it('reads name and description from frontmatter', () => {
    const fp = write('a.md', '---\nname: my-skill\ndescription: Does a thing\n---\n\n# Body\nContent here.');
    const s = parseSkillFile(fp, 'test');
    expect(s.name).toBe('my-skill');
    expect(s.description).toBe('Does a thing');
    expect(s.source).toBe('test');
  });

  it('falls back to filename when no name', () => {
    const fp = write('fallback.md', '# Just a heading\nSome text.');
    const s = parseSkillFile(fp, 'test');
    expect(s.name).toBe('fallback');
  });

  it('extracts skill references but not URLs', () => {
    const fp = write('refs.md', '---\nname: x\ndescription: y\n---\nUse /other-skill here. Visit https://example.com/path now.');
    const s = parseSkillFile(fp, 'test');
    expect(s.calls).toContain('other-skill');
    expect(s.calls).not.toContain('path');
  });

  it('survives malformed frontmatter', () => {
    const fp = write('bad.md', '---\nname: [unclosed\n---\ncontent');
    expect(() => parseSkillFile(fp, 'test')).not.toThrow();
  });
});

describe('isSkillFile', () => {
  it('rejects readme/changelog/license', () => {
    expect(isSkillFile('/x/README.md')).toBe(false);
    expect(isSkillFile('/x/CHANGELOG.md')).toBe(false);
    expect(isSkillFile('/x/LICENSE.md')).toBe(false);
  });

  it('accepts files that pass hard filter', () => {
    const fp = write('real-skill.md', '---\nname: real-skill\ndescription: A real skill for testing\n---\n\n# Real Skill\n\nThis is a real skill with instructions.\n\n## How to use\n\n- Step one\n- Step two\n\n```bash\necho hello\n```\n');
    expect(isSkillFile(fp)).toBe(true);
  });

  it('rejects content starting with "# Readme"', () => {
    const fp = write('test-file.md', '# Readme for the project\n\n## Test\nContent.\n');
    expect(isSkillFile(fp)).toBe(false);
  });

  it('rejects badge-only content', () => {
    const fp = write('badge-file.md', '[![Build](https://img.shields.io/badge/build-passing-green)]\n\nContent.');
    expect(isSkillFile(fp)).toBe(false);
  });
});
