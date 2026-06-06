import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import fs from 'fs';
import boxen from 'boxen';

export default async function handler(args, bin) {
  const { loadConfig: _lc } = await import('../config.js');
  const { getDb } = await import('../db.js');
  const { fetchText } = await import('../marketplace.js');
  const purple = chalk.hex('#7C3AED');
  const cfg = _lc();
  const db = getDb();

  const sourceCounts = new Map();
  for (const row of db.prepare('SELECT source, COUNT(*) as n FROM skills GROUP BY source').all()) {
    sourceCounts.set(row.source, row.n);
  }
  const totalSkills = db.prepare('SELECT COUNT(*) as n FROM skills').get().n;
  const totalBundles = cfg.sources.filter(s => s.source.startsWith('github:')).length;

  let marketSkills = 0, marketBundles = 0;
  try {
    const REGISTRY_URL = 'https://raw.githubusercontent.com/NeiP4n/promptgraph-registry/main/registry.json';
    const reg = JSON.parse(await fetchText(REGISTRY_URL));
    marketSkills = reg.skills?.length || 0;
    marketBundles = reg.bundles?.length || 0;
  } catch {}

  console.log();
  console.log('  ' + purple.bold('◆ PromptGraph Status'));
  console.log('  ' + chalk.gray('─'.repeat(56)));
  console.log();

  const skillsLine = chalk.bold.white(`${totalSkills} skills`) +
    (marketSkills ? chalk.gray(` / ${marketSkills} in registry`) : '');
  const bundlesLine = chalk.bold.white(`${totalBundles} repos`) +
    (marketBundles ? chalk.gray(` / ${marketBundles} in marketplace`) : '');
  console.log('  ' + skillsLine + chalk.gray('   ·   ') + bundlesLine);
  console.log();

  const githubSources = cfg.sources.filter(s => s.source.startsWith('github:'));
  const localSources  = cfg.sources.filter(s => !s.source.startsWith('github:'));

  if (localSources.length) {
    console.log('  ' + purple('📁  Local'));
    for (const s of localSources) {
      const n = sourceCounts.get(s.source) || 0;
      const exists = fs.existsSync(s.dir);
      const label = exists ? chalk.white(s.source) : chalk.gray(s.source + ' (missing)');
      console.log('    ' + label + chalk.gray(`  ${n} skills  ·  ${s.dir}`));
    }
    console.log();
  }

  if (githubSources.length) {
    console.log('  ' + purple('🌐  GitHub repos'));
    for (const s of githubSources) {
      const n = sourceCounts.get(s.source) || 0;
      const repoName = s.source.replace('github:', '');
      const exists = fs.existsSync(s.dir);
      const label = exists ? chalk.white(repoName) : chalk.gray(repoName + ' (not cloned)');
      console.log('    ' + label + chalk.gray(`  ${n} skills`));
      console.log('      ' + chalk.dim(s.dir));
    }
    console.log();
  }

  const marketplaceDir = path.join(os.homedir(), '.claude', 'skills-store', 'marketplace');
  const installedBundles = fs.existsSync(marketplaceDir)
    ? fs.readdirSync(marketplaceDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    : [];

  if (installedBundles.length) {
    let registryBundles = [];
    try {
      const REGISTRY_URL = 'https://raw.githubusercontent.com/NeiP4n/promptgraph-registry/main/registry.json';
      const text = await fetchText(REGISTRY_URL);
      registryBundles = JSON.parse(text).bundles || [];
    } catch {}

    console.log('  ' + purple('📦  Installed marketplace bundles'));
    for (const b of installedBundles) {
      const bundle = registryBundles.find(rb => rb.id === b);
      const name = bundle ? chalk.white.bold(bundle.name || b) : chalk.white(b);
      const cat  = bundle?.category ? chalk.dim(` [${bundle.category}]`) : '';
      const n    = sourceCounts.get('marketplace') || 0;
      console.log(`    ${name}${cat}  ${chalk.gray(n + ' skills')}`);
    }
    console.log();
  }

  const emptyRepos = githubSources.filter(s => (sourceCounts.get(s.source) || 0) === 0 && fs.existsSync(s.dir));
  if (emptyRepos.length) {
    console.log('  ' + chalk.yellow(`⚠  ${emptyRepos.length} repo(s) not indexed`) + chalk.gray('  →  run: ') + chalk.cyan(`${bin} reindex`));
    console.log();
  }

  console.log(
    boxen(
      chalk.dim('full reindex   ') + chalk.cyan(`${bin} reindex`) + '\n' +
      chalk.dim('install bundle ') + chalk.cyan(`${bin} bundle install <id>`) + '\n' +
      chalk.dim('browse market  ') + chalk.cyan(`${bin} marketplace bundles`),
      { padding: { top: 0, bottom: 0, left: 1, right: 1 }, borderStyle: 'round', borderColor: '#4B5563', dimBorder: true }
    )
  );
  console.log();
  process.exit(0);
}
