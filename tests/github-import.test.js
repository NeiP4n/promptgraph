import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = path.join(os.tmpdir(), 'pg-github-test');
const SKILL_DIRS = ['skills', 'commands', 'prompts', 'agents', 'skills-store', 'slash-commands', 'custom-commands', 'templates'];

beforeEach(() => fs.mkdirSync(tmp, { recursive: true }));
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ── detectSkillsDirFromAPI candidate selection logic ──────────────────────────

function pickBestSubdir(entries) {
  const SKILL_DIRS = ['skills', 'commands', 'prompts', 'agents', 'skills-store', 'slash-commands', 'custom-commands', 'templates'];
  const SKIP_DIRS_API = new Set([
    '.github', 'docs', 'doc', 'documentation', 'assets', 'images', 'img',
    'screenshots', 'media', 'static', 'scripts', 'ci_scripts',
    'node_modules', 'vendor', 'dist', 'build', 'tests', 'test',
    'examples', 'example', 'fixtures', '.vscode', '.idea',
  ]);

  const dirMap = new Map(entries.filter(e => e.type === 'dir').map(e => [e.name.toLowerCase(), e.name]));
  for (const d of SKILL_DIRS) {
    if (dirMap.has(d)) return { subdir: dirMap.get(d), label: d };
  }

  const subdirCandidates = entries.filter(e => e.type === 'dir' && !SKIP_DIRS_API.has(e.name.toLowerCase()));
  let best = null, bestCount = 0;
  for (const dir of subdirCandidates) {
    const mdCount = (dir.mockEntries || []).filter(e => e.endsWith('.md')).length;
    if (mdCount >= 1 && mdCount > bestCount) { best = dir.name; bestCount = mdCount; }
  }
  if (best) return { subdir: best, label: best };
  return null;
}

describe('pickBestSubdir', () => {
  it('prefers known skill dir names', () => {
    const entries = [
      { type: 'dir', name: 'skills' },
      { type: 'dir', name: 'docs' },
    ];
    expect(pickBestSubdir(entries)).toEqual({ subdir: 'skills', label: 'skills' });
  });

  it('returns null when only skip-dirs exist', () => {
    const entries = [
      { type: 'dir', name: 'docs' },
      { type: 'dir', name: '.github' },
      { type: 'dir', name: 'node_modules' },
    ];
    expect(pickBestSubdir(entries)).toBeNull();
  });

  it('falls back to subdir with most .md files', () => {
    const entries = [
      { type: 'dir', name: 'prompts', mockEntries: ['a.md', 'b.md'] },
      { type: 'dir', name: 'stuff', mockEntries: ['x.md'] },
    ];
    expect(pickBestSubdir(entries)).toEqual({ subdir: 'prompts', label: 'prompts' });
  });

  it('returns null for empty repo', () => {
    expect(pickBestSubdir([])).toBeNull();
  });
});

// ── SKIP_DOCS filtering ────────────────────────────────────────────────────────

const SKIP_DOCS = /^(readme|license|changelog|contributing|code.?of.?conduct|security|authors|credits|install|faq|index|overview|summary|todo|notes|template|copying|warranty|funding|roadmap)/i;

function isSkillFile(path) {
  const name = path.split('/').pop().toLowerCase();
  return name.endsWith('.md') && !SKIP_DOCS.test(name.replace(/\.md$/i, ''));
}

describe('isSkillFile', () => {
  it('accepts valid skill .md', () => {
    expect(isSkillFile('skills/my-skill.md')).toBe(true);
  });

  it('accepts nested skill .md', () => {
    expect(isSkillFile('some/deep/path/react-basics.md')).toBe(true);
  });

  it('rejects README.md', () => {
    expect(isSkillFile('README.md')).toBe(false);
  });

  it('rejects doc files', () => {
    const docs = ['LICENSE.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'INDEX.md', 'FAQ.md'];
    for (const d of docs) expect(isSkillFile(d)).toBe(false);
  });

  it('rejects non-.md files', () => {
    expect(isSkillFile('script.js')).toBe(false);
    expect(isSkillFile('data.json')).toBe(false);
  });

  it('rejects case-insensitively', () => {
    expect(isSkillFile('Readme.md')).toBe(false);
    expect(isSkillFile('LICENSE.MD')).toBe(false);
  });
});

// ── validate-repo-action.js pure functions ─────────────────────────────────────

const SKIP_RE = /^(readme|changelog|license|contributing|code\.?of\.?conduct|security|authors|credits|install|installation|usage|promotion|faq|glossary|index|overview|summary|roadmap|todo|notes|template|example|sample|demo|guide|tutorial|walkthrough|architecture|design|spec|requirements|privacy|terms|disclaimer|notice|copying|warranty|funding|changelog)/i;

const SKIP_DIRS_LOCAL = new Set([
  '.github', 'docs', 'doc', 'documentation', 'assets', 'images', 'img',
  'screenshots', 'media', 'static', 'scripts', 'ci_scripts',
  'node_modules', 'vendor', 'dist', 'build', 'tests', 'test',
  'examples', 'example', 'fixtures',
  'src', 'cli', 'lib', 'bin',
]);

function isDocFile(name) {
  const base = path.basename(name, '.md').toLowerCase();
  return SKIP_RE.test(base);
}

function isSkipDir(name) {
  return SKIP_DIRS_LOCAL.has(name.toLowerCase());
}

function findSubdirMdFiles(repoRoot) {
  const files = [];
  const entries = fs.readdirSync(repoRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const fullPath = path.join(repoRoot, entry.name);
    if (entry.isDirectory()) {
      if (isSkipDir(entry.name)) continue;
      walkDir(fullPath, entry.name, files);
    }
  }
  return files;
}

function walkDir(dirPath, relativePrefix, out) {
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = relativePrefix + '/' + entry.name;
    if (entry.isDirectory()) {
      if (isSkipDir(entry.name)) continue;
      walkDir(fullPath, relativePath, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      if (isDocFile(entry.name)) continue;
      out.push({ path: fullPath, relative: relativePath });
    }
  }
}

describe('isDocFile', () => {
  it('identifies doc files', () => {
    expect(isDocFile('README.md')).toBe(true);
    expect(isDocFile('CHANGELOG.md')).toBe(true);
    expect(isDocFile('LICENSE.md')).toBe(true);
    expect(isDocFile('CONTRIBUTING.md')).toBe(true);
  });

  it('rejects skill files', () => {
    expect(isDocFile('react-component.md')).toBe(false);
    expect(isDocFile('my-awesome-skill.md')).toBe(false);
  });

  it('handles case insensitivity', () => {
    expect(isDocFile('Readme.md')).toBe(true);
    expect(isDocFile('LICENSE.MD')).toBe(true);
  });
});

describe('isSkipDir', () => {
  it('skips known non-skill dirs', () => {
    expect(isSkipDir('.github')).toBe(true);
    expect(isSkipDir('docs')).toBe(true);
    expect(isSkipDir('node_modules')).toBe(true);
    expect(isSkipDir('assets')).toBe(true);
  });

  it('allows skill dirs', () => {
    expect(isSkipDir('skills')).toBe(false);
    expect(isSkipDir('prompts')).toBe(false);
    expect(isSkipDir('agents')).toBe(false);
  });
});

// ── Recursive cleanup (README anywhere) ───────────────────────────────────────

function cleanupRepoDir(dirPath) {
  let removed = 0;
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      removed += cleanupRepoDir(fullPath);
      try { if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath); } catch {}
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const base = entry.name.replace(/\.md$/i, '').toLowerCase();
      if (SKIP_RE.test(base)) {
        fs.unlinkSync(fullPath);
        removed++;
      }
    } else if (entry.isFile() && !entry.name.endsWith('.md')) {
      try { fs.unlinkSync(fullPath); removed++; } catch {}
    }
  }
  return removed;
}

function cleanupRepoRoot(repoRoot) {
  const SKIP_DIRS_LOCAL = new Set(['.github', 'docs', 'doc', 'assets', 'images', 'img', 'screenshots', 'media', 'static', 'scripts', 'ci_scripts', 'node_modules', 'vendor', 'dist', 'build', 'tests', 'test', 'src', 'cli', 'lib', 'bin']);
  let removed = 0;
  const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const fullPath = path.join(repoRoot, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS_LOCAL.has(entry.name.toLowerCase())) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        removed++;
      } else {
        removed += cleanupRepoDir(fullPath);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const base = entry.name.replace(/\.md$/i, '').toLowerCase();
      if (SKIP_RE.test(base)) { fs.unlinkSync(fullPath); removed++; }
    } else if (entry.isFile() && !entry.name.endsWith('.md')) {
      if (entry.name !== '.gitignore') { try { fs.unlinkSync(fullPath); removed++; } catch {} }
    }
  }
  return removed;
}

describe('cleanupRepoRoot', () => {
  it('removes README.md from root', () => {
    fs.writeFileSync(path.join(tmp, 'README.md'), 'readme');
    fs.writeFileSync(path.join(tmp, 'skill.md'), '---\nname: ok\ndescription: skill here\n---\n' + 'x'.repeat(250));
    const r = cleanupRepoRoot(tmp);
    expect(r).toBe(1);
    expect(fs.existsSync(path.join(tmp, 'README.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'skill.md'))).toBe(true);
  });

  it('removes README.md from subdirectories', () => {
    fs.mkdirSync(path.join(tmp, 'skills'));
    fs.writeFileSync(path.join(tmp, 'skills', 'README.md'), 'readme');
    fs.writeFileSync(path.join(tmp, 'skills', 'good.md'), '---\nname: ok\ndescription: skill here\n---\n' + 'x'.repeat(250));
    cleanupRepoRoot(tmp);
    expect(fs.existsSync(path.join(tmp, 'skills', 'README.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'skills', 'good.md'))).toBe(true);
  });

  it('removes doc files from nested subdirs', () => {
    fs.mkdirSync(path.join(tmp, 'skills', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'skills', 'nested', 'LICENSE.md'), 'license');
    fs.writeFileSync(path.join(tmp, 'skills', 'nested', 'real.md'), '---\nname: ok\ndescription: skill here\n---\n' + 'x'.repeat(250));
    cleanupRepoRoot(tmp);
    expect(fs.existsSync(path.join(tmp, 'skills', 'nested', 'LICENSE.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'skills', 'nested', 'real.md'))).toBe(true);
  });

  it('removes non-.md files from subdirectories', () => {
    fs.mkdirSync(path.join(tmp, 'skills'));
    fs.writeFileSync(path.join(tmp, 'skills', 'data.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'skills', 'skill.md'), '---\nname: ok\ndescription: skill here\n---\n' + 'x'.repeat(250));
    cleanupRepoRoot(tmp);
    expect(fs.existsSync(path.join(tmp, 'skills', 'data.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'skills', 'skill.md'))).toBe(true);
  });

  it('keeps .gitignore files', () => {
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules');
    fs.mkdirSync(path.join(tmp, 'skills'));
    fs.writeFileSync(path.join(tmp, 'skills', 'skill.md'), '---\nname: ok\ndescription: skill here\n---\n' + 'x'.repeat(250));
    cleanupRepoRoot(tmp);
    expect(fs.existsSync(path.join(tmp, '.gitignore'))).toBe(true);
  });

  it('removes known skip-dirs recursively', () => {
    fs.mkdirSync(path.join(tmp, '.github'));
    fs.writeFileSync(path.join(tmp, '.github', 'whatever.md'), '');
    fs.mkdirSync(path.join(tmp, 'skills'));
    fs.writeFileSync(path.join(tmp, 'skills', 'real.md'), '---\nname: ok\ndescription: skill here\n---\n' + 'x'.repeat(250));
    cleanupRepoRoot(tmp);
    expect(fs.existsSync(path.join(tmp, '.github'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'skills', 'real.md'))).toBe(true);
  });
});

describe('findSubdirMdFiles', () => {
  it('finds .md files in subdirectories only', () => {
    fs.writeFileSync(path.join(tmp, 'README.md'), 'doc');
    fs.writeFileSync(path.join(tmp, 'root.md'), 'root skill');
    fs.mkdirSync(path.join(tmp, 'skills'));
    fs.writeFileSync(path.join(tmp, 'skills', 'good.md'), 'good');
    fs.writeFileSync(path.join(tmp, 'skills', 'LICENSE.md'), 'license');
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(path.join(tmp, 'docs', 'guide.md'), 'guide');

    const files = findSubdirMdFiles(tmp);
    expect(files).toHaveLength(1);
    expect(files[0].relative).toBe('skills/good.md');
  });

  it('returns empty array when no subdirs exist', () => {
    fs.writeFileSync(path.join(tmp, 'skill.md'), 'skill');
    const files = findSubdirMdFiles(tmp);
    expect(files).toHaveLength(0);
  });

  it('skips doc-files within subdirs', () => {
    fs.mkdirSync(path.join(tmp, 'agents'));
    fs.writeFileSync(path.join(tmp, 'agents', 'README.md'), '');
    fs.writeFileSync(path.join(tmp, 'agents', 'actual-skill.md'), 'skill');
    const files = findSubdirMdFiles(tmp);
    expect(files).toHaveLength(1);
    expect(files[0].relative).toBe('agents/actual-skill.md');
  });

  it('skips .github and other dirs', () => {
    fs.mkdirSync(path.join(tmp, '.github'));
    fs.writeFileSync(path.join(tmp, '.github', 'workflow.md'), '');
    fs.mkdirSync(path.join(tmp, 'skills'));
    fs.writeFileSync(path.join(tmp, 'skills', 'real.md'), 'real');
    const files = findSubdirMdFiles(tmp);
    expect(files).toHaveLength(1);
  });
});
