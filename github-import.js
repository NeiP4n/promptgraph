import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import https from 'https';
import { globSync } from 'glob';
import { indexAll, indexSource } from './indexer.js';
import { loadConfig, saveConfig, SKILLS_STORE_DIR } from './config.js';

function repoExists(repoUrl) {
  const owner_repo = repoUrl.startsWith('http')
    ? repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
    : repoUrl;
  return new Promise(resolve => {
    const req = https.request(
      { host: 'github.com', path: `/${owner_repo}`, method: 'HEAD', headers: { 'User-Agent': 'promptgraph-mcp' } },
      res => resolve(res.statusCode < 400)
    );
    req.on('error', () => resolve(false));
    req.end();
  });
}

// Directories likely to contain skills — checked in priority order
const SKILL_DIRS = ['skills', 'commands', 'prompts', 'agents', 'skills-store', 'slash-commands', 'custom-commands', 'templates'];

// Find the best subdirectory to index in the cloned repo.
// Returns the subdir path if a known skills dir exists with 2+ .md files,
// otherwise returns the repo root (full scan with isSkillFile filtering).
function detectSkillsDir(repoRoot) {
  for (const dir of SKILL_DIRS) {
    const candidate = path.join(repoRoot, dir);
    if (fs.existsSync(candidate)) {
      const files = globSync(`${candidate}/**/*.md`);
      if (files.length >= 2) return { dir: candidate, auto: true, label: dir };
    }
  }
  return { dir: repoRoot, auto: false, label: '(root)' };
}

export async function importFromGitHub(repoUrl) {
  if (!repoUrl) {
    console.error('Usage: promptgraph-mcp import <github-url-or-owner/repo>');
    process.exit(1);
  }

  const url = repoUrl.startsWith('http') ? repoUrl : `https://github.com/${repoUrl}`;
  const repoName = url.split('/').slice(-2).join('-').replace('.git', '');
  const dest = path.join(SKILLS_STORE_DIR, 'github', repoName);

  if (!fs.existsSync(dest)) {
    const exists = await repoExists(repoUrl);
    if (!exists) throw new Error(`Repository not found (404): ${url}`);
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) {
    console.log(`Updating ${repoName}...`);
    // fetch + reset handles force-pushes and unrelated histories without re-cloning
    const fetch = spawnSync('git', ['-C', dest, 'fetch', '--depth=1', 'origin'], { stdio: 'inherit' });
    if (fetch.status !== 0) throw new Error(`git fetch failed for ${repoName}`);
    const reset = spawnSync('git', ['-C', dest, 'reset', '--hard', 'origin/HEAD'], { stdio: 'pipe' });
    if (reset.status !== 0) {
      // fallback: try origin/main then origin/master
      const main = spawnSync('git', ['-C', dest, 'reset', '--hard', 'origin/main'], { stdio: 'pipe' });
      if (main.status !== 0) {
        const master = spawnSync('git', ['-C', dest, 'reset', '--hard', 'origin/master'], { stdio: 'inherit' });
        if (master.status !== 0) throw new Error(`git reset failed for ${repoName}`);
      }
    }
  } else {
    console.log(`Cloning ${url}...`);
    const cloneResult = spawnSync('git', ['clone', '--depth=1', url, dest], { stdio: 'inherit' });
    if (cloneResult.status !== 0) throw new Error(`git clone failed for ${url}`);
  }

  const { dir: skillsDir, auto, label } = detectSkillsDir(dest);
  const mdFiles = globSync(`${skillsDir}/**/*.md`);

  if (auto) {
    console.log(`Auto-detected skills directory: ${label}/ (${mdFiles.length} .md files)`);
  } else {
    console.log(`No skills/ dir found — scanning root (${mdFiles.length} .md files, non-skill files will be filtered)`);
  }

  if (mdFiles.length < 1) {
    console.warn('Warning: no .md files found');
  }

  const config = loadConfig();
  const repoSource = `github:${repoName}`;
  if (!config.sources.find(s => s.dir === skillsDir)) {
    // Remove any old entry pointing at the full repo root if we now have a subdir
    const oldIdx = config.sources.findIndex(s => s.source === repoSource);
    if (oldIdx !== -1) config.sources.splice(oldIdx, 1);
    config.sources.push({ dir: skillsDir, source: repoSource });
    saveConfig(config);
    console.log(`Indexing from: ${skillsDir}`);
  }

  console.log();
  await indexSource(skillsDir, repoSource);
  console.log(`Done! Imported from ${repoName}/${label}`);
}
