import { success, error, info } from '../cli.js';
import chalk from 'chalk';

// pg duplicates [--threshold 0.92] [--json]  — flag near-duplicate / overlapping skills.
export default async function handler(args, bin) {
  const ti = args.indexOf('--threshold');
  const threshold = ti !== -1 && args[ti + 1] ? parseFloat(args[ti + 1]) : 0.70;
  const asJson = args.includes('--json');

  const spin = (await import('../cli.js')).spinner('Comparing skill embeddings...');
  spin.start();
  let pairs;
  try {
    const { findDuplicates } = await import('../duplicates.js');
    pairs = await findDuplicates({ threshold });
  } catch (e) {
    spin.stop();
    error(`Duplicate scan failed: ${e.message}`);
    process.exit(1);
  }
  spin.stop();

  if (asJson) { console.log(JSON.stringify(pairs, null, 2)); process.exit(0); }

  if (!pairs.length) {
    success(`No near-duplicate skills found above similarity ${threshold}.`);
    process.exit(0);
  }

  console.log('\n' + chalk.bold(`${pairs.length} near-duplicate pair${pairs.length === 1 ? '' : 's'}`) +
    chalk.gray(`  (cosine ≥ ${threshold})\n`));
  for (const p of pairs) {
    const simColor = p.sim >= 0.73 ? chalk.red : p.sim >= 0.71 ? chalk.yellow : chalk.gray;
    const cross = p.sameSource ? '' : chalk.gray('  (different sources)');
    console.log(`  ${simColor(p.sim.toFixed(3))}  ${chalk.cyan(p.aName)} ${chalk.gray('≈')} ${chalk.cyan(p.bName)}${cross}`);
    console.log(`         ${chalk.gray(p.a)}`);
    console.log(`         ${chalk.gray(p.b)}`);
  }
  console.log(chalk.gray('\n  Review pairs ≥ 0.73 first — likely true duplicates worth merging or removing.\n'));
  process.exit(0);
}
