import chalk from 'chalk';
import { success, info } from '../cli.js';

export default async function handler(args, bin) {
  const { detectPlatforms } = await import('../platform.js');
  const setupHandler = (await import('./setup.js')).default;

  const detected = detectPlatforms();

  if (detected.length === 0) {
    info('No editor detected. Run: ' + chalk.white(`${bin} setup <platform>`));
    info(chalk.gray('Platforms: claude-code, opencode, cursor, windsurf, cline, codex'));
    process.exit(0);
  }

  if (detected.length === 1) {
    info(`Detected: ${chalk.white(detected[0].name)}`);
    await setupHandler([args[0], detected[0].id], bin);
    return;
  }

  // Multiple editors — set up all, use first as primary skills dir
  info(`Detected ${detected.length} editors:`);
  for (const p of detected) info(`  ${chalk.white(p.id.padEnd(16))} ${chalk.gray(p.name)}`);
  console.log();
  await setupHandler([args[0], detected[0].id], bin);
}
