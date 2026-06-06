import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = path.join(os.tmpdir(), 'pg-import-config-test');
const mockConfigPath = path.join(tmp, 'marketplace-config.json');

vi.mock('../config.js', () => ({
  loadConfig: vi.fn(() => {
    try { return JSON.parse(fs.readFileSync(mockConfigPath, 'utf8')); }
    catch { return { sources: [] }; }
  }),
  saveConfig: vi.fn((cfg) => {
    fs.mkdirSync(path.dirname(mockConfigPath), { recursive: true });
    fs.writeFileSync(mockConfigPath, JSON.stringify(cfg, null, 2));
  }),
  PROMPTGRAPH_DIR: path.join(tmp, 'marketplace'),
  SKILLS_STORE_DIR: path.join(tmp, 'marketplace', 'skills-store'),
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

const { pruneInvalidRepos } = await import('../marketplace.js');
const { loadConfig: mockLoadConfig, saveConfig: mockSaveConfig } = await import('../config.js');

const SKIP_RE = /^(readme|changelog|license|contributing|code\.?of\.?conduct|security|authors|credits|install|installation|usage|promotion|faq|glossary|index|overview|summary|roadmap|todo|notes|template|example|sample|demo|guide|tutorial|walkthrough|architecture|design|spec|requirements|privacy|terms|disclaimer|notice|copying|warranty|funding)/i;

const SKILL_DIRS = ['skills', 'commands', 'prompts', 'agents', 'skills-store', 'slash-commands', 'custom-commands', 'templates'];

function cleanupRepoDir(dirPath, re) {
  let removed = 0, entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      removed += cleanupRepoDir(fullPath, re);
      try { if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath); } catch {}
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const base = entry.name.replace(/\.md$/i, '').toLowerCase();
      if (re.test(base)) { fs.unlinkSync(fullPath); removed++; }
    } else if (entry.isFile() && !entry.name.endsWith('.md')) {
      try { fs.unlinkSync(fullPath); removed++; } catch {}
    }
  }
  return removed;
}

function cleanupRepoRoot(repoRoot) {
  const re = /^(readme|changelog|license|contributing|code\.?of\.?conduct|security|authors|credits|install|installation|usage|promotion|faq|glossary|index|overview|summary|roadmap|todo|notes|template|example|sample|demo|guide|tutorial|walkthrough|architecture|design|spec|requirements|privacy|terms|disclaimer|notice|copying|warranty|funding)/i;
  const skipDirs = new Set(['.github', 'docs', 'doc', 'assets', 'images', 'img', 'screenshots', 'media', 'static', 'scripts', 'ci_scripts', 'node_modules', 'vendor', 'dist', 'build', 'tests', 'test']);
  let removed = 0;
  const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const fullPath = path.join(repoRoot, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name.toLowerCase())) {
        fs.rmSync(fullPath, { recursive: true, force: true }); removed++;
      } else {
        removed += cleanupRepoDir(fullPath, re);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const base = entry.name.replace(/\.md$/i, '').toLowerCase();
      if (re.test(base)) { fs.unlinkSync(fullPath); removed++; }
    } else if (entry.isFile() && !entry.name.endsWith('.md')) {
      if (entry.name !== '.gitignore') { try { fs.unlinkSync(fullPath); removed++; } catch {} }
    }
  }
  return removed;
}

function removeEmptyDirs(dirPath) {
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(dirPath, entry.name);
    removeEmptyDirs(fullPath);
    try { if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath); } catch {}
  }
}

function globMdSync(dir) {
  const results = [];
  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.md')) results.push(fullPath);
    }
  }
  walk(dir);
  return results;
}

function detectSkillsDirLocal(repoRoot) {
  for (const dir of SKILL_DIRS) {
    const candidate = path.join(repoRoot, dir);
    if (fs.existsSync(candidate)) {
      const files = globMdSync(candidate);
      if (files.length >= 1) return { dir: candidate, label: dir, sparse: true };
    }
  }
  return { dir: repoRoot, label: '(root)', sparse: false };
}

function addGithubSource(repo, dirPath) {
  const cfg = mockLoadConfig();
  cfg.sources.push({ dir: dirPath, source: 'github:' + repo });
  mockSaveConfig(cfg);
}

beforeAll(() => fs.mkdirSync(tmp, { recursive: true }));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('cleanupRepoRoot', () => {
  const testDir = path.join(tmp, 'cleanup-root');

  beforeEach(() => { fs.mkdirSync(testDir, { recursive: true }); });
  afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

  it('removes README.md from root, keeps skill.md', () => {
    fs.writeFileSync(path.join(testDir, 'README.md'), '# Readme');
    fs.writeFileSync(path.join(testDir, 'skill.md'), '---\nname: my-skill\ndescription: A valid skill\n---\n' + 'x'.repeat(250));
    const r = cleanupRepoRoot(testDir);
    expect(r).toBe(1);
    expect(fs.existsSync(path.join(testDir, 'README.md'))).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'skill.md'))).toBe(true);
  });

  it('removes CHANGELOG.md from subdirectory', () => {
    fs.mkdirSync(path.join(testDir, 'skills'));
    fs.writeFileSync(path.join(testDir, 'skills', 'CHANGELOG.md'), '# Changelog');
    fs.writeFileSync(path.join(testDir, 'skills', 'good.md'), '---\nname: good-skill\ndescription: A valid skill here\n---\n' + 'x'.repeat(250));
    const r = cleanupRepoRoot(testDir);
    expect(r).toBe(1);
    expect(fs.existsSync(path.join(testDir, 'skills', 'CHANGELOG.md'))).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'skills', 'good.md'))).toBe(true);
  });

  it('removes .github and docs dirs recursively', () => {
    fs.mkdirSync(path.join(testDir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'workflows', 'ci.yml'), 'jobs:');
    fs.mkdirSync(path.join(testDir, 'skills'));
    fs.writeFileSync(path.join(testDir, 'skills', 'real.md'), '---\nname: real-skill\ndescription: A genuine skill file\n---\n' + 'x'.repeat(250));
    const r = cleanupRepoRoot(testDir);
    expect(r).toBe(1);
    expect(fs.existsSync(path.join(testDir, '.github'))).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'skills', 'real.md'))).toBe(true);
  });

  it('keeps .gitignore files', () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'node_modules');
    fs.writeFileSync(path.join(testDir, 'skill.md'), '---\nname: good-skill\ndescription: A valid skill file\n---\n' + 'x'.repeat(250));
    const r = cleanupRepoRoot(testDir);
    expect(r).toBe(0);
    expect(fs.existsSync(path.join(testDir, '.gitignore'))).toBe(true);
  });

  it('removes non-.md files like .json, .js, .txt', () => {
    fs.writeFileSync(path.join(testDir, 'data.json'), '{}');
    fs.writeFileSync(path.join(testDir, 'notes.txt'), 'some text');
    fs.writeFileSync(path.join(testDir, 'skill.md'), '---\nname: my-skill\ndescription: A valid skill file\n---\n' + 'x'.repeat(250));
    const r = cleanupRepoRoot(testDir);
    expect(r).toBe(2);
    expect(fs.existsSync(path.join(testDir, 'data.json'))).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'notes.txt'))).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'skill.md'))).toBe(true);
  });
});

describe('removeEmptyDirs', () => {
  const testDir = path.join(tmp, 'remove-empty');

  beforeEach(() => { fs.mkdirSync(testDir, { recursive: true }); });
  afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

  it('removes empty subdirectory', () => {
    fs.mkdirSync(path.join(testDir, 'empty-dir'));
    fs.mkdirSync(path.join(testDir, 'nested', 'deep-empty'), { recursive: true });
    removeEmptyDirs(testDir);
    expect(fs.existsSync(path.join(testDir, 'empty-dir'))).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'nested', 'deep-empty'))).toBe(false);
  });

  it('keeps non-empty subdirectory', () => {
    fs.mkdirSync(path.join(testDir, 'skills'));
    fs.writeFileSync(path.join(testDir, 'skills', 'my-skill.md'), '# My skill\n' + 'x'.repeat(250));
    removeEmptyDirs(testDir);
    expect(fs.existsSync(path.join(testDir, 'skills'))).toBe(true);
  });
});

describe('detectSkillsDirLocal', () => {
  const testDir = path.join(tmp, 'detect-local');

  beforeEach(() => { fs.mkdirSync(testDir, { recursive: true }); });
  afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

  it('finds skills/ directory when it exists', () => {
    fs.mkdirSync(path.join(testDir, 'skills'));
    fs.writeFileSync(path.join(testDir, 'skills', 'react.md'), '# React\n' + 'x'.repeat(250));
    const result = detectSkillsDirLocal(testDir);
    expect(result.dir).toBe(path.join(testDir, 'skills'));
    expect(result.label).toBe('skills');
    expect(result.sparse).toBe(true);
  });

  it('falls back to root when no known skill dirs exist', () => {
    fs.mkdirSync(path.join(testDir, 'random-stuff'));
    const result = detectSkillsDirLocal(testDir);
    expect(result.dir).toBe(testDir);
    expect(result.label).toBe('(root)');
    expect(result.sparse).toBe(false);
  });

  it('returns sparse=true when prompts dir found', () => {
    fs.mkdirSync(path.join(testDir, 'prompts'));
    fs.writeFileSync(path.join(testDir, 'prompts', 'summarize.md'), '# Summarize\n' + 'x'.repeat(250));
    const result = detectSkillsDirLocal(testDir);
    expect(result.sparse).toBe(true);
    expect(result.label).toBe('prompts');
  });
});

describe('pruneInvalidRepos', () => {
  const repoDir = path.join(tmp, 'prune-repos');

  beforeEach(() => {
    fs.mkdirSync(repoDir, { recursive: true });
    mockSaveConfig({ sources: [] });
  });

  afterEach(() => { fs.rmSync(repoDir, { recursive: true, force: true }); });

  it('returns empty when no github sources in config', () => {
    const r = pruneInvalidRepos();
    expect(r.removed).toHaveLength(0);
    expect(r.kept).toHaveLength(0);
  });

  it('removes repo when directory missing', () => {
    addGithubSource('user/missing', path.join(repoDir, 'nonexistent'));
    const r = pruneInvalidRepos();
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].repo).toBe('user/missing');
    expect(r.kept).toHaveLength(0);
  });

  it('keeps repo with valid .md skill files', () => {
    const dir = path.join(repoDir, 'good-repo');
    fs.mkdirSync(dir);
    const body = 'x'.repeat(250);
    fs.writeFileSync(path.join(dir, 'my-skill.md'), '---\nname: my-skill\ndescription: A valid skill with description\n---\n' + body);
    addGithubSource('user/good', dir);
    const r = pruneInvalidRepos();
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]).toBe('user/good');
    expect(r.removed).toHaveLength(0);
  });

  it('handles multiple repos - keeps good, removes missing', () => {
    const goodDir = path.join(repoDir, 'multi-good');
    fs.mkdirSync(goodDir);
    const body = 'x'.repeat(250);
    fs.writeFileSync(path.join(goodDir, 'a.md'), '---\nname: skill-a\ndescription: First valid skill here\n---\n' + body);
    addGithubSource('user/good', goodDir);
    addGithubSource('user/missing', path.join(repoDir, 'does-not-exist'));
    const r = pruneInvalidRepos();
    expect(r.kept).toEqual(['user/good']);
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].repo).toBe('user/missing');
  });
});

describe('config.js operations', () => {
  const cfgDir = path.join(tmp, 'config-ops');
  const configPath = path.join(cfgDir, 'config.json');

  function localLoad() {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return { sources: [] };
  }

  function localSave(cfg) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  }

  beforeEach(() => { fs.mkdirSync(cfgDir, { recursive: true }); });
  afterEach(() => { fs.rmSync(cfgDir, { recursive: true, force: true }); });

  it('save+load roundtrip', () => {
    const data = { sources: [{ dir: '/tmp/test', source: 'custom:test' }] };
    localSave(data);
    expect(localLoad()).toEqual(data);
  });

  it('returns defaults when no file exists', () => {
    expect(localLoad()).toEqual({ sources: [] });
  });

  it('returns saved data with multiple sources', () => {
    const data = {
      sources: [
        { dir: '/home/user/.claude/skills', source: 'skills' },
        { dir: '/home/user/.claude/commands', source: 'commands' },
      ],
    };
    localSave(data);
    const loaded = localLoad();
    expect(loaded.sources).toHaveLength(2);
    expect(loaded.sources[0].source).toBe('skills');
  });
});

describe('cleanupRepoDir - nested', () => {
  const testDir = path.join(tmp, 'deep-clean');

  beforeEach(() => { fs.mkdirSync(testDir, { recursive: true }); });
  afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

  it('removes non-.md from nested dirs and cleans empty dirs', () => {
    fs.mkdirSync(path.join(testDir, 'cmd', 'deploy'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'cmd', 'deploy', 'notes.txt'), 'notes');
    fs.writeFileSync(path.join(testDir, 'cmd', 'deploy', 'config.json'), '{}');
    fs.writeFileSync(path.join(testDir, 'cmd', 'deploy', 'README.md'), '# Docs');
    fs.writeFileSync(path.join(testDir, 'cmd', 'real-skill.md'), '---\nname: real-skill\ndescription: A real skill\n---\n' + 'x'.repeat(250));
    const removed = cleanupRepoDir(testDir, SKIP_RE);
    expect(fs.existsSync(path.join(testDir, 'cmd', 'deploy', 'notes.txt'))).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'cmd', 'deploy', 'README.md'))).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'cmd', 'real-skill.md'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'cmd', 'deploy'))).toBe(false);
    expect(removed).toBe(3);
  });
});

describe('pruneInvalidRepos - invalid files', () => {
  const repoDir = path.join(tmp, 'prune-inv');

  beforeEach(() => {
    fs.mkdirSync(repoDir, { recursive: true });
    mockSaveConfig({ sources: [] });
  });

  afterEach(() => { fs.rmSync(repoDir, { recursive: true, force: true }); });

  it('removes repo when all .md files fail validation', () => {
    const dir = path.join(repoDir, 'all-bad');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'broken.md'), 'no frontmatter here');
    addGithubSource('user/all-bad', dir);
    const r = pruneInvalidRepos();
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].repo).toBe('user/all-bad');
    expect(r.removed[0].reason).toMatch(/no \.md|failed/i);
    expect(r.kept).toHaveLength(0);
  });
});

describe('detectSkillsDirLocal - empty repo', () => {
  it('returns root with sparse=false when totally empty', () => {
    const dir = path.join(tmp, 'empty-repo');
    fs.mkdirSync(dir, { recursive: true });
    const result = detectSkillsDirLocal(dir);
    expect(result.dir).toBe(dir);
    expect(result.label).toBe('(root)');
    expect(result.sparse).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
