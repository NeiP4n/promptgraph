import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { globSync } from 'glob';
import { indexAll, indexSource } from './indexer.js';
import { loadConfig, saveConfig, SKILLS_STORE_DIR } from './config.js';

const SKILL_DIRS = ['skills', 'commands', 'prompts', 'agents', 'skills-store', 'slash-commands', 'custom-commands', 'templates'];

// ── helpers ───────────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { 'User-Agent': 'promptgraph-mcp' } }, r => {
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

// Ask GitHub API which skill subdir exists (without cloning anything)
async function detectSkillsDirFromAPI(ownerRepo) {
  try {
    const json = await httpsGet(`https://api.github.com/repos/${ownerRepo}/contents`);
    const entries = JSON.parse(json);
    const dirs = new Set(entries.filter(e => e.type === 'dir').map(e => e.name.toLowerCase()));
    for (const d of SKILL_DIRS) {
      if (dirs.has(d)) return d;
    }
  } catch {}
  return null; // use repo root
}

function git(args, cwd, stdio = 'inherit') {
  return spawnSync('git', args, { cwd, stdio });
}

// Clone only the skills subdir via sparse-checkout
function sparseClone(url, dest, subdir) {
  fs.mkdirSync(dest, { recursive: true });

  // 1. init + add remote
  if (git(['init'], dest, 'pipe').status !== 0) return false;
  if (git(['remote', 'add', 'origin', url], dest, 'pipe').status !== 0) return false;

  // 2. sparse-checkout config
  git(['sparse-checkout', 'init', '--cone'], dest, 'pipe');
  git(['sparse-checkout', 'set', subdir], dest, 'pipe');

  // 3. fetch + checkout (depth=1)
  const fetch = git(['fetch', '--depth=1', 'origin'], dest);
  if (fetch.status !== 0) return false;

  // Try HEAD, then main, then master
  for (const branch of ['HEAD', 'main', 'master']) {
    const r = git(['checkout', branch === 'HEAD' ? 'FETCH_HEAD' : branch], dest, 'pipe');
    if (r.status === 0) return true;
  }
  return false;
}

// Update sparse repo — fetch + reset
function sparseUpdate(dest, subdir) {
  const fetch = git(['fetch', '--depth=1', 'origin'], dest);
  if (fetch.status !== 0) return false;

  // Ensure sparse-checkout still set correctly
  git(['sparse-checkout', 'set', subdir], dest, 'pipe');

  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master']) {
    const r = git(['reset', '--hard', ref], dest, 'pipe');
    if (r.status === 0) return true;
  }
  return false;
}

// Fallback: full clone (when no subdir found)
function fullClone(url, dest) {
  if (fs.existsSync(dest)) {
    const fetch = git(['fetch', '--depth=1', 'origin'], dest);
    if (fetch.status !== 0) return false;
    for (const ref of ['origin/HEAD', 'origin/main', 'origin/master']) {
      if (git(['reset', '--hard', ref], dest, 'pipe').status === 0) return true;
    }
    return false;
  }
  return git(['clone', '--depth=1', url, dest]).status === 0;
}

// After clone: detect actual skills dir on disk
function detectSkillsDirLocal(repoRoot) {
  for (const dir of SKILL_DIRS) {
    const candidate = path.join(repoRoot, dir);
    if (fs.existsSync(candidate)) {
      const files = globSync(`${candidate}/**/*.md`);
      if (files.length >= 2) return { dir: candidate, label: dir, sparse: true };
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
    console.log(`Detecting skills directory for ${ownerRepo}...`);
    skillsSubdir = await detectSkillsDirFromAPI(ownerRepo);

    if (skillsSubdir) {
      console.log(`Sparse-cloning ${url} (${skillsSubdir}/ only)...`);
      cloneOk = sparseClone(url, dest, skillsSubdir);
      if (!cloneOk) {
        // Sparse failed — fall back to full clone
        console.log('Sparse-checkout failed, falling back to full clone...');
        fs.rmSync(dest, { recursive: true, force: true });
        cloneOk = fullClone(url, dest);
        skillsSubdir = null;
      }
    } else {
      console.log(`Cloning ${url}...`);
      cloneOk = fullClone(url, dest);
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
