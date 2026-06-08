import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';

export default async function handler(args, bin) {
  const fs = (await import('fs')).default;
  const { PROMPTGRAPH_DIR } = await import('../config.js');
  const path = (await import('path')).default;

  // --reset-dead clears the dead repos list so they reappear in marketplace
  if (args.includes('--reset-dead')) {
    const deadFile = path.join(PROMPTGRAPH_DIR, 'dead-repos.json');
    try { fs.writeFileSync(deadFile, '[]'); } catch {}
    success('Dead repos list cleared — all bundles visible in marketplace again');
    process.exit(0);
  }

  const { runDoctor } = await import('../doctor.js');
  const spin = (await import('../cli.js')).spinner('Checking database...');
  spin.start();
  const r = runDoctor();
  spin.stop();
  success('Database checked');
  info(`Removed: ${r.orphanChunks} chunks, ${r.orphanRatings} ratings, ${r.orphanFromEdges + r.danglingEdges} edges`);
  if (r.duplicatePaths > 0) info(chalk.yellow(`Warning: ${r.duplicatePaths} duplicate paths`));
  info(chalk.gray(`Now: ${r.totalSkills} skills, ${r.totalChunks} chunks, ${r.totalEdges} edges`));
  info(chalk.gray(`  Run \`${bin} doctor --reset-dead\` to restore hidden marketplace bundles`));
  process.exit(0);
}
