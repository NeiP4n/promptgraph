import { success, error, info } from '../cli.js';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';

// pg add-dir <path> [--source <name>]
// Registers an arbitrary local folder as a skill source and indexes it.
// Fills the gap for users whose skills live outside the default/platform dirs
// (e.g. opencode users with a custom skills folder that reindex never scanned).
export default async function handler(args, bin) {
  const dirArg = args[1];
  if (!dirArg || dirArg.startsWith('-')) {
    error('Usage: pg add-dir <path-to-skills-folder> [--source <name>]');
    process.exit(1);
  }

  const abs = path.resolve(dirArg);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    error(`Not a directory: ${abs}`);
    process.exit(1);
  }

  const { globSync } = await import('glob');
  const mdCount = globSync(`${abs}/**/*.md`, { absolute: true, dot: true }).length;
  if (mdCount === 0) {
    error(`No .md files found under ${abs}`);
    process.exit(1);
  }

  const { loadConfig, saveConfig } = await import('../config.js');
  const config = loadConfig();
  config.sources = config.sources || [];

  const sourceIdx = args.indexOf('--source');
  const sourceName = sourceIdx !== -1 && args[sourceIdx + 1]
    ? `custom:${args[sourceIdx + 1]}`
    : `custom:${path.basename(abs)}`;

  const existing = config.sources.find(s => path.resolve(s.dir) === abs);
  if (existing) {
    info(`Already registered as source "${existing.source}" — re-indexing ${chalk.white.bold(mdCount)} files...`);
  } else {
    config.sources.push({ dir: abs, source: sourceName });
    saveConfig(config);
    success(`Added source "${sourceName}" → ${abs}`);
    info(`Indexing ${chalk.white.bold(mdCount)} .md files...`);
  }

  const { indexSource } = await import('../indexer.js');
  await indexSource(abs, existing ? existing.source : sourceName);
  info(chalk.gray('Run `pg reindex` to enable semantic search across all sources.'));
  process.exit(0);
}
