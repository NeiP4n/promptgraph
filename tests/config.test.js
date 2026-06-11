import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import { sanitizePath, PLATFORM_SKILLS_DIRS, getSkillsStoreDir } from '../config.js';

describe('sanitizePath', () => {
  it('blocks path traversal', () => {
    expect(() => sanitizePath('../etc/passwd')).toThrow(/traversal/i);
    expect(() => sanitizePath('a/../../b')).toThrow(/traversal/i);
  });

  it('resolves a normal path to absolute', () => {
    const out = sanitizePath('some/dir');
    expect(path.isAbsolute(out)).toBe(true);
  });
});

describe('PLATFORM_SKILLS_DIRS', () => {
  it('maps each supported platform to a skills dir', () => {
    for (const p of ['claude-code', 'opencode', 'cursor', 'windsurf', 'cline', 'codex']) {
      expect(typeof PLATFORM_SKILLS_DIRS[p]).toBe('string');
    }
  });

  it('non-Claude platforms do not point inside ~/.claude', () => {
    expect(PLATFORM_SKILLS_DIRS['opencode']).not.toContain(path.join('.claude'));
    expect(PLATFORM_SKILLS_DIRS['cursor']).not.toContain(path.join('.claude'));
    expect(PLATFORM_SKILLS_DIRS['opencode']).toContain(path.join('opencode'));
  });
});

describe('getSkillsStoreDir', () => {
  it('uses config.skillsDir when set', () => {
    const custom = path.join(os.tmpdir(), 'my-skills');
    expect(getSkillsStoreDir({ skillsDir: custom })).toBe(custom);
  });

  it('falls back to a skills-store dir when unset', () => {
    expect(getSkillsStoreDir({})).toMatch(/skills-store$/);
  });
});
