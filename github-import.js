import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { globSync } from 'glob';
import { indexAll, indexSource } from './indexer.js';
import { loadConfig, saveConfig, PROMPTGRAPH_DIR, SKILLS_STORE_DIR } from './config.js';
import { validateSkill } from './validator.js';
import { isSkillFile } from './parser.js';

const SKILL_DIRS = ['skills', 'commands', 'prompts', 'agents', 'skills-store', 'slash-commands', 'custom-commands', 'templates'];

// ── helpers ───────────────────────────────────────────────────────────────────

function httpsGet(url) {
  const token = process.env.GITHUB_TOKEN;
  const headers = { 'User-Agent': 'promptgraph-mcp' };
  if (token && url.startsWith('https://api.github.com/')) headers['Authorization'] = `Bearer ${token}`;
  return new Promise((res, rej) => {
    const req = https.get(url, { headers }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return httpsGet(r.headers.location).then(res, rej);
      if (r.statusCode !== 200) { r.resume(); return rej(new Error(`HTTP ${r.statusCode}`)); }
      let d = ''; r.setEncoding('utf8'); r.on('data', c => d += c); r.on('end', () => res(d));
    });
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
async function validateMdFile(file, tmpDir) {
  const errors = [];
  const warnings = [];
  try {
    const content = await httpsGet(file.download_url);
    const tmpPath = path.join(tmpDir, file.name);
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
    // Has a skills subdirectory — list contents
    const subdir = detected.subdir;
    let entries;
    try {
      const json = await httpsGet(`https://api.github.com/repos/${ownerRepo}/contents/${subdir}`);
      entries = JSON.parse(json);
    } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return { ok: false, errors: [`Failed to list ${subdir}/ contents: ${e.message}`], warnings: [] };
    }
    mdFiles = entries.filter(e => e.type === 'file' && e.name.endsWith('.md'));
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
  const SKIP_DOCS = /^(readme|license|changelog|contributing|code.?of.?conduct|security|authors|credits|install|faq|index|overview|summary|todo|notes|template|copying|warranty|funding|roadmap)/i;
  const mdTrimmed = mdFiles.filter(f => !SKIP_DOCS.test(f.name.replace(/\.md$/i, '')));
  const mdToValidate = mdTrimmed.length > 0 ? mdTrimmed : mdFiles;

  let errors = [];
  let warnings = [];

  for (const file of mdToValidate) {
    const r = await validateMdFile(file, tmpDir);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  return { ok: errors.length === 0, errors, warnings };
}

// Ask GitHub API which subdir to use (without cloning anything). Exported for validation.
export
// Returns { subdir, label } or null (use root).
async function detectSkillsDirFromAPI(ownerRepo) {
  try {
    const json = await httpsGet(`https://api.github.com/repos/${ownerRepo}/contents`);
    const entries = JSON.parse(json);

    // 1. Known skill dir names (priority order)
    const dirMap = new Map(entries.filter(e => e.type === 'dir').map(e => [e.name.toLowerCase(), e.name]));
    for (const d of SKILL_DIRS) {
      if (dirMap.has(d)) return { subdir: dirMap.get(d), label: d };
    }

    // 2. Any subdir with 2+ .md files — pick the one with most .md files
    const subdirCandidates = entries.filter(e => e.type === 'dir' && !SKIP_DIRS_API.has(e.name.toLowerCase()));
    let best = null, bestCount = 0;
    for (const dir of subdirCandidates) {
      try {
        const sub = await httpsGet(`https://api.github.com/repos/${ownerRepo}/contents/${dir.name}`);
        const subEntries = JSON.parse(sub);
        const mdCount = subEntries.filter(e => e.type === 'file' && e.name.endsWith('.md')).length;
        if (mdCount >= 1 && mdCount > bestCount) { best = dir.name; bestCount = mdCount; }
      } catch {}
    }
    if (best) return { subdir: best, label: best };

  } catch {}
  return null; // no good subdir found — use root
}

const SKIP_DIRS_API = new Set([
  '.github', 'docs', 'doc', 'documentation', 'examples', 'example',
  'tests', 'test', 'assets', 'images', 'img', 'media', 'static',
  'node_modules', 'vendor', 'dist', 'build', '.git',
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

  // 2. sparse-checkout — non-cone mode with *.md glob
  git(['sparse-checkout', 'init'], dest, 'pipe');
  git(['sparse-checkout', 'set', '--no-cone', `${subdir}/*.md`, `${subdir}/**/*.md`], dest, 'pipe');

  // 3. fetch + checkout (depth=1, skip large blobs)
  const fetch = git(['fetch', '--depth=1', '--filter=blob:none', 'origin'], dest);
  if (fetch.status !== 0) return false;

  // Try HEAD, then main, then master
  for (const branch of ['HEAD', 'main', 'master']) {
    const r = git(['checkout', branch === 'HEAD' ? 'FETCH_HEAD' : branch], dest, 'pipe');
    if (r.status === 0) return true;
  }
  return false;
}

// After full-clone root: remove files that are not skills and dirs we don't need
function cleanupRepoRoot(repoRoot) {
  const SKIP_RE = /^(readme|changelog|license|contributing|code.of.conduct|security|authors|credits|install|installation|usage|promotion|faq|glossary|index|overview|summary|roadmap|todo|notes|template|example|sample|demo|guide|tutorial|walkthrough|architecture|design|spec|requirements|privacy|terms|disclaimer|notice|copying|warranty|funding)/i;
  const SKIP_DIRS_LOCAL = new Set(['.github', 'docs', 'doc', 'assets', 'images', 'img', 'screenshots', 'media', 'static', 'scripts', 'ci_scripts', 'node_modules', 'vendor', 'dist', 'build', 'tests', 'test']);

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
      if (entry.name !== '.gitignore') {
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
      removed += cleanupRepoDir(fullPath, SKIP_RE);
      // Remove empty dirs after cleanup
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

// Update sparse repo — fetch + reset
function sparseUpdate(dest, subdir) {
  const fetch = git(['fetch', '--depth=1', 'origin'], dest);
  if (fetch.status !== 0) return false;

  // Ensure sparse-checkout still set correctly
  git(['sparse-checkout', 'set', '--no-cone', `${subdir}/*.md`, `${subdir}/**/*.md`], dest, 'pipe');

  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master']) {
    const r = git(['reset', '--hard', ref], dest, 'pipe');
    if (r.status === 0) return true;
  }
  return false;
}

// Fallback: clone root but only checkout .md files
function fullClone(url, dest) {
  if (fs.existsSync(dest)) {
    const fetch = git(['fetch', '--depth=1', '--filter=blob:none', 'origin'], dest);
    if (fetch.status !== 0) return false;
    for (const ref of ['origin/HEAD', 'origin/main', 'origin/master']) {
      if (git(['reset', '--hard', ref], dest, 'pipe').status === 0) return true;
    }
    return false;
  }
  // init + sparse *.md + fetch + checkout
  fs.mkdirSync(dest, { recursive: true });
  if (git(['init'], dest, 'pipe').status !== 0) return false;
  if (git(['remote', 'add', 'origin', url], dest, 'pipe').status !== 0) return false;
  git(['sparse-checkout', 'init'], dest, 'pipe');
  git(['sparse-checkout', 'set', '--no-cone', '*.md', '**/*.md'], dest, 'pipe');
  const fetch = git(['fetch', '--depth=1', '--filter=blob:none', 'origin'], dest);
  if (fetch.status !== 0) return false;
  for (const branch of ['FETCH_HEAD', 'main', 'master']) {
    const r = git(['checkout', branch], dest, 'pipe');
    if (r.status === 0) return true;
  }
  return false;
}

// After clone: detect actual skills dir on disk
function detectSkillsDirLocal(repoRoot) {
  for (const dir of SKILL_DIRS) {
    const candidate = path.join(repoRoot, dir);
    if (fs.existsSync(candidate)) {
      const files = globSync(`${candidate}/**/*.md`);
      if (files.length >= 1) return { dir: candidate, label: dir, sparse: true };
    }
  }
  return { dir: repoRoot, label: '(root)', sparse: false };
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
  const dest = path.join(SKILLS_STORE_DIR, 'github', repoName);

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
    skillsSubdir = sparseList.split('\n').find(l => SKILL_DIRS.includes(l.trim())) || null;

    cloneOk = skillsSubdir
      ? sparseUpdate(dest, skillsSubdir)
      : fullClone(url, dest);
    if (!cloneOk) throw new Error(`Update failed for ${repoName}`);
  }

  // Remove doc files anywhere in the cloned tree
  cleanupRepoRoot(dest);

  // Validate every .md file via isSkillFile — delete low-quality files
  const allMd = globSync(`${dest}/**/*.md`);
  let removedInvalid = 0;
  for (const fp of allMd) {
    if (!isSkillFile(fp)) {
      try { fs.unlinkSync(fp); removedInvalid++; } catch {}
    }
  }
  if (removedInvalid > 0) {
    console.log(`Removed ${removedInvalid} low-quality .md files (isSkillFile)`);
    // Clean up empty dirs left behind
    removeEmptyDirs(dest);
  }

  const { dir: skillsDir, label } = detectSkillsDirLocal(dest);
  const mdFiles = globSync(`${skillsDir}/**/*.md`);

  if (skillsSubdir) {
    console.log(`Sparse-checkout: ${label}/ only (${mdFiles.length} .md files, no other repo files)`);
  } else {
    console.log(`Full clone: scanning ${label} (${mdFiles.length} .md files)`);
  }

  if (mdFiles.length < 1) console.warn('Warning: no .md files found');

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
