import fs from 'fs';
import path from 'path';
import https from 'https';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { getDb } from './db.js';
import { globSync } from 'glob';
import { validateSkill, validateBundle } from './validator.js';
import { loadConfig, saveConfig, PROMPTGRAPH_DIR, SKILLS_STORE_DIR } from './config.js';
import { importFromGitHubLight, validateRepoSkills } from './github-import.js';
import { isSkillFile } from './parser.js';

const REGISTRY_URL = 'https://raw.githubusercontent.com/NeiP4n/promptgraph-registry/main/registry.json';
const SKILL_COUNT_CACHE = path.join(PROMPTGRAPH_DIR, 'skill-counts.json');
const DEAD_REPOS_FILE = path.join(PROMPTGRAPH_DIR, 'dead-repos.json');
const SKILLS_DIR = path.join(SKILLS_STORE_DIR, 'marketplace');

// Atomically write content to dest via tmp — cleans up on failure
function writeSkillAtomic(dest, content) {
  const tmpPath = dest + '.tmp';
  try {
    fs.writeFileSync(tmpPath, content);
    const v = validateSkill(tmpPath);
    if (!v.ok) { fs.unlinkSync(tmpPath); return v; }
    fs.renameSync(tmpPath, dest);
    return { ok: true };
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch {}
    return { ok: false, errors: [e.message] };
  }
}

// Convert GitHub blob URL → raw URL
// https://github.com/owner/repo/blob/branch/path/file.md
// → https://raw.githubusercontent.com/owner/repo/branch/path/file.md
function githubToRaw(url) {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}`;
  return null; // already raw or not a github URL
}

const _require = createRequire(import.meta.url);
const PKG_VERSION = (() => { try { return _require('./package.json').version; } catch { return '1.x'; } })();
const UA = `promptgraph-mcp/${PKG_VERSION}`;

const REGISTRY_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

function validateRegistryEntry(item) {
  const errors = [];
  if (!item.id || typeof item.id !== 'string') errors.push('missing required id');
  else if (!REGISTRY_ID_RE.test(item.id)) errors.push(`invalid id "${item.id}" (must match /^[a-z0-9][a-z0-9-]{1,63}$/)`);
  if (!item.name || typeof item.name !== 'string') errors.push('missing required name');
  else if (item.name.length < 3) errors.push(`name "${item.name}" too short (min 3 chars)`);
  if (!item.description || typeof item.description !== 'string') errors.push('missing required description');
  else if (item.description.length < 15) errors.push(`description too short (min 15 chars)`);
  if (item.version !== undefined && typeof item.version !== 'string') errors.push('version must be a string');
  if (item.author !== undefined && typeof item.author !== 'string') errors.push('author must be a string');
  if (item.license !== undefined && typeof item.license !== 'string') errors.push('license must be a string');
  if (item.updated_at !== undefined) {
    if (typeof item.updated_at !== 'string') errors.push('updated_at must be a string');
    else if (isNaN(Date.parse(item.updated_at))) errors.push(`updated_at "${item.updated_at}" is not a valid ISO date`);
  }
  if (item.downloads !== undefined && typeof item.downloads !== 'number') errors.push('downloads must be a number');
  if (item.verified !== undefined && typeof item.verified !== 'boolean') errors.push('verified must be a boolean');
  if (item.trustLevel !== undefined && typeof item.trustLevel !== 'string') errors.push('trustLevel must be a string');
  if (item.rating !== undefined) {
    if (typeof item.rating !== 'number') errors.push('rating must be a number');
    else if (item.rating < 0 || item.rating > 5) errors.push('rating must be between 0 and 5');
  }
  if (item.popularity !== undefined && typeof item.popularity !== 'number') errors.push('popularity must be a number');
  if (item.lastUpdate !== undefined) {
    if (typeof item.lastUpdate !== 'string') errors.push('lastUpdate must be a string');
    else if (isNaN(Date.parse(item.lastUpdate))) errors.push(`lastUpdate "${item.lastUpdate}" is not a valid ISO date`);
  }
  if (errors.length > 0) {
    console.warn(`[PromptGraph] Skipping invalid registry entry "${item.id || item.name || '(unnamed)'}": ${errors.join('; ')}`);
    return { ok: false };
  }
  return { ok: true };
}

// Deterministic short code from an id. Same id always yields the same code,
// so codes auto-generate — no need to assign them by hand.
export function codeFor(id) {
  return 'pg-' + createHash('md5').update(String(id)).digest('hex').slice(0, 6);
}

// node:https GET — reliable and fast on Windows (undici fetch can hang ~10s there).
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA }, timeout: 8000, family: 4 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(new Error('request timed out')); });
    req.on('error', reject);
  });
}

// Primary path is httpGet (fast/reliable on Windows); undici fetch only as fallback.
async function rawFetch(url) {
  try {
    return await httpGet(url);
  } catch {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }
}

// Disk cache for the registry (network to GitHub raw can be slow on some networks).
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const SKILL_COUNT_TTL = 24 * 60 * 60 * 1000; // 24 hours for skill counts

// Return GitHub API auth headers if GITHUB_TOKEN is set
function githubAuthHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { 'User-Agent': 'promptgraph-mcp' };
  return { 'User-Agent': 'promptgraph-mcp', 'Authorization': `Bearer ${token}` };
}

// Read skill count cache, returns {} on miss
function readSkillCountCache() {
  try {
    if (fs.existsSync(SKILL_COUNT_CACHE)) return JSON.parse(fs.readFileSync(SKILL_COUNT_CACHE, 'utf8'));
  } catch {}
  return {};
}

function writeSkillCountCache(data) {
  try {
    fs.mkdirSync(path.dirname(SKILL_COUNT_CACHE), { recursive: true });
    fs.writeFileSync(SKILL_COUNT_CACHE, JSON.stringify(data));
  } catch {}
}

function readDeadRepos() {
  try { return JSON.parse(fs.readFileSync(DEAD_REPOS_FILE, 'utf8')); } catch { return []; }
}

function markDeadRepo(repoUrl) {
  try {
    const dead = readDeadRepos();
    if (!dead.includes(repoUrl)) {
      dead.push(repoUrl);
      fs.mkdirSync(path.dirname(DEAD_REPOS_FILE), { recursive: true });
      fs.writeFileSync(DEAD_REPOS_FILE, JSON.stringify(dead, null, 2));
    }
  } catch {}
}

async function fetchText(url) {
  const cacheFile = path.join(PROMPTGRAPH_DIR, 'registry-cache.json');
  const isRegistry = url === REGISTRY_URL;

  if (isRegistry && fs.existsSync(cacheFile)) {
    try {
      const stat = fs.statSync(cacheFile);
      if (Date.now() - stat.mtimeMs < CACHE_TTL) {
        return fs.readFileSync(cacheFile, 'utf8');
      }
    } catch {}
  }

  const text = await rawFetch(url);

  if (isRegistry) {
    try {
      fs.mkdirSync(PROMPTGRAPH_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, text);
    } catch {}
  }
  return text;
}

export async function browseMarketplace(topK = 20) {
  try {
    const text = await fetchText(REGISTRY_URL);
    const registry = JSON.parse(text);
    if (!Array.isArray(registry.skills)) return { error: 'Invalid registry format' };
    return registry.skills
      .map(s => Object.assign(Object.create(null), s, { code: s.code || codeFor(s.id) }))
      .filter(s => validateRegistryEntry(s).ok)
      .filter(s => s.raw_url)
      .sort((a, b) => (b.stars || 0) - (a.stars || 0))
      .slice(0, topK);
  } catch (e) {
    return { error: `Registry unavailable: ${e.message}` };
  }
}

export async function installSkillFromUrl(url) {
  try {
    const rawUrl = githubToRaw(url) || url;
    const content = await fetchText(rawUrl);
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    ensureMarketplaceSource();

    // derive filename from URL
    const urlName = rawUrl.split('/').pop().replace(/[^a-z0-9-_.]/gi, '-');
    const dest = path.join(SKILLS_DIR, urlName.endsWith('.md') ? urlName : urlName + '.md');
    const resolvedDest = path.resolve(dest);
    if (!resolvedDest.startsWith(path.resolve(SKILLS_DIR))) {
      return { error: 'Path traversal blocked: destination outside marketplace directory' };
    }
    const v = writeSkillAtomic(dest, content);
    if (!v.ok) return { error: 'Downloaded skill failed validation', issues: v.errors };
    return { success: true, path: dest, url: rawUrl };
  } catch (e) {
    return { error: e.message };
  }
}

export async function installSkill(query) {
  try {
    // GitHub URL or raw URL → direct install
    if (query.startsWith('http://') || query.startsWith('https://')) {
      return installSkillFromUrl(query);
    }

    const text = await fetchText(REGISTRY_URL);
    const registry = JSON.parse(text);
    const q = String(query).trim().toLowerCase();
    const validSkills = (registry.skills || []).filter(s => validateRegistryEntry(s).ok);
    // match by code (stored OR auto-generated), id, or name
    const skill = validSkills.find(s =>
      (s.code || codeFor(s.id)).toLowerCase() === q ||
      s.id?.toLowerCase() === q ||
      s.name?.toLowerCase() === q
    );
    if (!skill) {
      const bundle = (registry.bundles || []).find(b =>
        (b.code || codeFor(b.id)).toLowerCase() === q || b.id?.toLowerCase() === q
      );
      if (bundle) return { error: `"${query}" is a bundle. Use pg_bundle_install("${bundle.id}") instead.` };
      return { error: `No skill matching "${query}" (try a code, id, name, or GitHub URL)` };
    }
    if (!skill.raw_url) return { error: `Skill "${skill.id}" has no download URL` };
    const skillId = skill.id;

    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    ensureMarketplaceSource();
    const dest = path.join(SKILLS_DIR, `${skillId}.md`);
    const resolvedDest = path.resolve(dest);
    if (!resolvedDest.startsWith(path.resolve(SKILLS_DIR))) {
      return { error: 'Path traversal blocked: destination outside marketplace directory' };
    }

    const content = await fetchText(skill.raw_url);
    const v = writeSkillAtomic(dest, content);
    if (!v.ok) return { error: 'Downloaded skill failed validation', issues: v.errors };
    return { success: true, path: dest, name: skill.name };
  } catch (e) {
    return { error: e.message };
  }
}

// ── filter skill files (exclude docs) — delegates to parser.js isSkillFile ─────
// was: local isSkillFile(path) — removed in favor of shared parser.js version

async function countRepoSkills(repoUrl) {
  try {
    const apiUrl = `https://api.github.com/repos/${repoUrl}/git/trees/HEAD?recursive=1`;
    const res = await fetch(apiUrl, { headers: githubAuthHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.tree || []).filter(f => f.type === 'blob' && isSkillFile(f.path)).length;
  } catch { return null; }
}

// Count real .md files on disk for an installed bundle (always correct)
function localSkillCount(repoUrl) {
  const repoName = repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace('/', '-');
  const dest = path.join(SKILLS_STORE_DIR, 'github', repoName);
  if (!fs.existsSync(dest)) return null;
  const files = globSync(`${dest}/**/*.md`);
  return files.length;
}

export async function browseBundles(topK = 20) {
  try {
    const text = await fetchText(REGISTRY_URL);
    const registry = JSON.parse(text);
    const deadRepos = new Set(readDeadRepos());
    const bundles = (registry.bundles || []).filter(b =>
      validateRegistryEntry(b).ok && !deadRepos.has(b.repo_url)
    );
    const cache = readSkillCountCache();
    const now = Date.now();
    let changed = false;

    await Promise.all(bundles.map(async b => {
      if (!b.repo_url) return;

      // 1. If installed locally — count real files on disk (always correct)
      const local = localSkillCount(b.repo_url);
      if (local !== null) {
        if (b.skillCount !== local) {
          b.skillCount = local;
          cache[b.repo_url] = { count: local, ts: now };
          changed = true;
        }
        return;
      }

      // 2. Not installed — use cached API count if fresh
      const cached = cache[b.repo_url];
      if (cached && (now - cached.ts) < SKILL_COUNT_TTL) {
        b.skillCount = cached.count;
        return;
      }

      // 3. Fetch from GitHub API
      const count = await countRepoSkills(b.repo_url);
      if (count !== null) {
        b.skillCount = count;
        cache[b.repo_url] = { count, ts: now };
        changed = true;
      } else {
        b.skillCount = cached?.count ?? b.skillCount ?? 0;
      }
    }));

    if (changed) writeSkillCountCache(cache);

    return bundles
      .filter(b => !b.repo_url || b.skillCount > 0)
      .map(b => Object.assign(Object.create(null), b, { code: b.code || codeFor(b.id) }))
      .sort((a, b) => (b.stars || 0) - (a.stars || 0))
      .slice(0, topK);
  } catch (e) {
    return { error: `Registry unavailable: ${e.message}` };
  }
}

// Ensure marketplace has its own source entry (separate from skills-store)
// so marketplace skills never collide with local skills of the same name.
function ensureMarketplaceSource() {
  const config = loadConfig();
  if (!config.sources.find(s => s.source === 'marketplace')) {
    config.sources.push({ dir: SKILLS_DIR, source: 'marketplace' });
    saveConfig(config);
  }
}

// ── helpers extracted from installBundle ─────────────────────────────────────

async function _findBundle(bundleId) {
  const text = await fetchText(REGISTRY_URL);
  const registry = JSON.parse(text);
  const q = String(bundleId).trim().toLowerCase();
  const validSkills = (registry.skills || []).filter(s => validateRegistryEntry(s).ok);
  const bundle = (registry.bundles || []).filter(b => validateRegistryEntry(b).ok).find(b =>
    (b.code || codeFor(b.id)).toLowerCase() === q || b.id?.toLowerCase() === q || b.name?.toLowerCase() === q
  );
  if (!bundle) return { error: `No bundle matching "${bundleId}"` };
  return { bundle, validSkills };
}

async function _execRepoInstall(bundle) {
  try {
    await importFromGitHubLight(bundle.repo_url);
  } catch (e) {
    if (e.message && e.message.includes('No valid skills')) markDeadRepo(bundle.repo_url);
    throw e;
  }
  const real = localSkillCount(bundle.repo_url);
  if (real !== null) {
    const cache = readSkillCountCache();
    cache[bundle.repo_url] = { count: real, ts: Date.now() };
    writeSkillCountCache(cache);
  }
  return { success: true, bundle: bundle.name, type: 'repo_import', repo_url: bundle.repo_url };
}

async function _execSkillsInstall(bundle, validSkills) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  ensureMarketplaceSource();
  const installed = [];
  const failed = [];
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  for (const skillId of bundle.skills || []) {
    const skill = validSkills.find(s => s.id === skillId);
    if (!skill?.raw_url) { failed.push(skillId); continue; }
    try {
      if (installed.length > 0) await delay(300);
      const content = await fetchText(skill.raw_url);
      const dest = path.join(SKILLS_DIR, `${skillId}.md`);
      const resolvedDest = path.resolve(dest);
      if (!resolvedDest.startsWith(path.resolve(SKILLS_DIR))) { failed.push(skillId); continue; }
      const v = writeSkillAtomic(dest, content);
      if (!v.ok) { failed.push(skillId); continue; }
      installed.push(skillId);
    } catch { failed.push(skillId); }
  }
  return { success: true, bundle: bundle.name, installed, failed, dir: SKILLS_DIR };
}

export async function installBundle(bundleId) {
  try {
    const found = await _findBundle(bundleId);
    if (found.error) return { error: found.error };
    const { bundle, validSkills } = found;
    return bundle.repo_url
      ? await _execRepoInstall(bundle)
      : await _execSkillsInstall(bundle, validSkills);
  } catch (e) {
    return { error: e.message };
  }
}

// ── Background install queue ──────────────────────────────────────────────────
// Allows the TUI to queue multiple installs without blocking.

const _bgQueue = [];
let _bgRunning = false;
let _bgCurrentId = null;

async function _bgProcess() {
  if (_bgRunning) return;
  _bgRunning = true;
  while (_bgQueue.length > 0) {
    const { bundle, validSkills, onDone } = _bgQueue.shift();
    _bgCurrentId = bundle.id;
    try {
      const result = bundle.repo_url
        ? await _execRepoInstall(bundle)
        : await _execSkillsInstall(bundle, validSkills);
      await onDone?.(null, result);
    } catch (e) {
      await onDone?.(e, null);
    } finally {
      _bgCurrentId = null;
    }
  }
  _bgRunning = false;
}

// Install a bundle in the background, returning immediately.
// The actual work is serialized through an internal queue.
// onDone(err, result) is called when the queue finishes processing this bundle.
export async function installBundleBg(bundleId, onDone) {
  const found = await _findBundle(bundleId);
  if (found.error) return { error: found.error };
  const { bundle, validSkills } = found;

  if (_bgCurrentId === bundle.id || _bgQueue.some(e => e.bundle.id === bundle.id)) {
    return { error: `"${bundle.name}" is already queued or installing` };
  }

  _bgQueue.push({ bundle, validSkills, onDone });
  _bgProcess();
  return { queued: true, id: bundle.id, name: bundle.name };
}

function ghPublish(filePath, desc) {
  try {
    const result = spawnSync('gh', ['gist', 'create', filePath, '--desc', desc, '--public'], { encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') return { ok: false, no_gh: true };
    if (result.status !== 0) return { ok: false, error: result.stderr?.trim() || 'gh CLI error — run: gh auth login' };
    return { ok: true, url: result.stdout.trim() };
  } catch {
    return { ok: false, no_gh: true };
  }
}

const REGISTRY_ISSUES = 'https://github.com/NeiP4n/promptgraph-registry/issues/new';

export async function publishSkill(filePath) {
  if (!fs.existsSync(filePath)) return { error: `File not found: ${filePath}` };

  const validation = validateSkill(filePath);
  if (!validation.ok) {
    return { error: 'Validation failed', issues: validation.errors, warnings: validation.warnings };
  }

  const name = path.basename(filePath, '.md');
  const gh = ghPublish(filePath, `PromptGraph skill: ${name}`);

  if (gh.no_gh) {
    const content = fs.readFileSync(filePath, 'utf8');
    return {
      success: true,
      gh_not_installed: true,
      instructions: [
        '1. Install gh CLI: https://cli.github.com',
        '   OR manually create a public Gist at https://gist.github.com with the file content',
        `2. Submit to registry: ${REGISTRY_ISSUES}`,
        `3. Paste the Gist URL in the issue`,
      ].join('\n'),
      file_content: content,
    };
  }
  if (!gh.ok) return { error: gh.error };
  return { success: true, url: gh.url, message: `Published! Submit to registry: ${REGISTRY_ISSUES}` };
}

export async function publishBundle(bundleDef) {
  // bundleDef: { id, name, description, skills: [...], tags: [...] }
  // OR a path to a .json file
  let def = bundleDef;
  if (typeof bundleDef === 'string') {
    if (!fs.existsSync(bundleDef)) return { error: `File not found: ${bundleDef}` };
    try { def = JSON.parse(fs.readFileSync(bundleDef, 'utf8')); }
    catch (e) { return { error: `Invalid JSON: ${e.message}` }; }
  }

  const validation = validateBundle(def);
  if (!validation.ok) {
    return { error: 'Bundle validation failed', issues: validation.errors, warnings: validation.warnings };
  }

  // Best-effort repo validation (client-side). GitHub Actions is the source of truth.
  let repoWarnings = [];
  if (def.repo_url) {
    try {
      const ownerRepo = def.repo_url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
      const repoValidation = await validateRepoSkills(ownerRepo);
      if (!repoValidation.ok) {
        repoWarnings = repoValidation.errors;
      }
    } catch (e) {
      repoWarnings = [`Repo validation warning: ${e.message} (will be checked by CI)`];
    }
  }

  const bundleJson = JSON.stringify(def, null, 2);
  const tmpFile = path.join(PROMPTGRAPH_DIR, `bundle-${def.id}.json`);
  fs.mkdirSync(PROMPTGRAPH_DIR, { recursive: true });
  fs.writeFileSync(tmpFile, bundleJson);

  const gh = ghPublish(tmpFile, `PromptGraph bundle: ${def.name}`);
  try { fs.unlinkSync(tmpFile); } catch {}

  if (gh.no_gh) {
    const issueUrl = `${REGISTRY_ISSUES}?title=Bundle%3A+${encodeURIComponent(def.name)}&body=${encodeURIComponent('Bundle definition:\n\n```json\n' + bundleJson + '\n```')}`;
    const actionNote = def.repo_url ? `\n\nNote: Your repo will be validated by CI (GitHub Actions) after submission.\nRun locally: node validate-repo-action.js ${def.repo_url}` : '';
    return {
      success: true,
      gh_not_installed: true,
      instructions: [
        '1. Install gh CLI: https://cli.github.com',
        `   OR open this pre-filled issue directly: ${issueUrl}`,
        '2. Paste the bundle JSON shown below into the issue body',
        ...(repoWarnings.length ? ['', '⚠ Repo warnings (CI will re-check):', ...repoWarnings.map(w => '   - ' + w)] : []),
        ...(def.repo_url ? ['', 'Your repo will be validated by CI when submitted.'] : []),
      ].join('\n'),
      bundle_json: bundleJson,
      submit_url: issueUrl,
    };
  }
  if (!gh.ok) return { error: gh.error };
  const issueUrl = `${REGISTRY_ISSUES}?title=Bundle%3A+${encodeURIComponent(def.name)}&body=Gist%3A+${encodeURIComponent(gh.url)}`;
  const msg = def.repo_url
    ? `Bundle published! Submit: ${issueUrl}\n\nRepo will be validated by CI. Run: node validate-repo-action.js ${def.repo_url}`
    : `Bundle published! Submit: ${issueUrl}`;
  return { success: true, gist_url: gh.url, submit_url: issueUrl, message: msg };
}

export function getTopRated(topK = 10) {
  const db = getDb();
  return db.prepare(`
    SELECT s.id, s.name, s.description, s.source,
           r.uses, r.success, r.fail,
           CASE WHEN (r.success + r.fail) > 0
                THEN ROUND(CAST(r.success AS FLOAT) / (r.success + r.fail), 2)
                ELSE NULL END as rating
    FROM skills s
    LEFT JOIN ratings r ON s.id = r.skill_id
    WHERE (r.success + r.fail) >= 3
    ORDER BY rating DESC, r.uses DESC
    LIMIT ?
  `).all(topK);
}

export function recordUse(skillId) {
  const db = getDb();
  db.prepare(`
    INSERT INTO ratings (skill_id, uses, success, fail)
    VALUES (?, 1, 0, 0)
    ON CONFLICT(skill_id) DO UPDATE SET uses = uses + 1
  `).run(skillId);
}

export function recordSuccess(skillId) {
  const db = getDb();
  db.prepare(`
    INSERT INTO ratings (skill_id, uses, success, fail)
    VALUES (?, 0, 1, 0)
    ON CONFLICT(skill_id) DO UPDATE SET success = success + 1
  `).run(skillId);
}

export function recordFail(skillId) {
  const db = getDb();
  db.prepare(`
    INSERT INTO ratings (skill_id, uses, success, fail)
    VALUES (?, 0, 0, 1)
    ON CONFLICT(skill_id) DO UPDATE SET fail = fail + 1
  `).run(skillId);
}

// Scan all imported repos, validate their .md files, and remove repos that fail.
// Returns { removed: string[], kept: string[], errors: string[] }.
export function pruneInvalidRepos() {
  const config = loadConfig();
  const removed = [];
  const kept = [];
  const errors = [];

  const repoSources = config.sources.filter(s => s.source?.startsWith('github:'));
  if (repoSources.length === 0) {
    return { removed, kept, errors: [], message: 'No imported repos found.' };
  }

  for (const src of repoSources) {
    const repoName = src.source.replace('github:', '');
    if (!fs.existsSync(src.dir)) {
      removed.push({ repo: repoName, reason: 'directory not found' });
      config.sources = config.sources.filter(s => s !== src);
      continue;
    }

    const mdFiles = globSync(`${src.dir}/**/*.md`).map(fp => path.resolve(fp));
    if (mdFiles.length === 0) {
      removed.push({ repo: repoName, reason: 'no .md files' });
      config.sources = config.sources.filter(s => s !== src);
      try { fs.rmSync(src.dir, { recursive: true, force: true }); } catch {}
      continue;
    }

    const invalid = [];
    for (const fp of mdFiles) {
      const v = validateSkill(fp);
      if (!v.ok) {
        invalid.push({ file: path.relative(src.dir, fp), errors: v.errors });
      }
    }

    if (invalid.length > 0) {
      removed.push({ repo: repoName, reason: `${invalid.length}/${mdFiles.length} .md files failed validation`, invalid });
      config.sources = config.sources.filter(s => s !== src);
      try { fs.rmSync(src.dir, { recursive: true, force: true }); } catch (e) { errors.push(`Failed to remove ${src.dir}: ${e.message}`); }
    } else {
      kept.push(repoName);
    }
  }

  saveConfig(config);
  return { removed, kept, errors };
}

// ── Trust level system ─────────────────────────────────────────────────────────
const VALID_TRUST_LEVELS = ['verified', 'official', 'community', 'trusted', 'unknown']
const TRUST_LEVEL_BOOST = { verified: 1.15, official: 1.10, trusted: 1.05, community: 1.0, unknown: 0.95 }

// Popularity = log(downloads+1) × (rating+1), then decayed by age (days since last_update, halved every 180 days)
function calcPopularity(downloads = 0, rating = 0, lastUpdateStr = null) {
  const logDownloads = Math.log10((downloads || 0) + 1)
  const ratingFactor = ((rating || 0) + 1) / 6  // normalised to 0–1
  let pop = logDownloads * ratingFactor * 100

  if (lastUpdateStr) {
    const daysSince = (Date.now() - new Date(lastUpdateStr + 'Z').getTime()) / 86400000
    if (daysSince > 0) {
      pop *= Math.pow(0.5, daysSince / 180)  // half-life 180 days
    }
  }
  return Math.round(pop * 100) / 100
}

// Auto-promote threshold: downloads at which a skill graduates to the next trust level
const AUTO_PROMOTE_THRESHOLDS = [
  { minDownloads: 10000, level: 'verified' },
  { minDownloads: 1000,  level: 'official' },
  { minDownloads: 100,   level: 'trusted' },
]

function autoPromote(downloads, currentLevel) {
  const rank = VALID_TRUST_LEVELS.indexOf(currentLevel || 'unknown')
  for (const t of AUTO_PROMOTE_THRESHOLDS) {
    if (downloads >= t.minDownloads && VALID_TRUST_LEVELS.indexOf(t.level) > rank) {
      return t.level
    }
  }
  return null
}

export async function setTrustLevel(name, level) {
  const db = getDb()
  if (!VALID_TRUST_LEVELS.includes(level)) {
    return { ok: false, error: `Invalid trust level "${level}". Must be one of: ${VALID_TRUST_LEVELS.join(', ')}` }
  }
  const id = String(name)
  db.prepare(`
    INSERT INTO registry_entries (id, trust_level, last_update)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET trust_level = excluded.trust_level, last_update = excluded.last_update
  `).run(id, level)
  return { ok: true }
}

export async function getByTrustLevel(level) {
  const db = getDb()
  if (level && !VALID_TRUST_LEVELS.includes(level)) {
    return { error: `Invalid trust level "${level}". Must be one of: ${VALID_TRUST_LEVELS.join(', ')}` }
  }
  if (level) {
    return db.prepare('SELECT * FROM registry_entries WHERE trust_level = ? ORDER BY downloads DESC, popularity DESC').all(level)
  }
  return db.prepare('SELECT * FROM registry_entries ORDER BY downloads DESC, popularity DESC').all()
}

export async function incrementDownloads(name) {
  const db = getDb()
  const id = String(name)
  const existing = db.prepare('SELECT downloads, rating, last_update, trust_level FROM registry_entries WHERE id = ?').get(id)
  if (existing) {
    const newDownloads = (existing.downloads || 0) + 1
    const pop = calcPopularity(newDownloads, existing.rating || 0, existing.last_update)
    db.prepare('UPDATE registry_entries SET downloads = ?, popularity = ?, last_update = datetime(\'now\') WHERE id = ?')
      .run(newDownloads, pop, id)

    // Auto-promote if threshold crossed
    const newLevel = autoPromote(newDownloads, existing.trust_level)
    if (newLevel) {
      db.prepare('UPDATE registry_entries SET trust_level = ? WHERE id = ?').run(newLevel, id)
    }
  } else {
    const pop = calcPopularity(1, 0)
    db.prepare('INSERT INTO registry_entries (id, downloads, popularity, trust_level, last_update) VALUES (?, 1, ?, \'unknown\', datetime(\'now\'))')
      .run(id, pop)
  }
  return { ok: true }
}

// ── validate & prune all installed marketplace files ──────────────────────────

export function validateAndPruneMarketplace() {
  const results = { valid: [], removed: [], errors: [] };
  if (!fs.existsSync(SKILLS_DIR)) {
    return { ...results, message: 'No marketplace directory found.' };
  }

  const mdFiles = globSync(`${SKILLS_DIR}/**/*.md`, { absolute: true });
  for (const fp of mdFiles) {
    const name = path.relative(SKILLS_DIR, fp);
    try {
      const v = validateSkill(fp);
      if (!v.ok) {
        try { fs.unlinkSync(fp); results.removed.push({ file: name, errors: v.errors }); } catch (e) { results.errors.push(`Failed to remove ${name}: ${e.message}`); }
      } else {
        results.valid.push(name);
      }
    } catch (e) {
      results.errors.push(`Error validating ${name}: ${e.message}`);
    }
  }

  // Clean up empty dirs left behind
  removeEmptyDirs(SKILLS_DIR);

  // Also remove DB entries for deleted files
  const db = getDb();
  for (const row of db.prepare('SELECT id, path FROM skills WHERE source = ?').all('marketplace')) {
    if (!fs.existsSync(row.path)) {
      db.prepare('DELETE FROM skills WHERE id = ?').run(row.id);
      db.prepare('DELETE FROM chunks WHERE skill_id = ?').run(row.id);
    }
  }

  return results;
}

function removeEmptyDirs(dirPath) {
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(dirPath, entry.name);
    removeEmptyDirs(fullPath);
    try { if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath); } catch {}
  }
}

export { VALID_TRUST_LEVELS, TRUST_LEVEL_BOOST, calcPopularity, autoPromote }

export async function rateSkill(name, rating) {
  const db = getDb()
  if (typeof rating !== 'number' || rating < 0 || rating > 5) {
    return { ok: false, error: 'Rating must be a number between 0 and 5' }
  }
  const id = String(name)
  const existing = db.prepare('SELECT rating, rating_count, downloads FROM registry_entries WHERE id = ?').get(id)
  if (existing) {
    const count = existing.rating_count || 0
    const newRating = Math.round(((existing.rating || 0) * count + rating) / (count + 1) * 100) / 100
    const newCount = count + 1
    const pop = calcPopularity(existing.downloads || 0, newRating)
    db.prepare('UPDATE registry_entries SET rating = ?, rating_count = ?, popularity = ?, last_update = datetime(\'now\') WHERE id = ?')
      .run(newRating, newCount, pop, id)
  } else {
    const pop = calcPopularity(0, rating)
    db.prepare('INSERT INTO registry_entries (id, rating, rating_count, popularity, last_update) VALUES (?, ?, 1, ?, datetime(\'now\'))')
      .run(id, rating, pop)
  }
  return { ok: true }
}
