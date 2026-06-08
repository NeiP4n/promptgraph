import chalk from 'chalk';
import { success, error, info } from '../cli.js';

export default async function handler(args, bin) {
  const query = args.slice(1).join(' ').trim();
  if (!query) {
    console.log(chalk.yellow('Usage: ') + chalk.white(`${bin} install <bundle-name>`));
    console.log(chalk.gray('  Examples:'));
    console.log(chalk.gray(`    ${bin} install engineering-best-practices`));
    console.log(chalk.gray(`    ${bin} install pg-000001`));
    console.log(chalk.gray(`    ${bin} install "LLM Prompts"`));
    console.log(chalk.gray(`\n  Browse: ${bin} marketplace\n`));
    process.exit(1);
  }

  const { installBundle } = await import('../marketplace.js');
  const ora = (await import('ora')).default;

  const spinner = ora({ text: chalk.gray(`Installing "${query}"...`), color: 'magenta' }).start();
  const result = await installBundle(query);
  spinner.stop();

  if (result.error) {
    error(result.error);
    console.log(chalk.gray(`  Try: ${bin} marketplace  (browse & search)`));
    process.exit(1);
  }

  if (result.type === 'repo_import') {
    success(`Installed ${chalk.white(result.bundle)}`);
    info(chalk.gray(`Run ${chalk.white('pg reindex')} to enable semantic search`));
  } else {
    const ok = result.installed?.length ?? 0;
    const fail = result.failed?.length ?? 0;
    success(`Installed ${chalk.white(result.bundle)} — ${ok} skill${ok !== 1 ? 's' : ''}${fail > 0 ? chalk.red(` (${fail} failed)`) : ''}`);
    if (ok > 0) info(chalk.gray(`Run ${chalk.white('pg reindex')} to enable semantic search`));
  }

  process.exit(0);
}
