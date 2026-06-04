import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { globSync } from 'glob';
import { indexAll } from './indexer.js';
import { loadConfig, saveConfig } from './config.js';

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills-store');

export async function importFromGitHub(repoUrl) {
  if (!repoUrl) {
    console.error('Usage: promptgraph-mcp import <github-url-or-owner/repo>');
    process.exit(1);
  }

  const url = repoUrl.startsWith('http') ? repoUrl : `https://github.com/${repoUrl}`;
  const repoName = url.split('/').slice(-2).join('-').replace('.git', '');
  const dest = path.join(SKILLS_DIR, 'github', repoName);

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

  const mdFiles = globSync(`${dest}/**/*.md`);
  console.log(`Found ${mdFiles.length} .md files`);

  if (mdFiles.length < 2) {
    console.warn('Warning: repo has fewer than 2 .md files — may be empty');
  }

  const config = loadConfig();
  // Per-repo source so two repos with the same skill name don't overwrite each other
  const repoSource = `github:${repoName}`;
  if (!config.sources.find(s => s.dir === dest)) {
    config.sources.push({ dir: dest, source: repoSource });
    saveConfig(config);
    console.log(`Added ${repoSource} to config`);
  }

  console.log('\nReindexing...');
  await indexAll();
  console.log(`Done! Imported ${mdFiles.length} files from ${repoName}`);
}
