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

const args = process.argv.slice(2);

if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
  console.log(`
PromptGraph — semantic skill router for Claude Code

Usage:
  promptgraph-mcp init                  First-time setup + index all skills
  promptgraph-mcp reindex               Re-index all skills
  promptgraph-mcp import <owner/repo>   Import skills from GitHub repo
  promptgraph-mcp setup <platform>      Register MCP in platform config
  promptgraph-mcp                       Start MCP server (used by Claude)
  promptgraph-mcp help                  Show this help

Platforms: claude-code, claude-desktop, cline, codex, cursor, windsurf

GitHub: https://github.com/NeiP4n/promptgraph
npm:    https://npmjs.com/package/promptgraph-mcp
  `);
  process.exit(0);
}

if (args[0] === 'import') {
  await importFromGitHub(args[1]);
  process.exit(0);
}

if (args[0] === 'setup') {
  const platformId = args[1];
  if (!platformId) {
    const detected = detectPlatforms();
    console.log('Detected platforms:');
    detected.forEach(p => console.log(`  - ${p.id}: ${p.name}`));
    console.log('\nUsage: promptgraph-mcp setup <platform-id>');
  } else {
    const platform = PLATFORMS[platformId];
    if (!platform) { console.error(`Unknown platform: ${platformId}`); process.exit(1); }
    platform.addMcp(platform);
    console.log(`✓ Registered promptgraph MCP in ${platform.name} (${platform.configPath})`);
  }
  process.exit(0);
}

if (args[0] === 'init') {
  const config = await promptConfig();
  console.log('\nIndexing skills...');
  await indexAll();
  console.log('\nDone! Add to Claude Code settings.json:');
  console.log(JSON.stringify({
    mcpServers: {
      promptgraph: {
        command: 'npx',
        args: ['promptgraph-mcp'],
      }
    }
  }, null, 2));
  process.exit(0);
}

if (args[0] === 'reindex') {
  console.log('[PromptGraph] Reindexing...');
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
