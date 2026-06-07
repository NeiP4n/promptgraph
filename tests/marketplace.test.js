import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

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
const { pruneInvalidRepos, validateAndPruneMarketplace, setTrustLevel, getByTrustLevel, incrementDownloads, rateSkill } = await import('../marketplace.js');
const { loadConfig, saveConfig } = await import('../config.js');
const { validateSkill } = await import('../validator.js');
const { getDb } = await import('../db.js');

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

// ── validateAndPruneMarketplace ────────────────────────────────────────────────

describe('validateAndPruneMarketplace', () => {
  // validateAndPruneMarketplace uses SKILLS_DIR = SKILLS_STORE_DIR/marketplace
  const SKILLS_DIR = path.join(tmp, 'skills-store', 'marketplace');

  function writeSkill(dir, filename, valid = true) {
    const skillName = filename.replace(/\.md$/i, '');
    const body = valid ? 'x'.repeat(250) : 'no frontmatter';
    const frontmatter = valid ? `---\nname: ${skillName}\ndescription: A valid skill with proper description\n---\n` : '';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), frontmatter + body);
  }

  it('returns early if SKILLS_DIR does not exist', () => {
    const r = validateAndPruneMarketplace();
    expect(r.removed).toHaveLength(0);
    expect(r.valid).toHaveLength(0);
    expect(r.message).toMatch(/No marketplace directory/);
  });

  it('handles empty SKILLS_DIR (no .md files)', () => {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    const r = validateAndPruneMarketplace();
    expect(r.removed).toHaveLength(0);
    expect(r.valid).toHaveLength(0);
  });

  it('keeps all valid files, removes none', () => {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    writeSkill(SKILLS_DIR, 'valid-1.md', true);
    writeSkill(SKILLS_DIR, 'valid-2.md', true);

    const r = validateAndPruneMarketplace();
    expect(r.valid).toHaveLength(2);
    expect(r.removed).toHaveLength(0);
    expect(fs.existsSync(path.join(SKILLS_DIR, 'valid-1.md'))).toBe(true);
    expect(fs.existsSync(path.join(SKILLS_DIR, 'valid-2.md'))).toBe(true);
  });

  it('removes invalid files, keeps valid ones', () => {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    writeSkill(SKILLS_DIR, 'good.md', true);
    writeSkill(SKILLS_DIR, 'bad.md', false);

    const r = validateAndPruneMarketplace();
    expect(r.valid).toEqual(['good.md']);
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].file).toBe('bad.md');
    expect(fs.existsSync(path.join(SKILLS_DIR, 'good.md'))).toBe(true);
    expect(fs.existsSync(path.join(SKILLS_DIR, 'bad.md'))).toBe(false);
  });

  it('removes empty directories after pruning', () => {
    const subdir = path.join(SKILLS_DIR, 'subdir');
    writeSkill(subdir, 'bad-skill.md', false);

    // subdir contains only bad.md which will be removed
    const r = validateAndPruneMarketplace();
    expect(r.removed).toHaveLength(1);
    // subdir should be gone after cleanup
    expect(fs.existsSync(subdir)).toBe(false);
  });

  it('cleans up DB entries for deleted files', () => {
    const mockDb = {
      prepare: vi.fn((sql) => {
        if (sql.includes('SELECT id, path FROM skills')) {
          return {
            all: vi.fn(() => [
              { id: 'stale-entry', path: path.join(SKILLS_DIR, 'ghost.md') },
            ]),
          };
        }
        return { run: vi.fn(), all: vi.fn(() => []), get: vi.fn() };
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb);

    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    writeSkill(SKILLS_DIR, 'valid.md', true);

    validateAndPruneMarketplace();

    // Should try to delete the stale entry from both skills and chunks tables
    expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM skills WHERE id = ?');
    expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM chunks WHERE skill_id = ?');
  });

  it('handles nested directory structure', () => {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    writeSkill(path.join(SKILLS_DIR, 'a', 'b'), 'valid.md', true);
    writeSkill(path.join(SKILLS_DIR, 'a'), 'also-valid.md', true);

    const r = validateAndPruneMarketplace();
    expect(r.valid).toHaveLength(2);
    // all dirs should still exist
    expect(fs.existsSync(path.join(SKILLS_DIR, 'a', 'b'))).toBe(true);
  });

  it('handles empty skill files gracefully', () => {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SKILLS_DIR, 'empty.md'), '');

    const r = validateAndPruneMarketplace();
    // empty file fails validation (too short), should be removed
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].file).toBe('empty.md');
    expect(fs.existsSync(path.join(SKILLS_DIR, 'empty.md'))).toBe(false);
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

// ── Trust levels ───────────────────────────────────────────────────────────────

function createRegistryDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS registry_entries (
    id TEXT PRIMARY KEY,
    trust_level TEXT DEFAULT 'unknown',
    downloads INTEGER DEFAULT 0,
    rating REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    popularity REAL DEFAULT 0,
    last_update TEXT
  )`);
  return db;
}

describe('setTrustLevel / getByTrustLevel', () => {
  let realDb;

  beforeEach(() => {
    realDb = createRegistryDb();
    vi.mocked(getDb).mockReturnValue(realDb);
  });

  afterEach(() => {
    realDb.close();
  });

  it('sets trust level for a skill', async () => {
    const r = await setTrustLevel('react-skill', 'verified');
    expect(r).toEqual({ ok: true });

    const entries = await getByTrustLevel('verified');
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('react-skill');
    expect(entries[0].trust_level).toBe('verified');
  });

  it('rejects invalid trust level', async () => {
    const r = await setTrustLevel('react-skill', 'super-verified');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid trust level/);
  });

  it('default trust level is unknown', async () => {
    // incrementDownloads creates an entry with defaults
    await incrementDownloads('unknown-skill');
    const entries = await getByTrustLevel('unknown');
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('unknown-skill');
    expect(entries[0].trust_level).toBe('unknown');
  });

  it('returns all entries when no level filter', async () => {
    await setTrustLevel('skill-a', 'verified');
    await setTrustLevel('skill-b', 'community');
    await setTrustLevel('skill-c', 'verified');

    const all = await getByTrustLevel();
    expect(all).toHaveLength(3);
  });

  it('updates existing trust level', async () => {
    await setTrustLevel('skill-x', 'community');
    await setTrustLevel('skill-x', 'official');

    const entries = await getByTrustLevel('official');
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('skill-x');

    const communityEntries = await getByTrustLevel('community');
    expect(communityEntries).toHaveLength(0);
  });

  it('filters correctly by trust level', async () => {
    await setTrustLevel('skill-a', 'verified');
    await setTrustLevel('skill-b', 'official');
    await setTrustLevel('skill-c', 'community');
    await setTrustLevel('skill-d', 'trusted');

    const verified = await getByTrustLevel('verified');
    expect(verified).toHaveLength(1);
    expect(verified[0].id).toBe('skill-a');

    const official = await getByTrustLevel('official');
    expect(official).toHaveLength(1);
    expect(official[0].id).toBe('skill-b');

    const community = await getByTrustLevel('community');
    expect(community).toHaveLength(1);
    expect(community[0].id).toBe('skill-c');

    const trusted = await getByTrustLevel('trusted');
    expect(trusted).toHaveLength(1);
    expect(trusted[0].id).toBe('skill-d');
  });

  it('fetches all available trust levels', async () => {
    await setTrustLevel('skill-a', 'verified');
    await setTrustLevel('skill-b', 'official');

    const all = await getByTrustLevel();
    expect(all).toHaveLength(2);
    expect(all.map(e => e.id)).toContain('skill-a');
    expect(all.map(e => e.id)).toContain('skill-b');
  });
});

// ── Downloads ──────────────────────────────────────────────────────────────────

describe('incrementDownloads', () => {
  let realDb;

  beforeEach(() => {
    realDb = createRegistryDb();
    vi.mocked(getDb).mockReturnValue(realDb);
  });

  afterEach(() => {
    realDb.close();
  });

  it('starts downloads at 1 for new skill', async () => {
    await incrementDownloads('skill-one');
    const entry = realDb.prepare('SELECT * FROM registry_entries WHERE id = ?').get('skill-one');
    expect(entry.downloads).toBe(1);
  });

  it('increments downloads for existing skill', async () => {
    await incrementDownloads('skill-one');
    await incrementDownloads('skill-one');
    await incrementDownloads('skill-one');

    const entry = realDb.prepare('SELECT * FROM registry_entries WHERE id = ?').get('skill-one');
    expect(entry.downloads).toBe(3);
  });

  it('tracks separate skills independently', async () => {
    await incrementDownloads('skill-a');
    await incrementDownloads('skill-a');
    await incrementDownloads('skill-b');

    const a = realDb.prepare('SELECT downloads FROM registry_entries WHERE id = ?').get('skill-a');
    const b = realDb.prepare('SELECT downloads FROM registry_entries WHERE id = ?').get('skill-b');
    expect(a.downloads).toBe(2);
    expect(b.downloads).toBe(1);
  });

  it('updates popularity on increment', async () => {
    await rateSkill('pop-skill', 4);
    await incrementDownloads('pop-skill');
    const entry = realDb.prepare('SELECT downloads, popularity FROM registry_entries WHERE id = ?').get('pop-skill');
    expect(entry.downloads).toBe(1);
    expect(entry.popularity).toBeGreaterThan(0);
  });
});

// ── Rating ─────────────────────────────────────────────────────────────────────

describe('rateSkill', () => {
  let realDb;

  beforeEach(() => {
    realDb = createRegistryDb();
    vi.mocked(getDb).mockReturnValue(realDb);
  });

  afterEach(() => {
    realDb.close();
  });

  it('accepts first rating', async () => {
    const r = await rateSkill('my-skill', 4.5);
    expect(r).toEqual({ ok: true });

    const entry = realDb.prepare('SELECT * FROM registry_entries WHERE id = ?').get('my-skill');
    expect(entry.rating).toBe(4.5);
    expect(entry.rating_count).toBe(1);
  });

  it('computes weighted average for multiple ratings', async () => {
    await rateSkill('skill-r', 4);
    await rateSkill('skill-r', 5);
    await rateSkill('skill-r', 3);

    const entry = realDb.prepare('SELECT rating, rating_count FROM registry_entries WHERE id = ?').get('skill-r');
    // (4*1 + 5*1 + 3*1) / 3 = 12/3 = 4
    expect(entry.rating).toBe(4);
    expect(entry.rating_count).toBe(3);
  });

  it('rejects rating out of range', async () => {
    const rLow = await rateSkill('skill', -1);
    expect(rLow.ok).toBe(false);
    expect(rLow.error).toMatch(/between 0 and 5/);

    const rHigh = await rateSkill('skill', 6);
    expect(rHigh.ok).toBe(false);
    expect(rHigh.error).toMatch(/between 0 and 5/);
  });

  it('rejects non-numeric rating', async () => {
    const r = await rateSkill('skill', 'good');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/between 0 and 5/);
  });

  it('preserves existing trust level when rating', async () => {
    await setTrustLevel('trusted-skill', 'official');
    await rateSkill('trusted-skill', 5);

    const entry = realDb.prepare('SELECT trust_level, rating FROM registry_entries WHERE id = ?').get('trusted-skill');
    expect(entry.trust_level).toBe('official');
    expect(entry.rating).toBe(5);
  });

  it('handles ratings at boundary values', async () => {
    await rateSkill('min-skill', 0);
    await rateSkill('max-skill', 5);

    const min = realDb.prepare('SELECT rating FROM registry_entries WHERE id = ?').get('min-skill');
    const max = realDb.prepare('SELECT rating FROM registry_entries WHERE id = ?').get('max-skill');
    expect(min.rating).toBe(0);
    expect(max.rating).toBe(5);
  });
});
