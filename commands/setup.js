import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';

export default async function handler(args, bin) {
  const { detectPlatforms, PLATFORMS } = await import('../platform.js');
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
