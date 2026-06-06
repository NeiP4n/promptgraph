import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';
import boxen from 'boxen';

export default async function handler(args, bin) {
  const { promptConfig } = await import('../config.js');
  const { indexAll } = await import('../indexer.js');
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
