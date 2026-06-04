import { execSync } from 'child_process';
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
    execSync('git', { stdio: 'inherit', args: ['-C', dest, 'pull', '--depth=1'] });
  } else {
    console.log(`Cloning ${url}...`);
    // use spawnSync to avoid shell injection
    const { spawnSync } = await import('child_process');
    const result = spawnSync('git', ['clone', '--depth=1', url, dest], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`git clone failed for ${url}`);
  }

  const mdFiles = globSync(`${dest}/**/*.md`);
  console.log(`Found ${mdFiles.length} .md files`);

  if (mdFiles.length < 2) {
    console.warn('Warning: repo has fewer than 2 .md files — may be empty');
  }

  const config = loadConfig();
  const githubDir = path.join(SKILLS_DIR, 'github');
  if (!config.sources.find(s => s.dir === githubDir)) {
    config.sources.push({ dir: githubDir, source: 'github' });
    saveConfig(config);
    console.log('Added github dir to config');
  }

  console.log('\nReindexing...');
  await indexAll();
  console.log(`Done! Imported ${mdFiles.length} files from ${repoName}`);
}
