import chalk from 'chalk';
import boxen from 'boxen';
import { success, error, info } from '../cli.js';

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
    snippet: { plugin: ['promptgraph-mcp/plugin'] },
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
    const { createInterface } = await import('readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(r => rl.question(
      chalk.yellow('  ⚠') + chalk.gray('  First run downloads ~23 MB embedding model (BGE-Small-EN).\n  Proceed? [Y/n] '), r
    ));
    rl.close();
    if (answer.trim().toLowerCase() === 'n') { info('Aborted.'); process.exit(0); }
  }

  console.log(chalk.gray('\n  Downloading embedding model (~23 MB, one-time)...\n'));
  await promptConfig();
  await indexAll();
  console.log();

  const detected = detectPlatforms();
  const detectedIds = new Set(detected.map(p => p.id));

  const written = [];
  const writeErrors = [];
  for (const p of detected) {
    try {
      p.addMcp(p);
      written.push(p.name || p.id);
    } catch (e) {
      writeErrors.push(`${p.id}: ${e.message}`);
    }
  }

  const toShow = detectedIds.size > 0
    ? [...detectedIds]
    : ['claude-code', 'opencode'];

  for (const id of toShow) {
    const cfg = PLATFORM_CONFIGS[id];
    if (!cfg) continue;
    console.log(
      boxen(
        chalk.white.bold(cfg.label) + '\n\n' +
        chalk.gray(JSON.stringify(cfg.snippet, null, 2)),
        { padding: 1, borderStyle: 'round', borderColor: '#7C3AED', dimBorder: true }
      )
    );
  }

  if (written.length > 0) {
    console.log(chalk.green('  ✓') + chalk.gray(` Config written automatically to: ${written.join(', ')}`));
    console.log(chalk.gray('  Restart your editor/client to activate.\n'));
  } else {
    console.log(chalk.gray('  Copy the snippet above into your editor config, then restart.\n'));
    console.log(chalk.gray(`  Or run: `) + chalk.white(`${bin} setup <platform>`) + chalk.gray('  (claude-code, opencode, cursor, windsurf, cline, codex)\n'));
  }

  if (writeErrors.length > 0) {
    for (const e of writeErrors) console.log(chalk.red('  ✗') + chalk.gray(' ' + e));
  }

  process.exit(0);
}
