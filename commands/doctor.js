import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';

export default async function handler(args, bin) {
  const { runDoctor } = await import('../doctor.js');
  const spin = (await import('../cli.js')).spinner('Checking database...');
  spin.start();
  const r = runDoctor();
  spin.stop();
  success('Database checked');
  info(`Removed: ${r.orphanChunks} chunks, ${r.orphanRatings} ratings, ${r.orphanFromEdges + r.danglingEdges} edges`);
  if (r.duplicatePaths > 0) info(chalk.yellow(`Warning: ${r.duplicatePaths} duplicate paths`));
  info(chalk.gray(`Now: ${r.totalSkills} skills, ${r.totalChunks} chunks, ${r.totalEdges} edges`));
  process.exit(0);
}
