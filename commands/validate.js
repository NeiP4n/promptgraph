import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';
import fs from 'fs';

export default async function handler(args, bin) {
  const { validateSkill } = await import('../validator.js');
  const file = args[1];
  if (!file) { error('Usage: ' + bin + ' validate <skill.md>'); process.exit(1); }

  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;

  if (raw) {
    const { filterWithClassifier, isSkillFile: _isSkill } = await import('../parser.js');
    const { hardFilter } = await import('../src/filter/hard-filter.js');
    const { loadModel } = await import('../src/filter/train.js');
    const { embed } = await import('../embedder.js');
    const { classify } = await import('../src/filter/classifier.js');

    const hfResult = hardFilter(file, raw);
    const willIndex = _isSkill(file, raw);
    const scoreLabel = willIndex ? chalk.green('✓ will be indexed') : chalk.red('✗ will be skipped by indexer');
    console.log(chalk.bold('\n  Indexing check: ') + scoreLabel);

    const signals = [];
    if (!hfResult.pass) {
      signals.push(chalk.red(`✗ hard filter: ${hfResult.reason}`));
    } else {
      signals.push(chalk.green('✓ hard filter passed'));
    }

    const centroids = loadModel();
    if (centroids) {
      try {
        const vec = await embed(raw);
        const decision = classify(vec, centroids, raw, file);
        const pct = (decision.score * 100).toFixed(0);
        if (decision.label === 'skill') signals.push(chalk.green(`✓ classifier: skill (${pct}%)`));
        else if (decision.label === 'unsure') signals.push(chalk.yellow(`? classifier: unsure (${pct}%)`));
        else signals.push(chalk.red(`✗ classifier: reject (${pct}%)`));
      } catch {
        signals.push(chalk.gray('  classifier: embed failed (skip)'));
      }
    } else {
      signals.push(chalk.gray('  classifier: no model (run `pg train`)'));
    }

    if (signals.length) {
      signals.forEach(s => console.log('    ' + s));
    }
    console.log();
  }

  const result = validateSkill(file);
  result.warnings.forEach(w => console.log(chalk.yellow('⚠') + '  ' + chalk.gray(w)));
  if (result.ok) {
    success('Skill is valid — ready to publish');
    process.exit(0);
  } else {
    error('Validation failed:');
    result.errors.forEach(e => console.log('   ' + chalk.red('•') + ' ' + e));
    process.exit(1);
  }
}
