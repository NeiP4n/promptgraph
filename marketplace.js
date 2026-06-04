import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { getDb } from './db.js';
import { validateSkill } from './validator.js';

const REGISTRY_URL = 'https://raw.githubusercontent.com/NeiP4n/promptgraph-registry/main/registry.json';
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills-store', 'marketplace');

// Deterministic short code from an id. Same id always yields the same code,
// so codes auto-generate — no need to assign them by hand.
export function codeFor(id) {
  return 'pg-' + createHash('md5').update(String(id)).digest('hex').slice(0, 6);
}

// node:https GET — reliable and fast on Windows (undici fetch can hang ~10s there).
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'promptgraph-mcp' }, timeout: 8000, family: 4 }, (res) => {
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
    const res = await fetch(url, { headers: { 'User-Agent': 'promptgraph-mcp' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }
}

// Disk cache for the registry (network to GitHub raw can be slow on some networks).
const CACHE_DIR = path.join(os.homedir(), '.claude', '.promptgraph');
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchText(url) {
  const cacheFile = path.join(CACHE_DIR, 'registry-cache.json');
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
      fs.mkdirSync(CACHE_DIR, { recursive: true });
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

export async function installSkill(query) {
  try {
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
      return { error: `No skill matching "${query}" (try a code like pg-xxxxxx, an id, or a name)` };
    }
    if (!skill.raw_url) return { error: `Skill "${skill.id}" has no download URL` };
    const skillId = skill.id;

    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    const dest = path.join(SKILLS_DIR, `${skillId}.md`);

    const content = await fetchText(skill.raw_url);
    fs.writeFileSync(dest, content);

    return { success: true, path: dest, name: skill.name };
  } catch (e) {
    return { error: e.message };
  }
}

export async function browseBundles(topK = 20) {
  try {
    const text = await fetchText(REGISTRY_URL);
    const registry = JSON.parse(text);
    const bundles = registry.bundles || [];
    return bundles
      .map(b => ({ ...b, code: b.code || codeFor(b.id) }))
      .sort((a, b) => (b.stars || 0) - (a.stars || 0))
      .slice(0, topK);
  } catch (e) {
    return { error: `Registry unavailable: ${e.message}` };
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

    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    const installed = [];
    const failed = [];

    for (const skillId of bundle.skills || []) {
      const skill = registry.skills?.find(s => s.id === skillId);
      if (!skill?.raw_url) { failed.push(skillId); continue; }
      try {
        const content = await fetchText(skill.raw_url);
        fs.writeFileSync(path.join(SKILLS_DIR, `${skillId}.md`), content);
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

export async function publishSkill(filePath) {
  if (!fs.existsSync(filePath)) return { error: `File not found: ${filePath}` };

  // validate before publishing — block junk and malicious skills
  const validation = validateSkill(filePath);
  if (!validation.ok) {
    return { error: 'Validation failed', issues: validation.errors, warnings: validation.warnings };
  }

  const name = path.basename(filePath, '.md');

  try {
    const result = spawnSync(
      'gh',
      ['gist', 'create', filePath, '--desc', `PromptGraph skill: ${name}`, '--public'],
      { encoding: 'utf8' }
    );
    if (result.status !== 0) {
      return { error: result.stderr?.trim() || 'gh CLI error. Run: gh auth login' };
    }
    return {
      success: true,
      url: result.stdout.trim(),
      message: `Published! Submit to registry: https://github.com/NeiP4n/promptgraph-registry/issues/new`,
    };
  } catch {
    return { error: 'gh CLI not found. Install from: https://cli.github.com' };
  }
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
