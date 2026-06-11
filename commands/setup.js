import { colors, success, error, info, section } from '../cli.js';
import chalk from 'chalk';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Install the bundled router skills (pg, pg-chain) so a fresh install actually
// has the orchestration capability — not just docs that reference it.
// Copies into skillsDir (indexed → discoverable via pg_search on every platform)
// and, on Claude platforms, into ~/.claude/commands (so /pg & /pg-chain slash
// commands work). Never overwrites a user-edited copy.
function installRouterSkills(skillsDir, platformId) {
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const srcDir = path.join(pkgRoot, 'skills');
  if (!fs.existsSync(srcDir)) return;
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.md'));

  const targets = [path.join(skillsDir, '_promptgraph')];
  if (platformId === 'claude-code' || platformId === 'claude-desktop') {
    targets.push(path.join(os.homedir(), '.claude', 'commands'));
  }

  let installed = 0;
  for (const dir of targets) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of files) {
      const dest = path.join(dir, f);
      // Don't clobber a copy the user has customized; refresh only if missing/identical-origin.
      if (fs.existsSync(dest)) continue;
      fs.copyFileSync(path.join(srcDir, f), dest);
      installed++;
    }
  }
  if (installed) success(`Installed router skills (${files.map(f => f.replace('.md', '')).join(', ')})`);
}

export default async function handler(args, bin) {
  const { detectPlatforms, PLATFORMS } = await import('../platform.js');
  const { setupForPlatform, PLATFORM_SKILLS_DIRS } = await import('../config.js');
  const { indexAll } = await import('../indexer.js');
  const platformId = args[1];

  if (!platformId) {
    section('Detected platforms');
    detectPlatforms().forEach(p => {
      const tag = p.verified ? chalk.green('verified') : chalk.yellow('untested');
      info(`${chalk.white(p.id.padEnd(16))} ${chalk.gray(p.name.padEnd(20))} ${tag}`);
    });
    console.log(chalk.gray('\n  Usage: pg setup <platform>'));
    console.log(chalk.green('  Verified: ') + chalk.gray('claude-code, claude-desktop, opencode'));
    console.log(chalk.yellow('  Untested: ') + chalk.gray('cursor, windsurf, cline, codex') + chalk.gray('  (best-effort — please report results)\n'));
    process.exit(0);
  }

  const platform = PLATFORMS[platformId];
  if (!platform) { error(`Unknown platform: ${platformId}`); process.exit(1); }

  if (!platform.verified) {
    console.log(chalk.yellow(`  ⚠ ${platform.name} is untested.`) + chalk.gray(' Verified: claude-code, claude-desktop, opencode.'));
    console.log(chalk.gray(`    The MCP config format/path below is best-effort and may need manual fixing.`));
    console.log(chalk.gray(`    If it works (or doesn't), please report: https://github.com/NeiP4n/promptgraph/issues\n`));
  }

  // 1. Write MCP config
  try {
    platform.addMcp(platform);
    success(`MCP registered in ${chalk.white(platform.name)}`);
    info(chalk.gray(`  Config: ${platform.configPath}`));
  } catch (e) {
    error(`Failed to write MCP config: ${e.message}`);
  }

  // 2. Set skills dir for this platform
  const config = setupForPlatform(platformId);
  const skillsDir = config.skillsDir;
  success(`Skills directory: ${chalk.white(skillsDir)}`);
  info(chalk.gray('  Marketplace installs and pg import will save here'));

  // 2b. Install bundled router skills (pg + pg-chain orchestrator)
  try { installRouterSkills(skillsDir, platformId); } catch (e) { info(chalk.gray(`  (router skills skipped: ${e.message})`)); }

  // 3. Reindex
  console.log(chalk.gray('\n  Indexing skills...\n'));
  await indexAll();

  console.log(chalk.gray(`\n  Restart ${platform.name} to activate.\n`));
  process.exit(0);
}
