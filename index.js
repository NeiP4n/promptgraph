#!/usr/bin/env node
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');
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

const KNOWN_COMMANDS = new Set(['reindex', 'update', 'import', 'install', 'setup', 'validate', 'marketplace', 'doctor', 'search', 'help', '--help', '-h', '--version', '-v', 'version', 'bundle', 'status', 'train', 'add-dir']);

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
    ['reindex',             'Re-index all skills'],
    ['search <query>',      'Search skills from the terminal'],
    ['import <owner/repo>', 'Import skills from GitHub'],
    ['add-dir <path>',      'Index skills from a local folder (any platform)'],
    ['status',              'Show installed skills, repos, and bundles'],
    ['install <name>',      'Install a bundle by name, code, or id'],
    ['marketplace',         'Interactive TUI: browse + search + install skills & bundles'],
    ['bundle update [id]',  'Update all (or one) installed GitHub bundles'],
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

// Version flag
if (args[0] === '--version' || args[0] === '-v' || args[0] === 'version') {
  const { createRequire } = await import('module');
  const _pkg = createRequire(import.meta.url)('./package.json');
  console.log(_pkg.version);
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

const COMMAND_MAP = {
  doctor:    './commands/doctor.js',
  status:    './commands/status.js',
  marketplace: './commands/marketplace.js',
  validate:  './commands/validate.js',
  train:     './commands/train.js',
  search:    './commands/search.js',
  bundle:    './commands/bundle.js',
  import:    './commands/import.js',
  install:   './commands/install.js',
  setup:     './commands/setup.js',
  update:    './commands/update.js',
  reindex:   './commands/reindex.js',
  'add-dir': './commands/add-dir.js',
}

if (COMMAND_MAP[args[0]]) {
  const mod = await import(COMMAND_MAP[args[0]])
  await mod.default(args, bin)
  // handler calls process.exit() internally
}

// ── MCP server mode (no CLI command) ──
const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
const { search, getContext, getCallers, getCallees, getImpact, listAll } = await import('./search.js');
const { loadConfig: _loadConfig, saveConfig: _saveConfig } = await import('./config.js');
const { startWatcher } = await import('./watcher.js');
const { browseMarketplace, installSkill, installSkillFromUrl, publishSkill, publishBundle, getTopRated, recordUse, recordSuccess, recordFail, browseBundles, installBundle } = await import('./marketplace.js');

const { createRequire } = await import('module');
const pkg = createRequire(import.meta.url)('./package.json');
const server = new Server(
  { name: 'promptgraph', version: pkg.version },
  { capabilities: { tools: {}, prompts: {} } }
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
      description: 'Publish a local skill file to the marketplace. Requires an authenticated GitHub CLI (gh auth login); creates a Gist and auto-submits the registry issue — no manual step.',
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
      description: 'Publish a bundle definition to the marketplace. Requires an authenticated GitHub CLI (gh auth login); auto-submits the registry issue with the bundle JSON — no manual step. Pass a JSON object or path to a .json file.',
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
      case 'pg_bundle_install': {
        result = await installBundle(args.bundle_id);
        if (result.toolsInstalled?.length) {
          result.message = `Installed ${result.installed?.length || 0} skills + ${result.toolsInstalled.length} tool files`;
        }
        break;
      }
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

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'pg',
      description: 'Find and load the best skill for your task. Returns the full skill instructions ready to use.',
      arguments: [{ name: 'query', description: 'Describe what you want to do (e.g. "deploy to kubernetes", "sql injection hunt")', required: true }],
    },
    {
      name: 'pg-list',
      description: 'List all indexed skills with descriptions',
      arguments: [],
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fsSync = (await import('fs')).default;
  // Ensure DB/model is ready (first call may come before watcher finishes init)
  await new Promise(r => setTimeout(r, 50));

  if (name === 'pg') {
    const query = args?.query || '';
    const results = await search(query, 3);

    if (!results.length) {
      return { messages: [{ role: 'user', content: { type: 'text', text: `No skills found for: "${query}"\n\nTry \`/pg-list\` to see all available skills.` } }] };
    }

    const top = results[0];
    const score = top.score ?? 0;

    // High confidence (≥0.70) — load full skill content
    if (score >= 0.70) {
      let content = '';
      try { content = fsSync.readFileSync(top.path, 'utf8'); } catch {}
      const otherMatches = results.slice(1).map(r => `- **${r.name}** (${r.score?.toFixed(2)})`).join('\n');
      const otherMatchesNote = otherMatches ? `\n\n_Other matches: ${otherMatches}_` : '';
      return {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: `Load skill: ${top.name}` },
          },
          {
            role: 'assistant',
            content: { type: 'text', text: `I've loaded the **${top.name}** skill (score: ${score.toFixed(2)}). Here are the instructions I'll follow:\n\n---\n\n${content}${otherMatchesNote}\n\n---\n\nSkill loaded. What would you like me to do?` },
          },
        ],
      };
    }

    // Low confidence — show top matches, let user pick
    const list = results.map(r => `- **${r.name}** (score: ${r.score?.toFixed(2)}) — ${r.description || ''}\n  \`/pg ${r.name}\``).join('\n\n');
    return {
      messages: [{ role: 'user', content: { type: 'text', text: `Found ${results.length} possible matches for "${query}":\n\n${list}\n\nRun \`/pg <skill-name>\` to load a specific skill.` } }],
    };
  }

  if (name === 'pg-list') {
    const skills = await listAll();
    const text = skills.length
      ? `## Available skills (${skills.length})\n\n` + skills.map(s => `- **${s.name}**${s.description ? ' — ' + s.description : ''}`).join('\n')
      : 'No skills indexed. Run `pg reindex` to index your skills.';
    return { messages: [{ role: 'user', content: { type: 'text', text: text } }] };
  }

  throw new Error(`Unknown prompt: ${name}`);
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
