#!/usr/bin/env node
// Only lightweight imports at top. Heavy modules (fastembed/ONNX, vectra,
// better-sqlite3) are dynamically imported inside the command that needs them,
// so fast CLI commands (help, marketplace) start instantly.
import { colors, banner, success, error, info, section, table } from './cli.js';
import boxen from 'boxen';
import chalk from 'chalk';

const args = process.argv.slice(2);
// argv[1] is the resolved index.js path (esp. on Windows global installs),
// so derive a friendly name instead of showing "index".
const rawBin = process.argv[1]?.split(/[\\/]/).pop()?.replace(/\.js$/, '');
const bin = (rawBin && rawBin !== 'index') ? rawBin : 'pg';

const KNOWN_COMMANDS = new Set(['init', 'reindex', 'update', 'import', 'setup', 'validate', 'marketplace', 'doctor', 'search', 'help', '--help', '-h']);

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
    ['marketplace [page]',  'Browse the community skill registry'],
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

  const wrapB = (t, w, ind) => {
    const words = (t || '').split(/\s+/); const lines = []; let line = '';
    for (const x of words) { if ((line + ' ' + x).trim().length > w) { lines.push(line.trim()); line = x; } else line += ' ' + x; }
    if (line.trim()) lines.push(line.trim());
    return lines.map(l => ind + chalk.gray(l)).join('\n');
  };

  bundles.forEach((b, i) => {
    const stars = b.stars > 0 ? chalk.yellow('★ ' + b.stars) : chalk.gray('★ 0');
    const count = b.repo_url ? (b.skillCount || '?') : (b.skills?.length || 0);
    console.log('  ' + chalk.gray((i + 1) + '.') + ' ' + chalk.white.bold(b.id) + '   ' + stars + chalk.gray('   ' + count + ' skills'));
    console.log(wrapB(b.description, 64, '     '));
    console.log('     ' + chalk.gray('includes: ') + (b.repo_url ? chalk.blue(b.repo_url) : chalk.gray((b.skills || []).join(', '))));
    if (b.tags?.length) console.log('     ' + purple(b.tags.map(t => '#' + t).join(' ')));
    console.log('     ' + chalk.gray('install:  ') + chalk.cyan(`pg_bundle_install("${b.id}")`));
    console.log();
  });

  console.log(
    boxen(
      chalk.dim('install bundle ') + chalk.white('install bundle ') + chalk.hex('#A78BFA')('engineering-essentials') + '\n' +
      chalk.dim('browse skills  ') + chalk.cyan(`${bin} marketplace`) + '\n' +
      chalk.dim('publish bundle ') + chalk.white('/pg-publish ') + chalk.hex('#A78BFA')('<bundle.json>'),
      { padding: { top: 0, bottom: 0, left: 1, right: 1 }, borderStyle: 'round', borderColor: '#4B5563', dimBorder: true }
    )
  );
  console.log();
  process.exit(0);
}

if (args[0] === 'marketplace') {
  const { browseMarketplace } = await import('./marketplace.js');
  const PER_PAGE = 10;
  const page = Math.max(1, parseInt(args[1]) || 1);

  const { clearScreen } = await import('./cli.js');
  const spin = (await import('./cli.js')).spinner('Fetching registry...');
  spin.start();
  const all = await browseMarketplace(1000);
  spin.stop();
  clearScreen();

  if (all?.error) {
    error(all.error);
    process.exit(1);
  }
  if (!all.length) {
    info('Registry is empty. Be the first to contribute!');
    console.log(chalk.gray('  github.com/NeiP4n/promptgraph-registry\n'));
    process.exit(0);
  }

  const totalPages = Math.ceil(all.length / PER_PAGE);
  const startIdx = (page - 1) * PER_PAGE;
  const slice = all.slice(startIdx, startIdx + PER_PAGE);
  const purple = chalk.hex('#7C3AED');
  const W = 60;

  const wrap = (text, width, indent) => {
    const words = (text || '').split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > width) { lines.push(line.trim()); line = w; }
      else line += ' ' + w;
    }
    if (line.trim()) lines.push(line.trim());
    return lines.map(l => indent + chalk.dim(l)).join('\n');
  };

  // header
  console.log();
  console.log('  ' + purple.bold('◆ PromptGraph') + chalk.dim('  ·  marketplace'));
  console.log('  ' + chalk.dim(`${all.length} skills`) + chalk.dim(totalPages > 1 ? `   ·   page ${page}/${totalPages}` : ''));
  console.log(chalk.dim('  ' + '━'.repeat(W)));

  slice.forEach((s, i) => {
    const n = chalk.dim(String(startIdx + i + 1).padStart(2));
    const code = s.code ? chalk.hex('#A78BFA')(s.code) : '';
    const stars = chalk.yellow('★') + chalk.dim(' ' + (s.stars || 0));
    console.log();
    // line 1: number, name ........ code, stars
    const left = `${n}  ${chalk.bold.white(s.id)}`;
    console.log('  ' + left + '  ' + code + '   ' + stars);
    // description
    console.log(wrap(s.description, W - 6, '      '));
    // tags
    if (s.tags?.length) console.log('      ' + chalk.dim(s.tags.map(t => '#' + t).join(' ')));
  });

  console.log();
  console.log(chalk.dim('  ' + '━'.repeat(W)));

  if (totalPages > 1) {
    const nav = [];
    if (page > 1) nav.push(chalk.dim('‹ ') + chalk.cyan(`${bin} marketplace ${page - 1}`));
    if (page < totalPages) nav.push(chalk.cyan(`${bin} marketplace ${page + 1}`) + chalk.dim(' ›'));
    console.log('  ' + nav.join('     '));
    console.log();
  }

  const exCode = slice[0]?.code || slice[0]?.id || 'pg-xxxxxx';
  console.log(
    boxen(
      chalk.dim('install skill  ') + chalk.white('install ') + chalk.hex('#A78BFA')(exCode) + '\n' +
      chalk.dim('install bundle ') + chalk.white('install bundle ') + chalk.hex('#A78BFA')('engineering-essentials') + '\n' +
      chalk.dim('from GitHub    ') + chalk.white('install ') + chalk.hex('#A78BFA')('https://github.com/owner/repo/blob/main/skill.md') + '\n' +
      chalk.dim('publish skill  ') + chalk.white('/pg-publish ') + chalk.hex('#A78BFA')('<file.md>') + '\n' +
      chalk.dim('publish bundle ') + chalk.white('/pg-publish ') + chalk.hex('#A78BFA')('<bundle.json>') + '\n' +
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
  const req = createRequire(import.meta.url);
  const currentVersion = req('./package.json').version;

  // Check latest version on npm
  const spin = (await import('./cli.js')).spinner('Checking latest version...');
  spin.start();
  let latest = null;
  try {
    const r = spawnSync('npm', ['view', 'promptgraph-mcp', 'version'], { encoding: 'utf8' });
    latest = r.stdout?.trim();
  } catch {}
  spin.stop();

  if (!latest) { error('Could not reach npm registry. Check your network.'); process.exit(1); }
  if (latest === currentVersion) {
    success(`Already on latest version ${chalk.white.bold('v' + currentVersion)}`);
    process.exit(0);
  }

  info(`Current: ${chalk.gray('v' + currentVersion)}  →  Latest: ${chalk.white.bold('v' + latest)}`);
  const updateSpin = (await import('./cli.js')).spinner(`Installing promptgraph-mcp@${latest}...`);
  updateSpin.start();
  const result = spawnSync('npm', ['install', '-g', `promptgraph-mcp@${latest}`], { encoding: 'utf8', stdio: 'pipe' });
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
  await indexAll();
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
