import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = path.join(os.tmpdir(), 'pg-marketplace-test');

// ── Mock config ────────────────────────────────────────────────────────────────
const mockConfigPath = path.join(tmp, 'config.json');
const mockCachePath = path.join(tmp, 'skill-counts.json');
const mockPromptgraphDir = tmp;

vi.mock('../config.js', () => ({
  loadConfig: vi.fn(() => {
    try { return JSON.parse(fs.readFileSync(mockConfigPath, 'utf8')); }
    catch { return { sources: [] }; }
  }),
  saveConfig: vi.fn((cfg) => {
    fs.mkdirSync(path.dirname(mockConfigPath), { recursive: true });
    fs.writeFileSync(mockConfigPath, JSON.stringify(cfg, null, 2));
  }),
  PROMPTGRAPH_DIR: mockPromptgraphDir,
  SKILLS_STORE_DIR: path.join(tmp, 'skills-store'),
}));

vi.mock('../github-import.js', () => ({
  importFromGitHub: vi.fn(),
  validateRepoSkills: vi.fn(),
}));

vi.mock('../db.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: vi.fn(), all: vi.fn(() => []), get: vi.fn() })),
  })),
}));

// Must import AFTER mocks
const { pruneInvalidRepos } = await import('../marketplace.js');
const { loadConfig, saveConfig } = await import('../config.js');
const { validateSkill } = await import('../validator.js');

beforeEach(() => {
  fs.mkdirSync(tmp, { recursive: true });
  saveConfig({ sources: [] });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── pruneInvalidRepos ──────────────────────────────────────────────────────────

function addGithubSource(repo, dir) {
  const cfg = loadConfig();
  cfg.sources.push({ dir, source: `github:${repo}` });
  saveConfig(cfg);
}

describe('pruneInvalidRepos', () => {
  it('returns empty when no github sources exist', () => {
    const r = pruneInvalidRepos();
    expect(r.removed).toHaveLength(0);
    expect(r.kept).toHaveLength(0);
  });

  it('removes repos with missing directory', () => {
    addGithubSource('user/missing-repo', path.join(tmp, 'nonexistent'));
    const r = pruneInvalidRepos();
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].repo).toBe('user/missing-repo');
    expect(r.kept).toHaveLength(0);
  });

  it('removes repos with no .md files', () => {
    const dir = path.join(tmp, 'empty-repo');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'not md');
    addGithubSource('user/empty', dir);

    const r = pruneInvalidRepos();
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].reason).toMatch(/no \.md/i);
  });

  it('keeps repos with valid skills', () => {
    const dir = path.join(tmp, 'good-repo');
    fs.mkdirSync(dir);
    const body = 'x'.repeat(250);
    fs.writeFileSync(path.join(dir, 'good-skill.md'), `---\nname: good-skill\ndescription: A valid skill with proper description\n---\n${body}`);
    addGithubSource('user/good', dir);

    const r = pruneInvalidRepos();
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]).toBe('user/good');
    expect(r.removed).toHaveLength(0);
  });

  it('removes repos with invalid skill files', () => {
    const dir = path.join(tmp, 'bad-repo');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'bad.md'), 'no frontmatter here');
    addGithubSource('user/bad', dir);

    const r = pruneInvalidRepos();
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].reason).toMatch(/failed validation/i);
  });

  it('removes dirs with mixed valid/invalid skills', () => {
    const dir = path.join(tmp, 'mixed-repo');
    fs.mkdirSync(dir);
    const body = 'x'.repeat(250);
    fs.writeFileSync(path.join(dir, 'valid.md'), `---\nname: valid-skill\ndescription: A valid skill with proper description\n---\n${body}`);
    fs.writeFileSync(path.join(dir, 'invalid.md'), `---\nname: bad name!!!\ndescription: short\n---\n${body}`);
    addGithubSource('user/mixed', dir);

    const r = pruneInvalidRepos();
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].reason).toMatch(/1\/2.*failed/);
    expect(r.kept).toHaveLength(0);
  });

  it('handles multiple repos — keeps good, removes bad', () => {
    const goodDir = path.join(tmp, 'good');
    fs.mkdirSync(goodDir);
    const body = 'x'.repeat(250);
    fs.writeFileSync(goodDir + '/a.md', `---\nname: skill-a\ndescription: A valid skill with proper description\n---\n${body}`);
    addGithubSource('user/good', goodDir);

    const badDir = path.join(tmp, 'bad');
    fs.mkdirSync(badDir);
    fs.writeFileSync(badDir + '/b.md', 'no fm');
    addGithubSource('user/bad', badDir);

    const r = pruneInvalidRepos();
    expect(r.kept).toEqual(['user/good']);
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].repo).toBe('user/bad');
  });
});

// ── isSkillFile (used by countRepoSkills) ──────────────────────────────────────

const SKIP_DOCS = /^(readme|license|changelog|contributing|code.?of.?conduct|security|authors|credits|install|faq|index|overview|summary|todo|notes|template|copying|warranty|funding|roadmap)/i;

function isSkillFile(filePath) {
  const name = filePath.split('/').pop().toLowerCase();
  return name.endsWith('.md') && !SKIP_DOCS.test(name.replace(/\.md$/i, ''));
}

describe('isSkillFile (countRepoSkills filter)', () => {
  it('counts only .md files that are not docs', () => {
    const files = [
      'skills/react.md',
      'README.md',
      'skills/vue.md',
      'docs/index.md',
      'CHANGELOG.md',
    ];
    const skillFiles = files.filter(isSkillFile);
    expect(skillFiles).toEqual(['skills/react.md', 'skills/vue.md']);
  });

  it('handles Trees API paths correctly', () => {
    const tree = [
      { type: 'blob', path: 'skills/my-skill.md' },
      { type: 'blob', path: 'README.md' },
      { type: 'tree', path: 'docs' },
    ];
    const count = tree.filter(f => f.type === 'blob' && isSkillFile(f.path)).length;
    expect(count).toBe(1);
  });
});
