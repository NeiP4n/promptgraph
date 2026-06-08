import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';
import boxen from 'boxen';

const PLATFORM_CONFIGS = {
  'claude-code': {
    label: 'Claude Code — ~/.claude/settings.json',
    snippet: { mcpServers: { promptgraph: { command: 'npx', args: ['promptgraph-mcp'] } } },
  },
  'claude-desktop': {
    label: 'Claude Desktop — claude_desktop_config.json',
    snippet: { mcpServers: { promptgraph: { command: 'npx', args: ['promptgraph-mcp'] } } },
  },
  'opencode': {
    label: 'OpenCode — opencode.json',
    snippet: { mcp: { promptgraph: { type: 'local', command: ['npx', 'promptgraph-mcp'], enabled: true } } },
  },
  'cursor': {
    label: 'Cursor — ~/.cursor/mcp.json',
    snippet: { mcpServers: { promptgraph: { command: 'npx', args: ['promptgraph-mcp'] } } },
  },
  'windsurf': {
    label: 'Windsurf — mcp_config.json',
    snippet: { mcpServers: { promptgraph: { command: 'npx', args: ['promptgraph-mcp'] } } },
  },
  'cline': {
    label: 'Cline — ~/.vscode/mcp.json',
    snippet: { servers: { promptgraph: { command: 'npx', args: ['promptgraph-mcp'] } } },
  },
  'codex': {
    label: 'OpenAI Codex CLI — ~/.codex/config.json',
    snippet: { mcpServers: { promptgraph: { command: 'npx', args: ['promptgraph-mcp'] } } },
  },
};

export default async function handler(args, bin) {
  const { promptConfig } = await import('../config.js');
  const { indexAll } = await import('../indexer.js');
  const { detectPlatforms, PLATFORMS } = await import('../platform.js');

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

  const detected = detectPlatforms().map(p => p.id);
  const toShow = detected.length > 0 ? detected : ['claude-code', 'opencode'];

  for (const id of toShow) {
    const cfg = PLATFORM_CONFIGS[id];
    if (!cfg) continue;
    const platform = PLATFORMS[id];
    if (platform) {
      try { platform.addMcp(platform); } catch {}
    }
    console.log(
      boxen(
        chalk.white.bold(cfg.label) + '\n\n' +
        chalk.gray(JSON.stringify(cfg.snippet, null, 2)),
        { padding: 1, borderStyle: 'round', borderColor: '#7C3AED', dimBorder: true }
      )
    );
  }

  if (detected.length > 0) {
    console.log(chalk.green('  ✓') + chalk.gray(' Config written automatically to detected platforms.'));
    console.log(chalk.gray('  Restart your editor/client to activate.\n'));
  } else {
    console.log(chalk.gray('  Copy the snippet above into your editor config, then restart.\n'));
    console.log(chalk.gray('  Or run: ') + chalk.white('pg setup <platform>') + chalk.gray('  (claude-code, opencode, cursor, windsurf, cline, codex)\n'));
  }

  process.exit(0);
}
