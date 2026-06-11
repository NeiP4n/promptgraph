import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { globSync } from 'glob';
import { indexAll, indexSource } from './indexer.js';
import { loadConfig, saveConfig, PROMPTGRAPH_DIR, getSkillsStoreDir, MAX_DOWNLOAD_SIZE, MAX_FILE_COUNT, MAX_REPO_SIZE, RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS } from './config.js';
import { validateSkill } from './validator.js';
import { isSkillFile, filterWithClassifier, parseSkillFile } from './parser.js';
import { RateLimiter } from './src/utils/rate-limiter.js';

const githubRateLimiter = new RateLimiter({ maxRequests: RATE_LIMIT_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS })
const downloadRateLimiter = new RateLimiter({ maxRequests: RATE_LIMIT_REQUESTS * 2, windowMs: RATE_LIMIT_WINDOW_MS })

const SKILL_DIRS = ['skills', 'commands', 'prompts', 'agents', 'skills-store', 'slash-commands', 'custom-commands', 'templates'];

// glob v13 brace-expansion ({py,sh,...}) returns nothing on Windows — use an
// array of explicit patterns instead so script detection works cross-platform.
export const SCRIPT_GLOBS = ['**/*.py', '**/*.sh', '**/*.bash', '**/*.js', '**/*.ts', '**/*.rb'];

// GitHub Copilot/agent convention places skills under .github/{skills,prompts,agents,commands}
// (e.g. microsoft/skills). Recognized as skill locations despite .github being a skip dir.
const COPILOT_SKILL_DIRS = new Set(['skills', 'prompts', 'agents', 'commands']);

// ── helpers ───────────────────────────────────────────────────────────────────

const repoStats = new Map()

function getRepoStats(ownerRepo) {
  if (!repoStats.has(ownerRepo)) {
    repoStats.set(ownerRepo, { totalBytes: 0, fileCount: 0 })
  }
  return repoStats.get(ownerRepo)
}

function streamDownload(url, maxSize = MAX_DOWNLOAD_SIZE, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many redirects'))
  return new Promise((res, rej) => {
    const token = process.env.GITHUB_TOKEN;
    const headers = { 'User-Agent': 'promptgraph-mcp' };
    if (token && url.startsWith('https://raw.')) headers['Authorization'] = `Bearer ${token}`;
    const req = https.get(url, { headers }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return streamDownload(r.headers.location, maxSize, redirects + 1).then(res, rej);
      if (r.statusCode !== 200) { r.resume(); return rej(new Error(`HTTP ${r.statusCode}`)); }
      const cl = parseInt(r.headers['content-length'], 10);
      if (!isNaN(cl) && cl > maxSize) {
        r.resume();
        return rej(new Error(`Content-Length ${cl} exceeds max ${maxSize}`));
      }
      const chunks = []
      let total = 0
      r.setEncoding('utf8')
      r.on('data', c => {
        total += Buffer.byteLength(c, 'utf8')
        if (total > maxSize) {
          r.destroy()
          return rej(new Error(`Download exceeded ${maxSize} bytes`))
        }
        chunks.push(c)
      })
      r.on('end', () => res(chunks.join('')))
    })
    req.setTimeout(30000, () => req.destroy(new Error('streamDownload timeout')))
    req.on('error', rej)
  })
}

function getGhToken() {
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) return envToken;
  try {
    const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch {}
  return null;
}

async function httpsGet(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many redirects'))
  await githubRateLimiter.acquire()
  const token = getGhToken();
  const headers = { 'User-Agent': 'promptgraph-mcp' };
  if (token && url.startsWith('https://api.github.com/')) headers['Authorization'] = `Bearer ${token}`;
  return new Promise((res, rej) => {
    const req = https.get(url, { headers }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return httpsGet(r.headers.location, redirects + 1).then(res, rej);
      if (r.statusCode !== 200) { r.resume(); return rej(new Error(`HTTP ${r.statusCode}`)); }
      const chunks = []; r.setEncoding('utf8'); r.on('data', c => chunks.push(c)); r.on('end', () => res(chunks.join('')));
    });
    req.setTimeout(30000, () => req.destroy(new Error('httpsGet timeout')));
    req.on('error', rej);
  });
}

function repoExists(ownerRepo) {
  return new Promise(resolve => {
    const req = https.request(
      { host: 'github.com', path: `/${ownerRepo}`, method: 'HEAD', headers: { 'User-Agent': 'promptgraph-mcp' } },
      r => resolve(r.statusCode < 400)
    );
    req.on('error', () => resolve(false));
    req.end();
  });
}

// Download one .md file, run validateSkill on it, return errors/warnings.
async function validateMdFile(file, tmpDir, ownerRepo) {
  const errors = [];
  const warnings = [];
  const stats = getRepoStats(ownerRepo);
  try {
    if (stats.fileCount >= MAX_FILE_COUNT) {
      errors.push(`${file.name}: skipped — repo file count limit (${MAX_FILE_COUNT}) reached`);
      return { errors, warnings };
    }
    await downloadRateLimiter.acquire()
    const content = await streamDownload(file.download_url);
    stats.totalBytes += Buffer.byteLength(content, 'utf8');
    stats.fileCount++;
    if (stats.totalBytes > MAX_REPO_SIZE) {
      return { errors: [...errors, `${file.name}: repo size limit (${MAX_REPO_SIZE}) exceeded`], warnings };
    }
    const tmpPath = path.join(tmpDir, file.name);
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, content);
    const result = validateSkill(tmpPath);
    if (!result.ok) {
      errors.push(`${file.name}: ${result.errors.join('; ')}`);
    }
    if (result.warnings?.length) {
      warnings.push(...result.warnings.map(w => `${file.name}: ${w}`));
    }
    fs.unlinkSync(tmpPath);
  } catch (e) {
    errors.push(`${file.name}: failed to validate — ${e.message}`);
  }
  return { errors, warnings };
}

// Validate all .md files in a repo's skills subdir against validateSkill().
// Falls back to root-level .md files if no skills subdirectory is found.
// Returns { ok, errors[], warnings[] }.
export async function validateRepoSkills(ownerRepo) {
  const detected = await detectSkillsDirFromAPI(ownerRepo);
  const tmpDir = path.join(PROMPTGRAPH_DIR, '.validate-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  let mdFiles;
  if (detected) {
    // Has a skills subdirectory — use git tree API for recursive listing
    const subdir = detected.subdir;
    try {
      const treeJson = await httpsGet(`https://api.github.com/repos/${ownerRepo}/git/trees/HEAD?recursive=1`);
      const tree = JSON.parse(treeJson);
      const prefix = subdir + '/';
      const mdTreeEntries = (tree.tree || []).filter(f =>
        f.type === 'blob' && f.path.startsWith(prefix) && f.path.endsWith('.md')
      );
      let branch = 'main';
      try {
        const repoJson = await httpsGet(`https://api.github.com/repos/${ownerRepo}`);
        branch = JSON.parse(repoJson).default_branch || 'main';
      } catch {}
      mdFiles = mdTreeEntries.map(f => ({
        name: f.path.replace(prefix, ''),
        download_url: `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${f.path}`
      }));
    } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return { ok: false, errors: [`Failed to list ${subdir}/ contents: ${e.message}`], warnings: [] };
    }
  } else {
    // No skills subdir — fall back to root-level .md files
    try {
      const json = await httpsGet(`https://api.github.com/repos/${ownerRepo}/contents`);
      const entries = JSON.parse(json);
      mdFiles = entries.filter(e => e.type === 'file' && e.name.endsWith('.md'));
    } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return { ok: false, errors: [`Failed to list repo root: ${e.message}`], warnings: [] };
    }
  }

  if (!mdFiles || mdFiles.length === 0) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return { ok: false, errors: [`No .md files found in ${ownerRepo}`], warnings: [] };
  }

  // Filter out docs-like filenames (README, LICENSE, CHANGELOG, etc.)
  const SKIP_DOCS = /^(readme|license|changelog|contributing|code.?of.?conduct|security|authors|credits|install|faq|index|overview|summary|todo|notes|template|copying|warranty|funding|roadmap|claude|bugs?\b|feature.?request)/i;
  const mdTrimmed = mdFiles.filter(f => !SKIP_DOCS.test(f.name.replace(/\.md$/i, '')));
  const mdToValidate = mdTrimmed.length > 0 ? mdTrimmed : mdFiles;

  let errors = [];
  let warnings = [];

  for (const file of mdToValidate) {
    const r = await validateMdFile(file, tmpDir, ownerRepo);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  return { ok: errors.length === 0, errors, warnings };
}

const SCRIPT_EXTS_API = new Set(['.py', '.sh', '.bash', '.js', '.ts', '.rb']);

// Ask GitHub API which subdir to use (without cloning anything). Exported for validation.
// Returns { subdir, label, validMdCount, hasScripts } or null (repo not found / no skills).
//
// Uses the recursive git-tree API (1 call) and counts .md files RECURSIVELY under each
// candidate dir. This handles nested layouts like skills/cloud/*.md or skills/<name>/SKILL.md
// where a skill dir holds category subfolders rather than .md files directly — the old
// shallow per-dir listing reported "0 skills" for those and blocked publishing.
export
async function detectSkillsDirFromAPI(ownerRepo) {
  let tree;
  try {
    tree = JSON.parse(await httpsGet(`https://api.github.com/repos/${ownerRepo}/git/trees/HEAD?recursive=1`));
  } catch {
    return null; // repo not found or inaccessible
  }
  if (!tree || !Array.isArray(tree.tree)) return null;
  const paths = tree.tree.filter(f => f.type === 'blob').map(f => f.path);
  return selectSkillSubdir(paths);
}

// Pure subdir-selection logic over a flat list of repo file paths (no network).
// Returns { subdir, label, validMdCount, hasScripts } or null. Exported for tests.
export function selectSkillSubdir(allPaths) {
  if (!Array.isArray(allPaths) || allPaths.length === 0) return null;

  // A path is a valid skill .md if the filename isn't meta (readme/license/…) and no
  // path segment is a skip dir (docs/tests/assets/…). Exception: .github/{skills,
  // prompts,agents,commands} is the GitHub Copilot/agent skill convention.
  const isValidMd = (p) => {
    if (!p.endsWith('.md')) return false;
    if (SKIP_RE.test(path.basename(p, '.md').toLowerCase())) return false;
    const segs = p.split('/');
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i].toLowerCase();
      if (SKIP_DIRS_API.has(seg)) {
        if (seg === '.github' && COPILOT_SKILL_DIRS.has((segs[i + 1] || '').toLowerCase())) continue;
        return false;
      }
    }
    return true;
  };
  const mdPaths = allPaths.filter(isValidMd);
  if (mdPaths.length === 0) return null;

  const countUnder  = (prefix) => mdPaths.filter(p => p.startsWith(prefix)).length;
  const scriptUnder = (prefix) => allPaths.some(p => p.startsWith(prefix) && SCRIPT_EXTS_API.has(path.extname(p).toLowerCase()));

  // Map of top-level dir names (lowercase -> real casing)
  const topDirs = new Map();
  for (const p of allPaths) {
    const idx = p.indexOf('/');
    if (idx > 0) { const d = p.slice(0, idx); topDirs.set(d.toLowerCase(), d); }
  }

  // 1. Known skill dir names (priority order) — counted recursively
  for (const d of SKILL_DIRS) {
    if (topDirs.has(d)) {
      const real = topDirs.get(d);
      const c = countUnder(`${real}/`);
      if (c > 0) return { subdir: real, label: real, validMdCount: c, hasScripts: scriptUnder(`${real}/`) };
    }
  }

  // 1.5 Nested skill dirs (.claude/skills, .claude-plugin/commands, .github/skills, …)
  for (const prefix of ['.claude', '.claude-plugin', '.github']) {
    if (topDirs.has(prefix)) {
      const real = topDirs.get(prefix);
      for (const d of SKILL_DIRS) {
        const nested = `${real}/${d}`;
        const c = countUnder(`${nested}/`);
        if (c > 0) return { subdir: nested, label: nested, validMdCount: c, hasScripts: scriptUnder(`${nested}/`) };
      }
    }
  }

  // 2. Root-level .md files (skills kept directly at repo root)
  const rootMd = mdPaths.filter(p => !p.includes('/')).length;

  // 3. Best non-skip top-level subdir by recursive .md count
  let best = null, bestCount = 0;
  for (const [low, real] of topDirs) {
    if (SKIP_DIRS_API.has(low)) continue;
    const c = countUnder(`${real}/`);
    if (c > bestCount) { bestCount = c; best = real; }
  }

  // Prefer root when it holds the skills (and is at least as rich as any subdir)
  if (rootMd >= 1 && rootMd >= bestCount) {
    return { subdir: null, label: 'root', validMdCount: rootMd, hasScripts: scriptUnder('') };
  }
  if (best) return { subdir: best, label: best, validMdCount: bestCount, hasScripts: scriptUnder(`${best}/`) };

  return null;
}

// Deep-validate a repo bundle via 1 API call (tree) + raw file fetches (not rate-limited).
// Returns { passed, total, hasScripts } — passed = skills that survive validateSkill().
export async function deepValidateRepo(ownerRepo, subdir, onProgress) {
  const treeJson = await httpsGet(`https://api.github.com/repos/${ownerRepo}/git/trees/HEAD?recursive=1`);
  const tree = JSON.parse(treeJson);

  const prefix = subdir ? `${subdir}/` : '';
  const allBlobs = (tree.tree || []).filter(f => f.type === 'blob');

  const mdFiles = allBlobs.filter(f =>
    f.path.startsWith(prefix) &&
    f.path.endsWith('.md') &&
    !SKIP_RE.test(path.basename(f.path, '.md').toLowerCase())
  );

  const hasScripts = allBlobs.some(f =>
    f.path.startsWith(prefix) && SCRIPT_EXTS.has(path.extname(f.path).toLowerCase())
  );

  const tmpDir = fs.mkdtempSync(path.join(PROMPTGRAPH_DIR, 'pg-val-'));
  let passed = 0;
  const total = mdFiles.length;

  try {
    for (let i = 0; i < mdFiles.length; i++) {
      const f = mdFiles[i];
      if (onProgress) onProgress(i + 1, total);
      try {
        const rawUrl = `https://raw.githubusercontent.com/${ownerRepo}/HEAD/${f.path}`;
        const content = await streamDownload(rawUrl);
        const tmpFile = path.join(tmpDir, `skill-${i}.md`);
        fs.writeFileSync(tmpFile, content);
        if (validateSkill(tmpFile).ok) passed++;
      } catch {}
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  return { passed, total, hasScripts };
}

const SKIP_DIRS_API = new Set([
  '.github', 'docs', 'doc', 'documentation', 'examples', 'example',
  'tests', 'test', 'assets', 'images', 'img', 'media', 'static',
  'node_modules', 'vendor', 'dist', 'build', '.git',
  'references', 'reference', 'refs', 'cheatsheet', 'cheat-sheet',
  'cheatsheets', 'resources',
  'src', 'cli', 'lib', 'bin', 'scripts',
]);

function git(args, cwd, stdio = 'inherit') {
  return spawnSync('git', args, { cwd, stdio });
}

// Clone only the skills subdir via sparse-checkout
function sparseClone(url, dest, subdir) {
  fs.mkdirSync(dest, { recursive: true });

  // 1. init + add remote
  if (git(['init'], dest, 'pipe').status !== 0) return false;
  if (git(['remote', 'add', 'origin', url], dest, 'pipe').status !== 0) return false;

  // 2. sparse-checkout — non-cone mode with *.md + script files
  git(['sparse-checkout', 'init'], dest, 'pipe');
  git(['sparse-checkout', 'set', '--no-cone',
    `${subdir}/*.md`, `${subdir}/**/*.md`,
    `${subdir}/**/*.py`, `${subdir}/**/*.sh`, `${subdir}/**/*.js`,
    `${subdir}/**/*.ts`, `${subdir}/**/*.rb`, `${subdir}/**/*.bash`,
  ], dest, 'pipe');

  // 3. fetch + checkout (depth=1, skip large blobs)
  const fetch = git(['fetch', '--depth=1', '--filter=blob:none', 'origin'], dest);
  if (fetch.status !== 0) return false;

  // Try HEAD, then main, then master
  for (const branch of ['HEAD', 'main', 'master']) {
    const r = git(['checkout', branch === 'HEAD' ? 'FETCH_HEAD' : branch], dest, 'pipe');
    if (r.status === 0) return finalizeCheckout(dest, true);
  }
  return false;
}

// Script extensions to preserve during cleanup (sparse-checkout fetches them alongside .md)
const SCRIPT_EXTS = new Set(['.py', '.sh', '.bash', '.js', '.ts', '.rb']);

// Shared skip patterns — module scope so both cleanup functions can access them
const SKIP_RE = /^(readme|changelog|license|contributing|code.of.conduct|security|authors|credits|install|installation|usage|promotion|faq|glossary|index|overview|summary|roadmap|todo|notes|template|example|sample|demo|guide|tutorial|walkthrough|architecture|design|spec|requirements|privacy|terms|disclaimer|notice|copying|warranty|funding|claude|bugs?\b|feature.?request)/i;
const SKIP_DIRS_LOCAL = new Set([
  '.github', 'docs', 'doc', 'assets', 'images', 'img', 'screenshots',
  'media', 'static', 'scripts', 'ci_scripts', 'node_modules', 'vendor',
  'dist', 'build', 'tests', 'test',
  'references', 'reference', 'refs', 'cheatsheet', 'cheat-sheet',
  'cheatsheets', 'resources',
  'src', 'cli', 'lib', 'bin',
]);

// After full-clone root: remove files that are not skills and dirs we don't need
function cleanupRepoRoot(repoRoot) {
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
        // Recurse into subdirectory to remove doc files
        removed += cleanupRepoDir(fullPath, SKIP_RE);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const base = entry.name.replace(/\.md$/i, '').toLowerCase();
      if (SKIP_RE.test(base)) {
        fs.unlinkSync(fullPath);
        removed++;
      }
    } else if (entry.isFile() && !entry.name.endsWith('.md')) {
      const ext = path.extname(entry.name).toLowerCase();
      if (entry.name !== '.gitignore' && !SCRIPT_EXTS.has(ext)) {
        try { fs.unlinkSync(fullPath); removed++; } catch {}
      }
    }
  }
  if (removed > 0) console.log(`Cleaned up ${removed} non-skill files/dirs`);
}

// Recursively remove doc .md files from subdirectories
function cleanupRepoDir(dirPath, SKIP_RE) {
  let removed = 0;
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      // Remove entire skip dirs (e.g. references/) nested inside skills dirs
      if (SKIP_DIRS_LOCAL.has(entry.name.toLowerCase())) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        removed++;
      } else {
        removed += cleanupRepoDir(fullPath, SKIP_RE);
        try { if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath); } catch {}
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const base = entry.name.replace(/\.md$/i, '').toLowerCase();
      if (SKIP_RE.test(base)) {
        fs.unlinkSync(fullPath);
        removed++;
      }
    } else if (entry.isFile() && !entry.name.endsWith('.md')) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!SCRIPT_EXTS.has(ext)) { try { fs.unlinkSync(fullPath); removed++; } catch {} }
    }
  }
  return removed;
}

// Recursively remove empty directories
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

// After fetch/checkout: force materialization of all sparse-matched files.
// partial clone (blob:none) + checkout often skips blob download on Windows.
function forceMaterialize(dest) {
  git(['checkout', 'HEAD', '--', '.'], dest, 'pipe');
}

// Update sparse repo — fetch + checkout
function sparseUpdate(dest, subdir) {
  const fetch = git(['fetch', '--depth=1', 'origin'], dest);
  if (fetch.status !== 0) return false;

  git(['sparse-checkout', 'set', '--no-cone',
    `${subdir}/*.md`, `${subdir}/**/*.md`,
    `${subdir}/**/*.py`, `${subdir}/**/*.sh`, `${subdir}/**/*.js`,
    `${subdir}/**/*.ts`, `${subdir}/**/*.rb`, `${subdir}/**/*.bash`,
  ], dest, 'pipe');

  for (const ref of ['origin/main', 'origin/master']) {
    const r = git(['checkout', ref], dest, 'pipe');
    if (r.status !== 0) continue;
    forceMaterialize(dest);
    return true;
  }
  return false;
}

// After checkout, force materialization of sparse-matched files.
function finalizeCheckout(dest, success) {
  if (success) {
    forceMaterialize(dest);
    // Make scripts executable on unix
    if (process.platform !== 'win32') {
      const scriptExts = ['.py', '.sh', '.bash', '.rb'];
      try {
        const scripts = globSync(`${dest}/**/*{${scriptExts.join(',')}}`, { absolute: true, dot: true });
        for (const s of scripts) { try { fs.chmodSync(s, 0o755); } catch {} }
      } catch {}
    }
  }
  return success;
}

// Fallback: clone root but only checkout .md files
function fullClone(url, dest) {
  if (fs.existsSync(dest)) {
    const fetch = git(['fetch', '--depth=1', '--filter=blob:none', 'origin'], dest);
    if (fetch.status !== 0) return false;
    for (const ref of ['origin/HEAD', 'origin/main', 'origin/master']) {
      const ok = git(['reset', '--hard', ref], dest, 'pipe').status === 0;
      if (ok) return finalizeCheckout(dest, true);
    }
    return false;
  }
  // init + sparse *.md + fetch + checkout
  fs.mkdirSync(dest, { recursive: true });
  if (git(['init'], dest, 'pipe').status !== 0) return false;
  if (git(['remote', 'add', 'origin', url], dest, 'pipe').status !== 0) return false;
  git(['sparse-checkout', 'init'], dest, 'pipe');
  git(['sparse-checkout', 'set', '--no-cone',
    '*.md', '**/*.md',
    '**/*.py', '**/*.sh', '**/*.js', '**/*.ts', '**/*.rb', '**/*.bash',
  ], dest, 'pipe');
  const fetch = git(['fetch', '--depth=1', '--filter=blob:none', 'origin'], dest);
  if (fetch.status !== 0) return false;
  for (const branch of ['FETCH_HEAD', 'main', 'master']) {
    const r = git(['checkout', branch], dest, 'pipe');
    if (r.status === 0) return finalizeCheckout(dest, true);
  }
  return false;
}

// After clone: detect actual skills dir on disk (flat + nested)
function detectSkillsDirLocal(repoRoot) {
  // 1. Flat dirs matching SKILL_DIRS (e.g. skills/, commands/)
  for (const dir of SKILL_DIRS) {
    const candidate = path.join(repoRoot, dir);
    if (fs.existsSync(candidate)) {
      const files = globSync(`${candidate}/**/*.md`, { dot: true });
      if (files.length >= 1) return { dir: candidate, label: dir, sparse: true };
    }
  }
  // 2. Nested dirs: .claude/skills, .claude-plugin/commands, etc.
  for (const prefix of ['.claude', '.claude-plugin']) {
    for (const dir of SKILL_DIRS) {
      const candidate = path.join(repoRoot, prefix, dir);
      if (fs.existsSync(candidate)) {
        const files = globSync(`${candidate}/**/*.md`, { dot: true });
        if (files.length >= 1) return { dir: candidate, label: `${prefix}/${dir}`, sparse: true };
      }
    }
  }
  return { dir: repoRoot, label: '(root)', sparse: false };
}

// Remove files classified as non-skills by embedding classifier (only if model is trained)
async function classifierCleanup(dest) {
  const mdFiles = globSync(`${dest}/**/*.md`, { dot: true });
  if (mdFiles.length === 0) return;

  const parsed = [];
  const fileMap = [];

  for (const fp of mdFiles) {
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      if (!isSkillFile(fp, raw)) continue;
      parsed.push(parseSkillFile(fp, '', { raw }));
      fileMap.push(fp);
    } catch {}
  }

  if (parsed.length === 0) {
    removeEmptyDirs(dest);
    return;
  }

  const filtered = await filterWithClassifier(parsed);
  const keptPaths = new Set(filtered.map(s => s.path));

  let removed = 0;
  for (const fp of fileMap) {
    if (!keptPaths.has(fp)) {
      try { fs.unlinkSync(fp); removed++; } catch {}
    }
  }

  if (removed > 0) {
    console.log(`Removed ${removed} non-skill files (classifier)`);
    removeEmptyDirs(dest);
  }
}

// ── main export ───────────────────────────────────────────────────────────────

export async function importFromGitHub(repoUrl) {
  if (!repoUrl) {
    console.error('Usage: promptgraph-mcp import <github-url-or-owner/repo>');
    process.exit(1);
  }

  const url = repoUrl.startsWith('http') ? repoUrl : `https://github.com/${repoUrl}`;
  const ownerRepo = url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  const repoName = ownerRepo.replace('/', '-');
  const dest = path.join(getSkillsStoreDir(), 'github', repoName);

  const isNew = !fs.existsSync(dest);

  if (isNew) {
    const exists = await repoExists(ownerRepo);
    if (!exists) throw new Error(`Repository not found (404): ${url}`);
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  let skillsSubdir = null;
  let cloneOk = false;

  if (isNew) {
    // Detect skills dir via API before cloning
    process.stdout.write(`Detecting skills directory for ${ownerRepo}... `);
    const detected = await detectSkillsDirFromAPI(ownerRepo);
    skillsSubdir = detected?.subdir || null;

    if (!skillsSubdir) {
      console.log(`found: (root) — no skills subdirectory, using full clone`);
      cloneOk = fullClone(url, dest);
    } else {
      console.log(`found: ${detected.label}/`);
      console.log(`Sparse-cloning ${url} (${skillsSubdir}/ only)...`);
      cloneOk = sparseClone(url, dest, skillsSubdir);
    }
    if (!cloneOk) {
      fs.rmSync(dest, { recursive: true, force: true });
      throw new Error(`Sparse-checkout failed for ${url}`);
    }

    if (!cloneOk) throw new Error(`Clone failed for ${url}`);
  } else {
    console.log(`Updating ${repoName}...`);
    // Detect existing sparse subdir
    const isSparse = git(['sparse-checkout', 'list'], dest, 'pipe').status === 0;
    const sparseList = isSparse
      ? spawnSync('git', ['sparse-checkout', 'list'], { cwd: dest, encoding: 'utf8' }).stdout.trim()
      : '';
    skillsSubdir = (() => {
      const lines = sparseList.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return null;
      const exact = lines.find(l => SKILL_DIRS.includes(l));
      if (exact) return exact;
      for (const line of lines) {
        const m = line.match(/^(.+)\/(?:\*\*\/)?\*\.md$/);
        if (m && !m[1].includes('*')) return m[1];
      }
      return null;
    })();

    cloneOk = skillsSubdir
      ? sparseUpdate(dest, skillsSubdir)
      : fullClone(url, dest);
    if (!cloneOk) throw new Error(`Update failed for ${repoName}`);
  }

  // Remove doc files anywhere in the cloned tree
  cleanupRepoRoot(dest);
  removeEmptyDirs(dest);

  // Validate every .md file via isSkillFile — delete low-quality files
  const allMd = globSync(`${dest}/**/*.md`, { dot: true });
  let removedInvalid = 0;
  for (const fp of allMd) {
    if (!isSkillFile(fp)) {
      try { fs.unlinkSync(fp); removedInvalid++; } catch {}
    }
  }
  if (removedInvalid > 0) {
    console.log(`Removed ${removedInvalid} low-quality .md files (isSkillFile)`);
    removeEmptyDirs(dest);
  }

  // Full validateSkill() pass — remove files that fail marketplace-level validation
  const remainingMd = globSync(`${dest}/**/*.md`, { dot: true });
  let removedFailedValidation = 0;
  for (const fp of remainingMd) {
    const v = validateSkill(fp);
    if (!v.ok) {
      try { fs.unlinkSync(fp); removedFailedValidation++; } catch {}
    }
  }
  if (removedFailedValidation > 0) {
    console.log(`Removed ${removedFailedValidation} files that failed validateSkill()`);
    removeEmptyDirs(dest);
  }

  await classifierCleanup(dest);

  // Count survivors after all cleanup
  const realCount = globSync(`${dest}/**/*.md`, { dot: true }).length;
  const cacheKey = url.replace(/\.git$/, '');
  const cachePath = path.join(PROMPTGRAPH_DIR, 'skill-counts.json');
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8') || '{}');
    cache[cacheKey] = { count: realCount, ts: Date.now() };
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch {}

  if (realCount < 1) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new Error(`No valid skills in repo — all files were filtered out`);
  }

  const { dir: localDir, label: localLabel } = detectSkillsDirLocal(dest);
  // Prefer the known skillsSubdir (from API detection or sparse patterns) as the
  // canonical skills directory — it's more accurate than local heuristics for
  // repos with non-standard dir names (e.g. "specialized", "cli", or nested paths)
  const skillsDir = skillsSubdir ? path.join(dest, skillsSubdir) : localDir;
  const label = skillsSubdir || localLabel;
  const mdFiles = globSync(`${skillsDir}/**/*.md`, { dot: true });

  if (mdFiles.length > MAX_FILE_COUNT) {
    console.warn(`Warning: ${mdFiles.length} .md files exceeds limit of ${MAX_FILE_COUNT} — truncating`);
  }

  if (skillsSubdir) {
    console.log(`Sparse-checkout: ${label}/ only (${mdFiles.length} .md files, no other repo files)`);
  } else {
    console.log(`Full clone: scanning ${label} (${mdFiles.length} .md files)`);
  }

  const config = loadConfig();
  const repoSource = `github:${repoName}`;
  if (!config.sources.find(s => s.dir === skillsDir)) {
    const oldIdx = config.sources.findIndex(s => s.source === repoSource);
    if (oldIdx !== -1) config.sources.splice(oldIdx, 1);
    config.sources.push({ dir: skillsDir, source: repoSource });
    saveConfig(config);
  }

  console.log();
  await indexSource(skillsDir, repoSource);
  console.log(`Done! Imported from ${repoName}/${label}`);
}

// ── Detect skills subdir from local git tree (no API calls) ───────────────────

function detectSubdirFromTree(repoRoot) {
  const lsTree = spawnSync('git', ['-C', repoRoot, 'ls-tree', '--name-only', 'HEAD'], { encoding: 'utf8', stdio: 'pipe' });
  if (lsTree.status !== 0) return null;
  const entries = lsTree.stdout.trim().split('\n').filter(Boolean);
  const dirMap = new Map();
  for (const e of entries) dirMap.set(e.toLowerCase(), e);

  for (const d of SKILL_DIRS) {
    if (dirMap.has(d)) return dirMap.get(d);
  }

  for (const prefix of ['.claude', '.claude-plugin', '.github']) {
    if (dirMap.has(prefix)) {
      const realPrefix = dirMap.get(prefix);
      const sub = spawnSync('git', ['-C', repoRoot, 'ls-tree', '--name-only', `HEAD:${realPrefix}`], { encoding: 'utf8', stdio: 'pipe' });
      if (sub.status === 0) {
        for (const d of SKILL_DIRS) {
          if (sub.stdout.split('\n').map(s => s.toLowerCase()).includes(d)) return `${realPrefix}/${d}`;
        }
      }
    }
  }

  // No known skill dir found — check if repo root has .md files itself
  const rootMdCount = entries.filter(e => e.endsWith('.md')).length;
  if (rootMdCount >= 2) return null; // root has skills — take everything

  // Otherwise check subdirs: if most non-skip subdirs have .md files, take root (all dirs)
  const skipSet = new Set([...SKIP_DIRS_API]);
  const candidates = entries.filter(e => !skipSet.has(e.toLowerCase()) && !e.includes('.'));
  let dirsWithMd = 0;
  let best = null, bestCount = 0;
  for (const dir of candidates) {
    const sub = spawnSync('git', ['-C', repoRoot, 'ls-tree', '-r', '--name-only', `HEAD:${dir}`], { encoding: 'utf8', stdio: 'pipe' });
    if (sub.status !== 0) continue;
    const mdCount = sub.stdout.split('\n').filter(f => f.endsWith('.md')).length;
    if (mdCount >= 1) { dirsWithMd++; if (mdCount > bestCount) { best = dir; bestCount = mdCount; } }
  }
  // If multiple dirs have .md files — they're all skill categories, take root
  if (dirsWithMd > 1) return null;
  return best;
}

// ── light version (git sparse-checkout, no API rate limits) ───────────────────

// Core clone + filter pipeline. Single source of truth for both real installs
// and offline validation. Materializes the skills subdir into destBase, applies
// isSkillFile + validateSkill filters, and returns the ground-truth result.
// NO side effects (no config write, no indexing) — caller decides what to do.
// Throws 'No valid skills...' if nothing survives filtering.
export function cloneAndFilterRepo(ownerRepo, destBase, prog = () => {}) {
  const cloneUrl = `https://github.com/${ownerRepo}.git`;
  if (fs.existsSync(destBase)) fs.rmSync(destBase, { recursive: true, force: true });
  fs.mkdirSync(destBase, { recursive: true });

  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  // core.longpaths=true — required on Windows for repos with deep nested paths
  // (>260 chars) that otherwise fail checkout with "UNKNOWN: open" / "Checkout failed".
  const LP = ['-c', 'core.longpaths=true'];

  // Step 1: treeless clone — gets file tree instantly, no blob download, no API
  prog(`Cloning ${ownerRepo}...`);
  const init = spawnSync('git', [...LP, 'clone', '--depth=1', '--filter=blob:none', '--no-checkout', '--progress', cloneUrl, destBase], { stdio: 'pipe', env: gitEnv, timeout: 120000 });
  if (init.status !== 0) {
    fs.rmSync(destBase, { recursive: true, force: true });
    throw new Error(`Failed to clone ${ownerRepo}: ${(init.stderr?.toString() || '').trim().slice(0, 120)}`);
  }

  // Step 2: detect skills subdir from local tree — zero API calls
  prog(`Detecting skill directory...`);
  const subdir = detectSubdirFromTree(destBase);

  // Step 3: sparse-checkout skills subdir — .md files + scripts (.py/.sh/.js/.ts/.rb/.bash)
  prog(`Setting up sparse checkout${subdir ? ` (${subdir}/)` : ''}...`);
  spawnSync('git', [...LP, '-C', destBase, 'sparse-checkout', 'init'], { stdio: 'pipe', env: gitEnv });
  if (subdir) {
    spawnSync('git', [...LP, '-C', destBase, 'sparse-checkout', 'set', '--no-cone',
      `${subdir}/*.md`, `${subdir}/**/*.md`,
      `${subdir}/**/*.py`, `${subdir}/**/*.sh`, `${subdir}/**/*.js`,
      `${subdir}/**/*.ts`, `${subdir}/**/*.rb`, `${subdir}/**/*.bash`,
    ], { stdio: 'pipe', env: gitEnv });
  } else {
    spawnSync('git', [...LP, '-C', destBase, 'sparse-checkout', 'set', '--no-cone',
      '*.md', '**/*.md',
      '**/*.py', '**/*.sh', '**/*.js', '**/*.ts', '**/*.rb', '**/*.bash',
    ], { stdio: 'pipe', env: gitEnv });
  }

  // Step 4: checkout to materialize only the selected files
  prog(`Downloading .md files...`);
  const co = spawnSync('git', [...LP, '-C', destBase, 'checkout'], { stdio: 'pipe', env: gitEnv, timeout: 120000 });
  if (co.status !== 0) {
    fs.rmSync(destBase, { recursive: true, force: true });
    throw new Error(`Checkout failed for ${ownerRepo}`);
  }
  // Force blob materialization (needed for partial clones on Windows)
  spawnSync('git', [...LP, '-C', destBase, 'checkout', 'HEAD', '--', '.'], { stdio: 'pipe', env: gitEnv, timeout: 120000 });

  // Make scripts executable on unix
  if (process.platform !== 'win32') {
    try {
      const scripts = globSync(SCRIPT_GLOBS.map(p => `${destBase}/${p}`), { absolute: true, dot: true });
      for (const s of scripts) { try { fs.chmodSync(s, 0o755); } catch {} }
    } catch {}
  }

  // hasScripts = real scripts on disk in the materialized subdir (ground truth)
  const hasScripts = globSync(SCRIPT_GLOBS.map(p => `${destBase}/${p}`), { absolute: true, dot: true }).length > 0;

  // Step 5: filter out non-skill files locally
  // absolute:true — otherwise glob returns cwd-relative paths; when destBase is not
  // under cwd those contain ".." and validateSkill flags every file as path-traversal.
  const allMd = globSync(`${destBase}/**/*.md`, { absolute: true, dot: true });
  prog(`Filtering ${allMd.length} files...`);
  let removed = 0;
  for (const fp of allMd) {
    if (!isSkillFile(fp)) { try { fs.unlinkSync(fp); removed++; } catch {} }
  }
  if (removed > 0) removeEmptyDirs(destBase);

  const remaining = globSync(`${destBase}/**/*.md`, { absolute: true, dot: true });
  prog(`Validating ${remaining.length} skill files...`);
  let removedV = 0;
  for (const fp of remaining) {
    const v = validateSkill(fp);
    if (!v.ok) { try { fs.unlinkSync(fp); removedV++; } catch {} }
  }
  if (removedV > 0) removeEmptyDirs(destBase);

  const realCount = globSync(`${destBase}/**/*.md`, { absolute: true, dot: true }).length;

  if (realCount < 1) {
    fs.rmSync(destBase, { recursive: true, force: true });
    throw new Error('No valid skills in repo — all files were filtered out');
  }

  return { realCount, hasScripts, subdir };
}

export async function importFromGitHubLight(repoUrl) {
  if (!repoUrl) throw new Error('Missing repoUrl');

  const url = repoUrl.startsWith('http') ? repoUrl : `https://github.com/${repoUrl}`;
  const ownerRepo = url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  const repoName = ownerRepo.replace('/', '-');
  const destBase = path.join(getSkillsStoreDir(), 'github', repoName);

  const prog = (msg) => process.stderr.write(`\r\x1b[K  ${msg}`);

  const { realCount, subdir } = cloneAndFilterRepo(ownerRepo, destBase, prog);
  process.stderr.write('\n');

  // Update both caches with the real post-filter count
  try {
    const { setCachedCount } = await import('./bundle-counts.js');
    const cacheKey = url.replace(/\.git$/, '').replace(/^https?:\/\/github\.com\//, '');
    setCachedCount(cacheKey, realCount);
    setCachedCount(url.replace(/\.git$/, ''), realCount);
  } catch {}

  const { dir: localDir, label: localLabel } = detectSkillsDirLocal(destBase);
  const skillsDir = subdir ? path.join(destBase, subdir) : localDir;
  const label = subdir || localLabel;

  const config = loadConfig();
  const repoSource = `github:${repoName}`;
  if (!config.sources.find(s => s.dir === skillsDir)) {
    const oldIdx = config.sources.findIndex(s => s.source === repoSource);
    if (oldIdx !== -1) config.sources.splice(oldIdx, 1);
    config.sources.push({ dir: skillsDir, source: repoSource });
    saveConfig(config);
  }

  console.log();
  await indexSource(skillsDir, repoSource);
  console.log(`Done! Imported from ${repoName}/${label || 'root'} (${realCount} skills via git)`);
}
