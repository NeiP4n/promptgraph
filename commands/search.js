import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';
import { VALID_TRUST_LEVELS, TRUST_LEVEL_BOOST } from '../marketplace.js';

export default async function handler(args, bin) {
  const trustFilter = args.find(a => a.startsWith('--trust='));
  const filteredArgs = args.filter(a => !a.startsWith('--trust='));
  const query = filteredArgs.slice(1).join(' ');
  if (!query) { error('Usage: ' + bin + ' search <query> [--trust=verified]'); process.exit(1); }

  if (trustFilter) {
    const level = trustFilter.split('=')[1];
    if (!VALID_TRUST_LEVELS.includes(level)) {
      error('Invalid trust level. Valid: ' + VALID_TRUST_LEVELS.join(', '));
      process.exit(1);
    }
  }

  const { search: searchSkills } = await import('../search.js');
  const { getDb } = await import('../db.js');
  const { getByTrustLevel } = await import('../marketplace.js');
  const spin = (await import('../cli.js')).spinner('Searching...');
  spin.start();
  let results = await searchSkills(query, 10);
  spin.stop();

  // Apply trust filter after search
  if (trustFilter) {
    const level = trustFilter.split('=')[1];
    const entries = await getByTrustLevel(level);
    const allowed = new Set(entries.map(e => e.id));
    results = results.filter(r => allowed.has(r.id));
  }

  // Enrich results with trust level
  const db = getDb();
  const enriched = results.map(s => {
    const re = db.prepare('SELECT trust_level FROM registry_entries WHERE id = ?').get(s.id);
    return { ...s, trustLevel: re ? re.trust_level : 'unknown' };
  });

  if (!enriched.length) { info('No results for: ' + query); process.exit(0); }
  const purple = chalk.hex('#7C3AED');
  console.log();
  enriched.forEach((s, i) => {
    const score = chalk.dim((s.score * 100).toFixed(0) + '%');
    const trustBadge = s.trustLevel !== 'unknown' && s.trustLevel !== 'community'
      ? ' ' + purple(s.trustLevel) : '';
    console.log('  ' + chalk.dim(String(i + 1) + '.') + ' ' + chalk.bold.white(s.name) + trustBadge + '  ' + score);
    console.log('     ' + chalk.dim(s.description || ''));
    console.log('     ' + purple(s.source) + '  ' + chalk.dim(s.path));
    console.log();
  });
  process.exit(0);
}
