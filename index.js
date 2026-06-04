#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { search, getContext, getCallers, getCallees, getImpact, listAll } from './search.js';
import { indexAll } from './indexer.js';
import { startWatcher } from './watcher.js';
import { promptConfig } from './config.js';
import { importFromGitHub } from './github-import.js';
import { detectPlatforms, PLATFORMS } from './platform.js';
import { browseMarketplace, installSkill, publishSkill, getTopRated, recordUse, recordSuccess, recordFail } from './marketplace.js';

import { colors, banner, success, error, info, section, table } from './cli.js';
import boxen from 'boxen';
import chalk from 'chalk';

const args = process.argv.slice(2);
// argv[1] is the resolved index.js path (esp. on Windows global installs),
// so derive a friendly name instead of showing "index".
const rawBin = process.argv[1]?.split(/[\\/]/).pop()?.replace(/\.js$/, '');
const bin = (rawBin && rawBin !== 'index') ? rawBin : 'pg';

const KNOWN_COMMANDS = new Set(['init', 'reindex', 'import', 'setup', 'validate', 'marketplace', 'help', '--help', '-h']);

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
    ['import <owner/repo>', 'Import skills from GitHub'],
    ['marketplace [page]',  'Browse the community skill registry'],
    ['validate <file.md>',  'Validate a skill before publishing'],
    ['setup <platform>',    'Register MCP in platform config'],
    ['help',                'Show this help'],
  ];
  for (const [cmd, desc] of cmds) {
    console.log('  ' + chalk.hex('#7C3AED')((bin + ' ' + cmd).padEnd(28)) + chalk.gray(desc));
  }
  console.log(chalk.gray('\nPlatforms: claude-code, claude-desktop, cline, codex, cursor, windsurf'));
  console.log(chalk.gray('\n  github.com/NeiP4n/promptgraph  ·  npmjs.com/package/promptgraph-mcp\n'));
}

if (!args[0] || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
  showHelp();
  process.exit(0);
}

if (!KNOWN_COMMANDS.has(args[0])) {
  console.log(chalk.red('✗') + '  Unknown command: ' + chalk.white(args[0]));
  console.log(chalk.gray('  Run `' + bin + ' help` to see available commands.\n'));
  process.exit(1);
}

if (args[0] === 'marketplace') {
  const { browseMarketplace } = await import('./marketplace.js');
  const PER_PAGE = 10;
  const page = Math.max(1, parseInt(args[1]) || 1);

  const spin = (await import('./cli.js')).spinner('Fetching registry...');
  spin.start();
  const all = await browseMarketplace(1000);
  spin.stop();

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
  const slice = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  console.log(
    boxen(
      chalk.hex('#7C3AED').bold('Marketplace') + '  ' +
      chalk.gray(`page ${page}/${totalPages}  ·  ${all.length} skills`),
      { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: '#7C3AED', dimBorder: true }
    )
  );
  console.log();
  for (const s of slice) {
    const stars = s.stars ? chalk.yellow('★ ' + s.stars) : chalk.gray('★ 0');
    console.log('  ' + chalk.white.bold(s.id) + '  ' + stars);
    console.log('  ' + chalk.gray((s.description || '').slice(0, 80)));
    if (s.tags?.length) console.log('  ' + chalk.hex('#7C3AED')(s.tags.map(t => '#' + t).join(' ')));
    console.log();
  }

  if (totalPages > 1) {
    const nav = [];
    if (page > 1) nav.push(`${bin} marketplace ${page - 1}`);
    if (page < totalPages) nav.push(`${bin} marketplace ${page + 1}`);
    console.log(chalk.gray('  ' + nav.join('   ·   ')));
  }
  console.log(chalk.gray('\n  To install or publish, ask your AI assistant — it uses the pg_marketplace_* tools.\n'));
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

if (args[0] === 'import') {
  await importFromGitHub(args[1]);
  process.exit(0);
}

if (args[0] === 'setup') {
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

if (args[0] === 'reindex') {
  await indexAll();
  process.exit(0);
}

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
