import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';

export default async function handler(args, bin) {
  const { train: trainModel } = await import('../src/filter/train.js');
  const spin = (await import('../cli.js')).spinner('Training classifier...');
  spin.start();
  try {
    const model = await trainModel();
    spin.stop();
    success(`Classifier trained (${model.counts.good} good, ${model.counts.bad} bad examples)`);
  } catch (e) {
    spin.stop();
    error(`Training failed: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}
