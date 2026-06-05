import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { globSync } from 'glob';
import { indexAll } from './indexer.js';
import { loadConfig, saveConfig, SKILLS_STORE_DIR } from './config.js';

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

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) {
    console.log(`Updating ${repoName}...`);
    const pullResult = spawnSync('git', ['-C', dest, 'pull', '--depth=1'], { stdio: 'inherit' });
    if (pullResult.status !== 0) throw new Error(`git pull failed for ${repoName}`);
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

  console.log('\nReindexing...');
  await indexAll();
  console.log(`Done! Imported from ${repoName}/${label}`);
}
