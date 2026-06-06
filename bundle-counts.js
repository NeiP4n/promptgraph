/**
 * Local cache for bundle skillCounts.
 * Refreshes from GitHub API in background; TTL = 24h.
 * Counts only .md files in subdirectories (never root files).
 */
import fs from 'fs';
import https from 'https';
import path from 'path';
import { PROMPTGRAPH_DIR } from './config.js';

const CACHE_FILE = path.join(PROMPTGRAPH_DIR, 'bundle-counts.json');
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

const SKILL_DIRS = ['skills', 'commands', 'prompts', 'agents', 'skills-store', 'slash-commands', 'custom-commands', 'templates'];
const SKIP_ROOT_DIRS = new Set(['.github', 'docs', 'doc', 'assets', 'images', 'img', 'media', 'static', 'scripts', 'ci_scripts', 'node_modules', 'vendor', 'dist', 'build', 'tests', 'test', 'examples', 'example', 'fixtures']);
const SKIP_NAMES = /^(readme|changelog|license|contributing|security|authors|credits|install|installation|usage|promotion|faq|glossary|index|overview|summary|roadmap|todo|notes|template|example|sample|demo|guide|tutorial|walkthrough|architecture|design|spec|requirements|privacy|terms|disclaimer|notice|copying|warranty|funding)/i;

function httpsGet(url) {
  const token = process.env.GITHUB_TOKEN;
  const headers = { 'User-Agent': 'promptgraph-mcp' };
  if (token && url.startsWith('https://api.github.com/')) headers['Authorization'] = `Bearer ${token}`;
  return new Promise((res, rej) => {
    const req = https.get(url, { headers }, r => {
      if (r.statusCode === 403 || r.statusCode === 429) return rej(new Error(`Rate limited`));
      if (r.statusCode !== 200) { r.resume(); return rej(new Error(`HTTP ${r.statusCode}`)); }
      let d = ''; r.setEncoding('utf8'); r.on('data', c => d += c); r.on('end', () => res(d));
    });
    req.on('error', rej);
  });
}

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}

function saveCache(data) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

// Count .md files only in subdirectories — root files are ignored
async function countSubdirMdFiles(ownerRepo) {
  const treeUrl = `https://api.github.com/repos/${ownerRepo}/git/trees/HEAD?recursive=1`;
  const json = await httpsGet(treeUrl);
  const { tree = [] } = JSON.parse(json);

  // Only .md files that are inside a subdir (path has at least one /)
  const mdFiles = tree.filter(f =>
    f.type === 'blob' &&
    f.path.endsWith('.md') &&
    f.path.includes('/') // must be in a subdir, not root
  );

  // Try to find a known skills subdir first
  for (const dir of SKILL_DIRS) {
    const inDir = mdFiles.filter(f => f.path.startsWith(dir + '/'));
    if (inDir.length > 0) {
      return inDir.filter(f => {
        const base = f.path.split('/').pop().replace(/\.md$/i, '').toLowerCase();
        return !SKIP_NAMES.test(base);
      }).length;
    }
  }

  // No known dir — use any subdir, skip skip-dirs
  return mdFiles.filter(f => {
    const parts = f.path.split('/');
    const topDir = parts[0].toLowerCase();
    if (SKIP_ROOT_DIRS.has(topDir)) return false;
    const base = parts[parts.length - 1].replace(/\.md$/i, '').toLowerCase();
    return !SKIP_NAMES.test(base);
  }).length;
}

// Read cached count for a bundle (returns null if stale or missing)
export function getCachedCount(repoUrl) {
  const cache = loadCache();
  const entry = cache[repoUrl];
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) return null;
  return entry.count;
}

// Refresh counts for all bundles in background (non-blocking)
export function refreshCountsInBackground(bundles) {
  const cache = loadCache();
  const stale = bundles.filter(b => {
    if (!b.repo_url) return false;
    const entry = cache[b.repo_url];
    return !entry || Date.now() - entry.ts > TTL_MS;
  });

  if (!stale.length) return;

  // Fire-and-forget
  (async () => {
    for (const b of stale) {
      try {
        const count = await countSubdirMdFiles(b.repo_url);
        cache[b.repo_url] = { count, ts: Date.now() };
        saveCache(cache);
      } catch {
        // rate limited or network error — skip, try next time
      }
      await new Promise(r => setTimeout(r, 500)); // 500ms between requests
    }
  })();
}
