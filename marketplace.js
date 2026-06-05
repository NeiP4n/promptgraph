import fs from 'fs';
import path from 'path';
import https from 'https';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { getDb } from './db.js';
import { validateSkill, validateBundle } from './validator.js';
import { loadConfig, saveConfig, PROMPTGRAPH_DIR, SKILLS_STORE_DIR } from './config.js';
import { importFromGitHub } from './github-import.js';

const REGISTRY_URL = 'https://raw.githubusercontent.com/NeiP4n/promptgraph-registry/main/registry.json';
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
      .map(s => ({ ...s, code: s.code || codeFor(s.id) })) // auto-fill code
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
    // match by code (stored OR auto-generated), id, or name
    const skill = registry.skills?.find(s =>
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

    const content = await fetchText(skill.raw_url);
    const v = writeSkillAtomic(dest, content);
    if (!v.ok) return { error: 'Downloaded skill failed validation', issues: v.errors };
    return { success: true, path: dest, name: skill.name };
  } catch (e) {
    return { error: e.message };
  }
}

async function countRepoSkills(repoUrl) {
  try {
    const apiUrl = `https://api.github.com/repos/${repoUrl}/git/trees/HEAD?recursive=1`;
    const res = await fetch(apiUrl, { headers: { 'User-Agent': 'promptgraph-mcp' } });
    if (!res.ok) return null;
    const data = await res.json();
    const exts = ['.md', '.txt', '.yaml', '.yml', '.json'];
    return (data.tree || []).filter(f => f.type === 'blob' && exts.some(e => f.path.toLowerCase().endsWith(e))).length;
  } catch { return null; }
}

export async function browseBundles(topK = 20) {
  try {
    const text = await fetchText(REGISTRY_URL);
    const registry = JSON.parse(text);
    const bundles = registry.bundles || [];
    await Promise.all(bundles.map(async b => {
      if (b.repo_url && b.skillCount === undefined) {
        const count = await countRepoSkills(b.repo_url);
        if (count !== null) b.skillCount = count;
      }
    }));
    return bundles
      .map(b => ({ ...b, code: b.code || codeFor(b.id) }))
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

export async function installBundle(bundleId) {
  try {
    const text = await fetchText(REGISTRY_URL);
    const registry = JSON.parse(text);
    const q = String(bundleId).trim().toLowerCase();
    const bundle = (registry.bundles || []).find(b =>
      (b.code || codeFor(b.id)).toLowerCase() === q || b.id?.toLowerCase() === q || b.name?.toLowerCase() === q
    );
    if (!bundle) return { error: `No bundle matching "${bundleId}"` };

    if (bundle.repo_url) {
      await importFromGitHub(bundle.repo_url);
      return { success: true, bundle: bundle.name, type: 'repo_import', repo_url: bundle.repo_url };
    }

    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    ensureMarketplaceSource();
    const installed = [];
    const failed = [];

    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    for (const skillId of bundle.skills || []) {
      const skill = registry.skills?.find(s => s.id === skillId);
      if (!skill?.raw_url) { failed.push(skillId); continue; }
      try {
        if (installed.length > 0) await delay(300); // rate limit: 300ms between requests
        const content = await fetchText(skill.raw_url);
        const dest = path.join(SKILLS_DIR, `${skillId}.md`);
        const v = writeSkillAtomic(dest, content);
        if (!v.ok) { failed.push(skillId); continue; }
        installed.push(skillId);
      } catch {
        failed.push(skillId);
      }
    }

    return { success: true, bundle: bundle.name, installed, failed, dir: SKILLS_DIR };
  } catch (e) {
    return { error: e.message };
  }
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

  const bundleJson = JSON.stringify(def, null, 2);
  const tmpFile = path.join(PROMPTGRAPH_DIR, `bundle-${def.id}.json`);
  fs.mkdirSync(PROMPTGRAPH_DIR, { recursive: true });
  fs.writeFileSync(tmpFile, bundleJson);

  const gh = ghPublish(tmpFile, `PromptGraph bundle: ${def.name}`);
  try { fs.unlinkSync(tmpFile); } catch {}

  if (gh.no_gh) {
    const issueUrl = `${REGISTRY_ISSUES}?title=Bundle%3A+${encodeURIComponent(def.name)}&body=${encodeURIComponent('Bundle definition:\n\n```json\n' + bundleJson + '\n```')}`;
    return {
      success: true,
      gh_not_installed: true,
      instructions: [
        '1. Install gh CLI: https://cli.github.com',
        `   OR open this pre-filled issue directly: ${issueUrl}`,
        '2. Paste the bundle JSON shown below into the issue body',
      ].join('\n'),
      bundle_json: bundleJson,
      submit_url: issueUrl,
    };
  }
  if (!gh.ok) return { error: gh.error };
  const issueUrl = `${REGISTRY_ISSUES}?title=Bundle%3A+${encodeURIComponent(def.name)}&body=Gist%3A+${encodeURIComponent(gh.url)}`;
  return { success: true, gist_url: gh.url, submit_url: issueUrl, message: `Bundle published! Submit: ${issueUrl}` };
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
