#!/usr/bin/env node
// Only lightweight imports at top. Heavy modules (fastembed/ONNX, vectra,
// better-sqlite3) are dynamically imported inside the command that needs them,
// so fast CLI commands (help, marketplace) start instantly.
import { colors, banner, success, error, info, section, table } from './cli.js';
import boxen from 'boxen';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';

const args = process.argv.slice(2);
// argv[1] is the resolved index.js path (esp. on Windows global installs),
// so derive a friendly name instead of showing "index".
const rawBin = process.argv[1]?.split(/[\\/]/).pop()?.replace(/\.js$/, '');
const bin = (rawBin && rawBin !== 'index') ? rawBin : 'pg';

const KNOWN_COMMANDS = new Set(['init', 'reindex', 'update', 'import', 'setup', 'validate', 'marketplace', 'doctor', 'search', 'help', '--help', '-h', 'bundle', 'status']);

function showHelp() {
  console.log(
    boxen(
      chalk.hex('#7C3AED').bold('PromptGraph') + '\n' +
      chalk.gray('Semantic skill router for Claude Code'),
      { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: '#7C3AED', dimBorder: true }
    )
  );
  console.log(chalk.gray('\nUsage:\n'));
  const cmds = [
    ['init',                'First-time setup + index all skills'],
    ['reindex',             'Re-index all skills'],
    ['search <query>',      'Search skills from the terminal'],
    ['import <owner/repo>', 'Import skills from GitHub'],
    ['status',              'Show installed skills, repos, and bundles'],
    ['marketplace [cat]',   'Browse skills by category (Engineering, Coding, …)'],
    ['marketplace bundles', 'Browse skill bundles grouped by category'],
    ['validate <file.md>',  'Validate a skill before publishing'],
    ['doctor',              'Clean orphaned chunks/edges/ratings'],
    ['update',              'Update to the latest version from npm'],
    ['setup <platform>',    'Register MCP in platform config'],
    ['help',                'Show this help'],
  ];
  for (const [cmd, desc] of cmds) {
    console.log('  ' + chalk.hex('#7C3AED')((bin + ' ' + cmd).padEnd(28)) + chalk.gray(desc));
  }
  console.log(chalk.gray('\nPlatforms: claude-code, claude-desktop, cline, codex, cursor, windsurf, opencode'));
  console.log(chalk.gray('\n  github.com/NeiP4n/promptgraph  ·  npmjs.com/package/promptgraph-mcp\n'));
}

// Explicit help request always shows help.
if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
  showHelp();
  process.exit(0);
}

// No args: if launched from an interactive terminal, show help.
// If stdin is a pipe (i.e. an MCP client like Claude), fall through and
// start the server — NEVER print to stdout here, it corrupts JSON-RPC.
if (!args[0] && process.stdin.isTTY) {
  showHelp();
  process.exit(0);
}

// Only reject an EXPLICIT unknown command. With no args (args[0] undefined),
// fall through to start the MCP server — never print to stdout here.
if (args[0] && !KNOWN_COMMANDS.has(args[0])) {
  console.log(chalk.red('✗') + '  Unknown command: ' + chalk.white(args[0]));
  console.log(chalk.gray('  Run `' + bin + ' help` to see available commands.\n'));
  process.exit(1);
}

if (args[0] === 'doctor') {
  const { runDoctor } = await import('./doctor.js');
  const spin = (await import('./cli.js')).spinner('Checking database...');
  spin.start();
  const r = runDoctor();
  spin.stop();
  success('Database checked');
  info(`Removed: ${r.orphanChunks} chunks, ${r.orphanRatings} ratings, ${r.orphanFromEdges + r.danglingEdges} edges`);
  if (r.duplicatePaths > 0) info(chalk.yellow(`Warning: ${r.duplicatePaths} duplicate paths`));
  info(chalk.gray(`Now: ${r.totalSkills} skills, ${r.totalChunks} chunks, ${r.totalEdges} edges`));
  process.exit(0);
}

if (args[0] === 'status') {
  const { loadConfig: _lc } = await import('./config.js');
  const { getDb } = await import('./db.js');
  const { fetchText } = await import('./marketplace.js');
  const purple = chalk.hex('#7C3AED');
  const cfg = _lc();
  const db = getDb();

  // Skills per source from DB
  const sourceCounts = new Map();
  for (const row of db.prepare('SELECT source, COUNT(*) as n FROM skills GROUP BY source').all()) {
    sourceCounts.set(row.source, row.n);
  }
  const totalSkills = db.prepare('SELECT COUNT(*) as n FROM skills').get().n;

  console.log();
  console.log('  ' + purple.bold('◆ PromptGraph Status'));
  console.log('  ' + chalk.gray('─'.repeat(56)));
  console.log();
  console.log('  ' + chalk.bold.white(`${totalSkills} skills indexed`) + chalk.gray(`  ·  ${cfg.sources.length} sources`));
  console.log();

  // Sources grouped by type
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

  // Marketplace skill-list bundles (installed individually, not whole repos)
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

  // Not-yet-indexed repos hint
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

if (args[0] === 'marketplace' && (args[1] === 'bundles' || args[1] === 'bundle')) {
  const { browseBundles } = await import('./marketplace.js');
  const purple = chalk.hex('#7C3AED');
  const spin = (await import('./cli.js')).spinner('Fetching bundles...');
  spin.start();
  const bundles = await browseBundles(1000);
  spin.stop();
  (await import('./cli.js')).clearScreen();

  if (bundles?.error) { error(bundles.error); process.exit(1); }

  console.log();
  console.log('  ' + purple.bold('PromptGraph Bundles') + chalk.gray('   curated skill sets'));
  console.log('  ' + chalk.gray(`${bundles.length} bundle${bundles.length === 1 ? '' : 's'}`));
  console.log('  ' + chalk.gray('─'.repeat(54)));
  console.log();

  if (!bundles.length) {
    info('No bundles yet.');
    console.log(chalk.gray('  github.com/NeiP4n/promptgraph-registry\n'));
    process.exit(0);
  }

  const CATEGORY_ICONS = { Engineering: '🛠', 'AI Tools': '🤖', Coding: '💻', Creative: '🎨', Security: '🔒', Community: '🌐' };

  const wrapB = (t, w, ind) => {
    const words = (t || '').split(/\s+/); const lines = []; let line = '';
    for (const x of words) { if ((line + ' ' + x).trim().length > w) { lines.push(line.trim()); line = x; } else line += ' ' + x; }
    if (line.trim()) lines.push(line.trim());
    return lines.map(l => ind + chalk.gray(l)).join('\n');
  };

  // Group by category
  const byCategory = {};
  for (const b of bundles) {
    const cat = b.category || 'Community';
    (byCategory[cat] = byCategory[cat] || []).push(b);
  }

  let globalIdx = 1;
  for (const [cat, items] of Object.entries(byCategory)) {
    const icon = CATEGORY_ICONS[cat] || '📦';
    console.log('  ' + chalk.hex('#7C3AED').bold(`${icon}  ${cat}`));
    console.log('  ' + chalk.gray('─'.repeat(50)));
    for (const b of items) {
      const stars = b.stars > 0 ? chalk.yellow('★ ' + b.stars) : chalk.gray('★ 0');
      const countLabel = b.repo_url
        ? chalk.blue((b.skillCount ? b.skillCount + ' skills · ' : '') + 'GitHub')
        : chalk.gray((b.skills?.length || 0) + ' skills');
      console.log('  ' + chalk.gray(globalIdx++ + '.') + ' ' + chalk.white.bold(b.id) + '   ' + stars + '   ' + countLabel);
      console.log(wrapB(b.description, 64, '     '));
      console.log('     ' + chalk.gray('includes: ') + (b.repo_url ? chalk.blue(b.repo_url) : chalk.gray((b.skills || []).join(', '))));
      if (b.tags?.length) console.log('     ' + purple(b.tags.map(t => '#' + t).join(' ')));
      console.log('     ' + chalk.gray('install:  ') + chalk.cyan(`pg bundle install ${b.id}`));
      console.log();
    }
  }

  console.log(
    boxen(
      chalk.dim('install bundle ') + chalk.cyan(`pg bundle install <id>`) + '\n' +
      chalk.dim('add repo       ') + chalk.cyan(`pg bundle add-repo <owner/repo>`) + '\n' +
      chalk.dim('browse skills  ') + chalk.cyan(`${bin} marketplace`),
      { padding: { top: 0, bottom: 0, left: 1, right: 1 }, borderStyle: 'round', borderColor: '#4B5563', dimBorder: true }
    )
  );
  console.log();
  process.exit(0);
}

if (args[0] === 'marketplace') {
  const { browseMarketplace } = await import('./marketplace.js');
  const purple = chalk.hex('#7C3AED');
  const W = 60;

  // Support: pg marketplace <category> or pg marketplace <page>
  const arg1 = args[1];
  const pageArg = parseInt(arg1);
  const categoryFilter = (!arg1 || isNaN(pageArg)) ? (arg1 || null) : null;
  const PER_PAGE = categoryFilter ? 1000 : 10;
  const page = categoryFilter ? 1 : Math.max(1, pageArg || 1);

  const { clearScreen } = await import('./cli.js');
  const spin = (await import('./cli.js')).spinner('Fetching registry...');
  spin.start();
  let all = await browseMarketplace(1000);
  spin.stop();
  clearScreen();

  if (all?.error) { error(all.error); process.exit(1); }
  if (!all.length) {
    info('Registry is empty. Be the first to contribute!');
    console.log(chalk.gray('  github.com/NeiP4n/promptgraph-registry\n'));
    process.exit(0);
  }

  const SKILL_CAT_ICONS = { Engineering: '🛠', 'AI Tools': '🤖', Coding: '💻', Creative: '🎨', Security: '🔒', Community: '🌐' };

  const wrap = (text, width, indent) => {
    const words = (text || '').split(/\s+/);
    const lines = []; let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > width) { lines.push(line.trim()); line = w; }
      else line += ' ' + w;
    }
    if (line.trim()) lines.push(line.trim());
    return lines.map(l => indent + chalk.dim(l)).join('\n');
  };

  // Filter by category if provided
  if (categoryFilter) {
    const matched = categoryFilter.toLowerCase();
    all = all.filter(s => (s.category || 'community').toLowerCase().includes(matched));
    if (!all.length) {
      error(`No skills in category "${categoryFilter}"`);
      process.exit(1);
    }
  }

  // Group by category
  const byCategory = {};
  for (const s of all) {
    const cat = s.category || 'Community';
    (byCategory[cat] = byCategory[cat] || []).push(s);
  }

  // header
  console.log();
  console.log('  ' + purple.bold('◆ PromptGraph') + chalk.dim('  ·  marketplace'));
  if (categoryFilter) {
    console.log('  ' + chalk.dim(`${all.length} skills in "${categoryFilter}"`));
  } else {
    const cats = Object.keys(byCategory);
    console.log('  ' + chalk.dim(`${all.length} skills   ·   ${cats.length} categories`));
  }
  console.log(chalk.dim('  ' + '━'.repeat(W)));
  console.log();

  // Display grouped by category
  for (const [cat, items] of Object.entries(byCategory)) {
    const icon = SKILL_CAT_ICONS[cat] || '📦';
    console.log('  ' + purple.bold(`${icon}  ${cat}`) + chalk.dim(`  (${items.length})`));

    // If not filtering and category has many, paginate within category
    const showItems = (categoryFilter || items.length <= 5) ? items : items.slice(0, 5);
    for (const s of showItems) {
      const code = s.code ? chalk.hex('#A78BFA')(s.code) : '';
      const stars = chalk.yellow('★') + chalk.dim(' ' + (s.stars || 0));
      console.log('    ' + chalk.bold.white(s.id) + '   ' + code + '  ' + stars);
      console.log(wrap(s.description, W - 6, '      '));
      if (s.tags?.length) console.log('      ' + chalk.dim(s.tags.map(t => '#' + t).join(' ')));
      console.log('      ' + chalk.dim('install: ') + chalk.cyan(`${bin} install ${s.code || s.id}`));
      console.log();
    }
    if (!categoryFilter && items.length > 5) {
      console.log('      ' + chalk.dim(`... and ${items.length - 5} more · `) + chalk.cyan(`${bin} marketplace ${cat}`));
      console.log();
    }
  }

  console.log(chalk.dim('  ' + '━'.repeat(W)));
  console.log();

  const exCode = all[0]?.code || all[0]?.id || 'pg-xxxxxx';
  const cats = Object.keys(byCategory).map(c => chalk.cyan(`${bin} marketplace ${c}`)).join('  ');
  console.log(
    boxen(
      chalk.dim('categories     ') + cats + '\n' +
      chalk.dim('install skill  ') + chalk.white('install ') + chalk.hex('#A78BFA')(exCode) + '\n' +
      chalk.dim('from GitHub    ') + chalk.white('install ') + chalk.hex('#A78BFA')('https://github.com/owner/repo/blob/main/skill.md') + '\n' +
      chalk.dim('publish skill  ') + chalk.white('/pg-publish ') + chalk.hex('#A78BFA')('<file.md>') + '\n' +
      chalk.dim('view bundles   ') + chalk.cyan(`${bin} marketplace bundles`),
      { padding: { top: 0, bottom: 0, left: 1, right: 1 }, borderStyle: 'round', borderColor: '#4B5563', dimBorder: true }
    )
  );
  console.log();
  process.exit(0);
}

if (args[0] === 'validate') {
  const { validateSkill } = await import('./validator.js');
  const file = args[1];
  if (!file) { error('Usage: ' + bin + ' validate <skill.md>'); process.exit(1); }
  const result = validateSkill(file);
  result.warnings.forEach(w => console.log(chalk.yellow('⚠') + '  ' + chalk.gray(w)));
  if (result.ok) {
    success('Skill is valid');
    process.exit(0);
  } else {
    error('Validation failed:');
    result.errors.forEach(e => console.log('   ' + chalk.red('•') + ' ' + e));
    process.exit(1);
  }
}

if (args[0] === 'search') {
  const query = args.slice(1).join(' ');
  if (!query) { error('Usage: ' + bin + ' search <query>'); process.exit(1); }
  const { search: searchSkills } = await import('./search.js');
  const spin = (await import('./cli.js')).spinner('Searching...');
  spin.start();
  const results = await searchSkills(query, 10);
  spin.stop();
  if (!results.length) { info('No results for: ' + query); process.exit(0); }
  const purple = chalk.hex('#7C3AED');
  console.log();
  results.forEach((s, i) => {
    const score = chalk.dim((s.score * 100).toFixed(0) + '%');
    console.log('  ' + chalk.dim(String(i + 1) + '.') + ' ' + chalk.bold.white(s.name) + '  ' + score);
    console.log('     ' + chalk.dim(s.description || ''));
    console.log('     ' + purple(s.source) + '  ' + chalk.dim(s.path));
    console.log();
  });
  process.exit(0);
}

if (args[0] === 'bundle') {
  if (args[1] === 'install') {
    const { installBundle } = await import('./marketplace.js');
    const result = await installBundle(args[2]);
    if (result?.error) { error(result.error); process.exit(1); }
    success(result.type === 'repo_import' ? `Imported from ${result.repo_url}` : `Installed ${result.installed?.length || 0} skills`);
    process.exit(0);
  }
  if (args[1] === 'add-repo') {
    const doPush = args[args.length - 1] === '--push';
    const repoArg = doPush ? args[2] : args[2];
    if (!repoArg || !repoArg.includes('/')) { error('Usage: pg bundle add-repo <owner/repo> [--push]'); process.exit(1); }
    const repo = repoArg.replace('https://github.com/', '').replace('.git', '');
    const name = repo.split('/')[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const id = repo.replace('/', '-').toLowerCase();
    const bundle = {
      id, name, repo_url: repo, author: repo.split('/')[0],
      description: `Skills from ${repo}`,
      tags: ['community'],
      stars: 0
    };
    const json = JSON.stringify(bundle, null, 2);

    if (doPush) {
      const registryDir = path.join(os.tmpdir(), 'pg-push-registry');
      const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
      const git = (args, opts = {}) => { const r = spawnSync('git', args, { ...opts, env: gitEnv, stdio: 'pipe' }); if (r.status !== 0) { error(r.stderr?.toString() || r.stdout?.toString() || 'git error'); process.exit(1); } return r; };
      if (fs.existsSync(registryDir)) {
        git(['-C', registryDir, 'pull']);
      } else {
        git(['clone', 'https://github.com/NeiP4n/promptgraph-registry.git', registryDir]);
      }
      const regFile = path.join(registryDir, 'registry.json');
      const reg = JSON.parse(fs.readFileSync(regFile, 'utf8'));
      if (reg.bundles.find(b => b.id === id)) { error(`Bundle "${id}" already exists`); process.exit(1); }
      reg.bundles.push(bundle);
      reg.updated = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(regFile, JSON.stringify(reg, null, 2) + '\n');
      fs.writeFileSync(path.join(registryDir, 'bundles', `${id}.json`), json + '\n');
      git(['-C', registryDir, 'config', 'user.email', 'pg-bot@promptgraph.ai']);
      git(['-C', registryDir, 'config', 'user.name', 'PromptGraph Bot']);
      git(['-C', registryDir, 'add', '-A']);
      git(['-C', registryDir, 'commit', '-m', `bundle: ${name} (${repo})`]);
      git(['-C', registryDir, 'push']);
      success(`Bundle "${id}" pushed to registry`);
    } else {
      const tmp = path.join(os.tmpdir(), `pg-bundle-${id}.json`);
      fs.writeFileSync(tmp, json);
      const { publishBundle } = await import('./marketplace.js');
      const result = await publishBundle(tmp);
      fs.unlinkSync(tmp);
      if (result?.error) { error(result.error); process.exit(1); }
      if (result.gh_not_installed) {
        console.log('\n' + result.instructions);
        console.log(chalk.gray('\nBundle JSON:\n') + chalk.white(json));
      } else {
        success(`Bundle proposed! Submit: ${result.submit_url}`);
      }
    }
    process.exit(0);
  }
  error('Usage: pg bundle install <id>  |  pg bundle add-repo <owner/repo> [--push]');
  process.exit(1);
}

if (args[0] === 'import') {
  const { importFromGitHub } = await import('./github-import.js');
  await importFromGitHub(args[1]);
  process.exit(0);
}

if (args[0] === 'setup') {
  const { detectPlatforms, PLATFORMS } = await import('./platform.js');
  const platformId = args[1];
  if (!platformId) {
    section('Detected platforms');
    detectPlatforms().forEach(p => info(`${chalk.white(p.id.padEnd(16))} ${chalk.gray(p.name)}`));
    console.log(chalk.gray('\n  Usage: promptgraph-mcp setup <platform-id>\n'));
  } else {
    const platform = PLATFORMS[platformId];
    if (!platform) { error(`Unknown platform: ${platformId}`); process.exit(1); }
    platform.addMcp(platform);
    success(`Registered in ${chalk.white(platform.name)}`);
    info(chalk.gray(platform.configPath));
  }
  process.exit(0);
}

if (args[0] === 'init') {
  const { promptConfig } = await import('./config.js');
  const { indexAll } = await import('./indexer.js');
  const os = await import('os');
  const fs = await import('fs');
  const path = await import('path');
  const commandsDir = path.default.join(os.default.homedir(), '.claude', 'commands');
  if (!fs.default.existsSync(commandsDir)) {
    console.log(chalk.yellow('⚠') + '  ' + chalk.gray('~/.claude/commands/ not found — is Claude Code installed?'));
    console.log(chalk.gray('   Install from: https://claude.ai/download\n'));
  }
  if (!args.includes('--yes') && !args.includes('-y')) {
    const readline = await import('readline');
    const rl = readline.default.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(r => rl.question(
      chalk.yellow('  ⚠') + chalk.gray('  First run downloads ~23 MB embedding model (BGE-Small-EN).\n  Proceed? [Y/n] '), r
    ));
    rl.close();
    if (answer.trim().toLowerCase() === 'n') { info('Aborted.'); process.exit(0); }
  }
  console.log(chalk.gray('\n  Downloading embedding model (~23 MB, one-time)...\n'));
  const config = await promptConfig();
  await indexAll();
  console.log();
  console.log(
    boxen(
      chalk.white.bold('Add to Claude Code settings.json:') + '\n\n' +
      chalk.gray(JSON.stringify({ mcpServers: { promptgraph: { command: 'npx', args: ['promptgraph-mcp'] } } }, null, 2)),
      { padding: 1, borderStyle: 'round', borderColor: '#7C3AED', dimBorder: true }
    )
  );
  process.exit(0);
}

if (args[0] === 'update') {
  const { spawnSync } = await import('child_process');
  const { createRequire } = await import('module');
  const https = (await import('https')).default;
  const req = createRequire(import.meta.url);
  const currentVersion = req('./package.json').version;

  // Check latest version via registry API (works behind proxies/VPN, no npm spawn needed)
  const spin = (await import('./cli.js')).spinner('Checking latest version...');
  spin.start();
  let latest = null;
  try {
    latest = await new Promise((res, rej) => {
      const r = https.get('https://registry.npmjs.org/promptgraph-mcp/latest',
        { headers: { Accept: 'application/json' }, timeout: 8000 },
        (resp) => {
          let d = ''; resp.setEncoding('utf8');
          resp.on('data', c => d += c);
          resp.on('end', () => { try { res(JSON.parse(d).version); } catch { rej(new Error('bad response')); } });
        }
      );
      r.on('error', rej);
      r.on('timeout', () => { r.destroy(new Error('timeout')); });
    });
  } catch {}
  spin.stop();

  if (!latest) { error('Could not reach npm registry. Check your network.'); process.exit(1); }
  if (latest === currentVersion) {
    success(`Already on latest version ${chalk.white.bold('v' + currentVersion)}`);
    process.exit(0);
  }

  info(`Current: ${chalk.gray('v' + currentVersion)}  →  Latest: ${chalk.white.bold('v' + latest)}`);
  const updateSpin = (await import('./cli.js')).spinner(`Installing promptgraph-mcp@latest (v${latest})...`);
  updateSpin.start();
  const result = spawnSync('npm', ['install', '-g', 'promptgraph-mcp@latest'], { encoding: 'utf8', stdio: 'pipe', shell: true });
  updateSpin.stop();

  if (result.status !== 0) {
    error('Update failed:');
    console.log(chalk.gray(result.stderr || result.stdout));
    process.exit(1);
  }
  success(`Updated to ${chalk.white.bold('v' + latest)}`);
  process.exit(0);
}

if (args[0] === 'reindex') {
  const { indexAll } = await import('./indexer.js');
  const fast = args.includes('--fast');
  if (fast) info(chalk.yellow('Fast mode — skipping embeddings (keyword search only)'));
  await indexAll({ fast });
  process.exit(0);
}

// ── MCP server mode (no CLI command) ──
const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
const { search, getContext, getCallers, getCallees, getImpact, listAll } = await import('./search.js');
const { loadConfig: _loadConfig, saveConfig: _saveConfig } = await import('./config.js');
const { startWatcher } = await import('./watcher.js');
const { browseMarketplace, installSkill, installSkillFromUrl, publishSkill, publishBundle, getTopRated, recordUse, recordSuccess, recordFail, browseBundles, installBundle } = await import('./marketplace.js');

const server = new Server(
  { name: 'promptgraph', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'pg_search',
      description: 'Search skills by task description. Returns top relevant skills with scores.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Task or topic to search for' },
          top_k: { type: 'number', description: 'Number of results (default 5)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'pg_list',
      description: 'List all indexed skills.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'pg_context',
      description: 'Get full context for a skill: description, content, callers, callees.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
    {
      name: 'pg_callers',
      description: 'Get skills that call/reference this skill.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
    {
      name: 'pg_callees',
      description: 'Get skills that this skill calls/references.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
    {
      name: 'pg_impact',
      description: 'Get all skills that would be affected if this skill changes.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
    {
      name: 'pg_rate',
      description: 'Record skill usage outcome. Call after applying a skill: outcome="success" if it helped, "fail" if it did not.',
      inputSchema: {
        type: 'object',
        properties: {
          skill_id: { type: 'string' },
          outcome: { type: 'string', enum: ['use', 'success', 'fail'] },
        },
        required: ['skill_id', 'outcome'],
      },
    },
    {
      name: 'pg_top_rated',
      description: 'Get top rated skills by success rate.',
      inputSchema: {
        type: 'object',
        properties: { top_k: { type: 'number' } },
      },
    },
    {
      name: 'pg_marketplace_browse',
      description: 'Browse top skills from the PromptGraph marketplace.',
      inputSchema: {
        type: 'object',
        properties: { top_k: { type: 'number' } },
      },
    },
    {
      name: 'pg_marketplace_install',
      description: 'Install a skill from the marketplace by ID.',
      inputSchema: {
        type: 'object',
        properties: { skill_id: { type: 'string' } },
        required: ['skill_id'],
      },
    },
    {
      name: 'pg_marketplace_publish',
      description: 'Publish a local skill file to the marketplace via GitHub Gist.',
      inputSchema: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
    },
    {
      name: 'pg_bundle_browse',
      description: 'Browse curated bundles (sets of related skills) from the marketplace.',
      inputSchema: { type: 'object', properties: { top_k: { type: 'number' } } },
    },
    {
      name: 'pg_bundle_install',
      description: 'Install all skills in a bundle by bundle id.',
      inputSchema: {
        type: 'object',
        properties: { bundle_id: { type: 'string' } },
        required: ['bundle_id'],
      },
    },
    {
      name: 'pg_config',
      description: 'Get or update PromptGraph config. action="get" returns current sources. action="add_source" adds a directory.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['get', 'add_source', 'remove_source'] },
          dir: { type: 'string', description: 'Directory path (for add_source)' },
          source: { type: 'string', description: 'Source label (for add_source/remove_source)' },
        },
        required: ['action'],
      },
    },
    {
      name: 'pg_install_url',
      description: 'Install a skill directly from a GitHub URL or raw URL. Validates before saving.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'GitHub blob URL or raw URL of a .md skill file' } },
        required: ['url'],
      },
    },
    {
      name: 'pg_bundle_publish',
      description: 'Publish a bundle definition to GitHub Gist and get a registry submission link. Pass a JSON object or path to a .json file.',
      inputSchema: {
        type: 'object',
        properties: {
          bundle: {
            description: 'Bundle definition object { id, name, description, skills[], tags[] } OR file path to .json',
            oneOf: [
              { type: 'object' },
              { type: 'string' },
            ],
          },
        },
        required: ['bundle'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    switch (name) {
      case 'pg_search': result = await search(args.query, args.top_k || 5); break;
      case 'pg_list': result = listAll(); break;
      case 'pg_context': result = getContext(args.name); break;
      case 'pg_callers': result = getCallers(args.name); break;
      case 'pg_callees': result = getCallees(args.name); break;
      case 'pg_impact': result = getImpact(args.name); break;
      case 'pg_rate':
        if (args.outcome === 'use') recordUse(args.skill_id);
        else if (args.outcome === 'success') recordSuccess(args.skill_id);
        else if (args.outcome === 'fail') recordFail(args.skill_id);
        result = { ok: true };
        break;
      case 'pg_top_rated': result = getTopRated(args.top_k || 10); break;
      case 'pg_marketplace_browse': result = await browseMarketplace(args.top_k || 20); break;
      case 'pg_marketplace_install': result = await installSkill(args.skill_id); break;
      case 'pg_marketplace_publish': result = await publishSkill(args.file_path); break;
      case 'pg_bundle_browse': result = await browseBundles(args.top_k || 20); break;
      case 'pg_bundle_install': result = await installBundle(args.bundle_id); break;
      case 'pg_install_url': result = await installSkillFromUrl(args.url); break;
      case 'pg_bundle_publish': result = await publishBundle(args.bundle); break;
      case 'pg_config': {
        const cfg = _loadConfig();
        if (args.action === 'get') {
          result = { sources: cfg.sources };
        } else if (args.action === 'add_source') {
          if (!args.dir || !args.source) throw new Error('dir and source required for add_source');
          if (cfg.sources.find(s => s.source === args.source)) throw new Error(`Source "${args.source}" already exists`);
          cfg.sources.push({ dir: args.dir, source: args.source });
          _saveConfig(cfg);
          result = { ok: true, sources: cfg.sources };
        } else if (args.action === 'remove_source') {
          if (!args.source) throw new Error('source required for remove_source');
          const before = cfg.sources.length;
          cfg.sources = cfg.sources.filter(s => s.source !== args.source);
          if (cfg.sources.length === before) throw new Error(`Source "${args.source}" not found`);
          _saveConfig(cfg);
          result = { ok: true, sources: cfg.sources };
        } else {
          throw new Error(`Unknown action: ${args.action}`);
        }
        break;
      }
      default: throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
});

startWatcher();

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[PromptGraph] MCP server running');

const { getDb: _getDb } = await import('./db.js');
const shutdown = () => {
  try { _getDb().close(); } catch {}
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
