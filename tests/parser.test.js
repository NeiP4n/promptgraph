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

  it('derives name from parent folder for generic SKILL.md', () => {
    const dir = path.join(tmp, 'agent-platform-deploy');
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, 'SKILL.md');
    fs.writeFileSync(fp, '# Deploy\nDeploy the agent platform.');
    const s = parseSkillFile(fp, 'test');
    expect(s.name).toBe('agent-platform-deploy');
  });

  it('keeps distinct names for SKILL.md in different folders (no collision)', () => {
    const a = path.join(tmp, 'cloud-deploy');
    const b = path.join(tmp, 'cloud-infra');
    fs.mkdirSync(a, { recursive: true });
    fs.mkdirSync(b, { recursive: true });
    fs.writeFileSync(path.join(a, 'SKILL.md'), '# A\nbody');
    fs.writeFileSync(path.join(b, 'SKILL.md'), '# B\nbody');
    expect(parseSkillFile(path.join(a, 'SKILL.md'), 'test').name).toBe('cloud-deploy');
    expect(parseSkillFile(path.join(b, 'SKILL.md'), 'test').name).toBe('cloud-infra');
  });

  it('derives name from folder for index.md / agent.md too', () => {
    const dir = path.join(tmp, 'my-thing');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.md'), '# x\nbody');
    fs.writeFileSync(path.join(dir, 'agent.md'), '# y\nbody');
    expect(parseSkillFile(path.join(dir, 'index.md'), 'test').name).toBe('my-thing');
    expect(parseSkillFile(path.join(dir, 'agent.md'), 'test').name).toBe('my-thing');
  });

  it('frontmatter name still wins over folder name', () => {
    const dir = path.join(tmp, 'folder-name');
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, 'SKILL.md');
    fs.writeFileSync(fp, '---\nname: explicit-name\ndescription: d\n---\nbody');
    expect(parseSkillFile(fp, 'test').name).toBe('explicit-name');
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

  it('skips files inside docs/ and tests/ dirs', () => {
    expect(isSkillFile('/repo/docs/guide.md', 'content')).toBe(false);
    expect(isSkillFile('/repo/tests/case.md', 'content')).toBe(false);
    expect(isSkillFile('/repo/.github/workflows/ci.md', 'content')).toBe(false);
  });

  it('allows GitHub Copilot skill dirs under .github', () => {
    const raw = '# Skill\n\nReal instructions.\n\n- step';
    expect(isSkillFile('/repo/.github/skills/my-skill/SKILL.md', raw)).toBe(true);
    expect(isSkillFile('/repo/.github/prompts/p.md', raw)).toBe(true);
    expect(isSkillFile('/repo/.github/agents/a.md', raw)).toBe(true);
    expect(isSkillFile('/repo/.github/commands/c.md', raw)).toBe(true);
  });

  it('still skips non-skill .github subdirs', () => {
    const raw = '# x\n\ncontent';
    expect(isSkillFile('/repo/.github/plugins/big.md', raw)).toBe(false);
    expect(isSkillFile('/repo/.github/ISSUE_TEMPLATE/bug.md', raw)).toBe(false);
  });
});
