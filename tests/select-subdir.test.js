import { describe, it, expect } from 'vitest';
import { selectSkillSubdir, bundleDisplayName } from '../github-import.js';

describe('selectSkillSubdir', () => {
  it('returns null for empty input', () => {
    expect(selectSkillSubdir([])).toBe(null);
    expect(selectSkillSubdir(null)).toBe(null);
  });

  it('picks a top-level skills/ dir', () => {
    const r = selectSkillSubdir(['skills/a.md', 'skills/b.md', 'README.md']);
    expect(r.subdir).toBe('skills');
    expect(r.validMdCount).toBe(2);
  });

  it('counts nested category folders recursively (skills/cloud/<name>/SKILL.md)', () => {
    const r = selectSkillSubdir([
      'skills/cloud/deploy/SKILL.md',
      'skills/cloud/infra/SKILL.md',
      'skills/local/run/SKILL.md',
      'README.md',
    ]);
    expect(r.subdir).toBe('skills');
    expect(r.validMdCount).toBe(3);
  });

  it('detects GitHub Copilot .github/skills convention', () => {
    const r = selectSkillSubdir([
      'Agents.md',
      '.github/skills/one/SKILL.md',
      '.github/skills/two/SKILL.md',
      '.github/workflows/ci.md',
      'docs/guide.md',
    ]);
    expect(r.subdir).toBe('.github/skills');
    expect(r.validMdCount).toBe(2);   // workflows + docs excluded
  });

  it('detects .claude/skills nested dir', () => {
    const r = selectSkillSubdir(['.claude/skills/x/SKILL.md', '.claude/skills/y/SKILL.md']);
    expect(r.subdir).toBe('.claude/skills');
    expect(r.validMdCount).toBe(2);
  });

  it('falls back to root when skills sit at the repo root', () => {
    const r = selectSkillSubdir(['commit-msg.md', 'refactor.md', 'LICENSE.md']);
    expect(r.subdir).toBe(null);
    expect(r.label).toBe('root');
    expect(r.validMdCount).toBe(2);   // LICENSE excluded
  });

  it('prefers known skill dir names over arbitrary folders', () => {
    const r = selectSkillSubdir([
      'misc/a.md', 'misc/b.md', 'misc/c.md',
      'prompts/p.md',
    ]);
    expect(r.subdir).toBe('prompts');   // SKILL_DIRS priority beats bigger misc/
  });

  it('returns null when everything is filtered (docs/tests only)', () => {
    expect(selectSkillSubdir(['docs/a.md', 'tests/b.md', 'README.md'])).toBe(null);
  });

  it('reports hasScripts when scripts live under the chosen subdir', () => {
    const withScripts = selectSkillSubdir(['skills/a/SKILL.md', 'skills/a/run.py']);
    expect(withScripts.hasScripts).toBe(true);
    const noScripts = selectSkillSubdir(['skills/a/SKILL.md', 'skills/a/notes.txt']);
    expect(noScripts.hasScripts).toBe(false);
  });

  it('ignores scripts that sit outside the chosen subdir', () => {
    const r = selectSkillSubdir(['skills/a/SKILL.md', 'tooling/build.py']);
    expect(r.subdir).toBe('skills');
    expect(r.hasScripts).toBe(false);
  });
});

describe('bundleDisplayName', () => {
  it('prefixes owner for generic repo names', () => {
    expect(bundleDisplayName('rockorager/skills')).toBe('Rockorager Skills');
    expect(bundleDisplayName('vercel-labs/skills')).toBe('Vercel Labs Skills');
    expect(bundleDisplayName('microsoft/skills')).toBe('Microsoft Skills');
    expect(bundleDisplayName('google/skills')).toBe('Google Skills');
  });

  it('uses the repo name when it is descriptive', () => {
    expect(bundleDisplayName('softaworks/agent-toolkit')).toBe('Agent Toolkit');
    expect(bundleDisplayName('shinpr/claude-code-workflows')).toBe('Claude Code Workflows');
  });

  it('handles full github URLs and .git suffix', () => {
    expect(bundleDisplayName('https://github.com/rockorager/skills.git')).toBe('Rockorager Skills');
  });
});
