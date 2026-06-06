import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';

export default async function handler(args, bin) {
  const { indexAll } = await import('../indexer.js');
  const fast = args.includes('--fast');
  if (fast) info(chalk.yellow('Fast mode — skipping embeddings (keyword search only)'));
  await indexAll({ fast });
  process.exit(0);
}
