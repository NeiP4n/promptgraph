import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';

export default async function handler(args, bin) {
  const query = args.slice(1).join(' ');
  if (!query) { error('Usage: ' + bin + ' search <query>'); process.exit(1); }
  const { search: searchSkills } = await import('../search.js');
  const spin = (await import('../cli.js')).spinner('Searching...');
  spin.start();
  const results = await searchSkills(query, 10);
  spin.stop();
  if (!results.length) { info('No results for: ' + query); process.exit(0); }
  const purple = chalk.hex('#7C3AED');
  console.log();
  results.forEach((s, i) => {
    const score = chalk.dim((s.score * 100).toFixed(0) + '%');
    console.log('  ' + chalk.dim(String(i + 1) + '.') + ' ' + chalk.bold.white(s.name) + '  ' + score);
    console.log('     ' + chalk.dim(s.description || ''));
    console.log('     ' + purple(s.source) + '  ' + chalk.dim(s.path));
    console.log();
  });
  process.exit(0);
}
