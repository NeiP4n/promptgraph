import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';

export default async function handler(args, bin) {
  if (args[1] === 'update') {
    const { loadConfig: _lcUpd, SKILLS_STORE_DIR: _ssDir } = await import('../config.js');
    const { indexSource } = await import('../indexer.js');
    const cfg = _lcUpd();
    const githubSources = cfg.sources.filter(s => s.source.startsWith('github:'));

    if (!githubSources.length) { info('No GitHub bundles installed.'); process.exit(0); }

    const targetId = args[2];
    const toUpdate = targetId
      ? githubSources.filter(s => s.source.toLowerCase().includes(targetId.toLowerCase()))
      : githubSources;

    if (!toUpdate.length) { error(`No installed bundle matching "${targetId}"`); process.exit(1); }

    let updated = 0, unchanged = 0, failed = 0;

    for (const src of toUpdate) {
      const repoName = src.source.replace('github:', '');
      const dest = src.dir.replace(/[/\\]skills$|[/\\]commands$|[/\\]prompts$/, '');
      const repoRoot = fs.existsSync(path.join(dest, '.git')) ? dest : src.dir;

      if (!fs.existsSync(path.join(repoRoot, '.git'))) {
        console.log(chalk.gray(`  skip ${repoName} (not a git repo)`));
        continue;
      }

      process.stdout.write(`  Checking ${chalk.white(repoName)}... `);

      const before = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 30000 }).stdout.trim();

      const fetch = spawnSync('git', ['-C', repoRoot, 'fetch', '--depth=1', 'origin'], { stdio: 'pipe', timeout: 60000 });
      if (fetch.status !== 0) {
        console.log(chalk.red('fetch failed'));
        failed++;
        continue;
      }
      const reset = spawnSync('git', ['-C', repoRoot, 'reset', '--hard', 'origin/HEAD'], { stdio: 'pipe', timeout: 30000 });
      if (reset.status !== 0) {
        spawnSync('git', ['-C', repoRoot, 'reset', '--hard', 'origin/main'], { stdio: 'pipe', timeout: 30000 });
      }

      const after = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 30000 }).stdout.trim();

      if (before === after) {
        console.log(chalk.gray('already up to date'));
        unchanged++;
        continue;
      }

      const diff = spawnSync('git', ['-C', repoRoot, 'diff', '--name-only', before, after], { encoding: 'utf8', timeout: 15000 });
      const changedMd = (diff.stdout || '').split('\n').filter(f => f.endsWith('.md')).length;
      console.log(chalk.green(`${changedMd} files changed`) + chalk.gray(` (${before.slice(0,7)} → ${after.slice(0,7)})`));

      await indexSource(src.dir, src.source);

      // Update cached skill count with real post-filter count
      try {
        const { globSync: _glob } = await import('glob');
        const { setCachedCount } = await import('../bundle-counts.js');
        const realCount = _glob(`${src.dir}/**/*.md`).length;
        const repoUrl = repoName.replace('-', '/');
        setCachedCount(repoUrl, realCount);
        setCachedCount(`https://github.com/${repoUrl}`, realCount);
      } catch {}

      updated++;
    }

    console.log();
    if (updated)   success(`Updated ${updated} bundle(s)`);
    if (unchanged) info(chalk.gray(`${unchanged} already up to date`));
    if (failed)    error(`${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }

  if (args[1] === 'install') {
    const { installBundle } = await import('../marketplace.js');
    const result = await installBundle(args[2]);
    if (result?.error) { error(result.error); process.exit(1); }
    success(result.type === 'repo_import' ? `Imported from ${result.repo_url}` : `Installed ${result.installed?.length || 0} skills`);
    process.exit(0);
  }
  if (args[1] === 'add-repo') {
    const doPush = args[args.length - 1] === '--push';
    const repoArg = doPush ? args[2] : args[2];
    if (!repoArg || !repoArg.includes('/')) { error('Usage: pg bundle add-repo <owner/repo> [--push]'); process.exit(1); }
    const repo = repoArg.replace('https://github.com/', '').replace('.git', '');

    const { detectSkillsDirFromAPI: _detectDir } = await import('../github-import.js');
    process.stdout.write(chalk.gray(`  Checking ${repo} for skill subdirectory... `));
    const detected = await _detectDir(repo);
    if (!detected) {
      console.log(chalk.red('none found'));
      error(
        `Cannot publish: no skill subdirectory found in ${repo}\n` +
        `  Expected: skills/, prompts/, commands/, agents/, or any folder with .md files\n` +
        `  Visit: https://github.com/${repo}`
      );
      process.exit(1);
    }
    console.log(chalk.green(`found: ${detected.label}/`));
    const name = repo.split('/')[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const id = repo.replace('/', '-').toLowerCase();
    const bundle = {
      id, name, repo_url: repo, author: repo.split('/')[0],
      description: `Skills from ${repo}`,
      tags: ['community'],
      stars: 0
    };
    const json = JSON.stringify(bundle, null, 2);

    if (doPush) {
      const registryDir = path.join(os.tmpdir(), 'pg-push-registry');
      const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
      const git = (gArgs, opts = {}) => { const r = spawnSync('git', gArgs, { ...opts, env: gitEnv, stdio: 'pipe', timeout: 60000 }); if (r.status !== 0) { error(r.stderr?.toString() || r.stdout?.toString() || 'git error'); process.exit(1); } return r; };
      if (fs.existsSync(registryDir)) {
        git(['-C', registryDir, 'pull']);
      } else {
        git(['clone', '--depth=1', 'https://github.com/NeiP4n/promptgraph-registry.git', registryDir]);
      }
      const regFile = path.join(registryDir, 'registry.json');
      const reg = JSON.parse(fs.readFileSync(regFile, 'utf8'));
      if (reg.bundles.find(b => b.id === id)) { error(`Bundle "${id}" already exists`); process.exit(1); }
      reg.bundles.push(bundle);
      reg.updated = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(regFile, JSON.stringify(reg, null, 2) + '\n');
      fs.writeFileSync(path.join(registryDir, 'bundles', `${id}.json`), json + '\n');
      git(['-C', registryDir, 'config', 'user.email', 'pg-bot@promptgraph.ai']);
      git(['-C', registryDir, 'config', 'user.name', 'PromptGraph Bot']);
      git(['-C', registryDir, 'add', '-A']);
      git(['-C', registryDir, 'commit', '-m', `bundle: ${name} (${repo})`]);
      git(['-C', registryDir, 'push']);
      success(`Bundle "${id}" pushed to registry`);
    } else {
      const tmp = path.join(os.tmpdir(), `pg-bundle-${id}.json`);
      fs.writeFileSync(tmp, json);
      const { publishBundle } = await import('../marketplace.js');
      const result = await publishBundle(tmp);
      fs.unlinkSync(tmp);
      if (result?.error) { error(result.error); process.exit(1); }
      if (result.gh_not_installed) {
        console.log('\n' + result.instructions);
        // Auto-open browser
        try {
          if (process.platform === 'win32') {
            spawnSync('cmd', ['/c', 'start', '', result.submit_url], { stdio: 'ignore' });
          } else {
            const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
            spawnSync(openCmd, [result.submit_url], { stdio: 'ignore' });
          }
          console.log(chalk.green('\n✓ Opened in browser — just click "Submit new issue"'));
        } catch {}
      } else {
        success(`Bundle proposed! Submit: ${result.submit_url}`);
      }
    }
    process.exit(0);
  }
  error('Usage: pg bundle install <id>  |  pg bundle add-repo <owner/repo> [--push]');
  process.exit(1);
}
