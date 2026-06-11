import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import fs from 'fs';

export default async function handler(args, bin) {
  // Subcommand: validate / prune all installed marketplace files
  if (args[0] === 'validate' || args[0] === 'prune' || args[0] === '--validate' || args[0] === '--prune') {
    const { validateAndPruneMarketplace } = await import('../marketplace.js');
    const result = validateAndPruneMarketplace();
    if (result.removed.length > 0) {
      error(`Removed ${result.removed.length} invalid files:`);
      result.removed.forEach(r => console.log(`  ${chalk.red('✗')} ${r.file}`));
    }
    if (result.errors.length > 0) {
      error(`${result.errors.length} errors:`);
      result.errors.forEach(e => console.log(`  ${chalk.yellow('⚠')} ${e}`));
    }
    success(`${result.valid.length} valid files, ${result.removed.length} removed, ${result.errors.length} errors`);
    process.exit(result.errors.length > 0 ? 1 : 0);
  }

  if (!process.stdout.isTTY) {
    error('marketplace TUI requires an interactive terminal');
    process.exit(1);
  }
  const { browseMarketplace, browseBundles, installSkill, installBundle, installBundleBg, validateAndPruneMarketplace } = await import('../marketplace.js');
  const { loadConfig: _lcMkt } = await import('../config.js');
  const { getDb: _getDbMkt } = await import('../db.js');
  const { spinner: spin2 } = await import('../cli.js');
  const sp = spin2('Fetching marketplace...');
  sp.start();
  try {
    var [skills, bundles] = await Promise.all([browseMarketplace(1000), browseBundles(1000)]);
  } finally {
    sp.stop();
  }

  if (skills?.error) { error(skills.error); process.exit(1); }

  const { getCachedCount, setCachedCount, refreshCountsInBackground } = await import('../bundle-counts.js');
  const { SKILLS_STORE_DIR } = await import('../config.js');
  const { globSync } = await import('glob');
  const { SCRIPT_GLOBS } = await import('../github-import.js');
  const githubDir = path.join(SKILLS_STORE_DIR, 'github');

  // For each bundle: if installed on disk — use real file count + detect scripts; otherwise use cache
  const bundlesWithCounts = (Array.isArray(bundles) ? bundles : []).map(b => {
    if (!b.repo_url) return b;
    const owner = b.repo_url.split('/')[0];
    const repo  = b.repo_url.split('/')[1];
    const clonedDir = path.join(githubDir, `${owner}-${repo}`);
    if (fs.existsSync(clonedDir) && fs.readdirSync(clonedDir).length > 0) {
      const realCount = globSync(`${clonedDir}/**/*.md`, { absolute: true, dot: true }).length;
      const hasScripts = globSync(SCRIPT_GLOBS.map(p => `${clonedDir}/${p}`), { absolute: true, dot: true }).length > 0;
      setCachedCount(b.repo_url, realCount);
      return { ...b, skillCount: realCount, has_tools: b.has_tools || hasScripts };
    }
    const cached = getCachedCount(b.repo_url);
    const knownCount = cached ?? b.skill_count ?? null;
    return knownCount !== null ? { ...b, skillCount: knownCount, has_tools: b.has_tools } : b;
  });
  refreshCountsInBackground(bundlesWithCounts);

  const installedSet = new Set();
  try {
    const cfg = _lcMkt();
    const db = _getDbMkt();

    for (const b of (Array.isArray(bundles) ? bundles : [])) {
      if (b.repo_url) {
        const owner = b.repo_url.split('/')[0];
        const repo  = b.repo_url.split('/')[1];
        const clonedDir = path.join(githubDir, `${owner}-${repo}`);
        if (fs.existsSync(clonedDir) && fs.readdirSync(clonedDir).length > 0) installedSet.add(b.id);
      } else if (Array.isArray(b.skills)) {
        const allOnDisk = b.skills.every(sid => {
          const row = db.prepare('SELECT path FROM skills WHERE id = ?').get(sid);
          return row && fs.existsSync(row.path);
        });
        if (b.skills.length > 0 && allOnDisk) installedSet.add(b.id);
      }
    }

    for (const row of db.prepare('SELECT id, path FROM skills WHERE source = ?').all('marketplace')) {
      if (fs.existsSync(row.path)) installedSet.add(row.id);
    }
  } catch {}

  const { runTUI } = await import('../tui.js');
  const { loadConfig: _lcR, saveConfig: _scR, SKILLS_STORE_DIR: _ssR } = await import('../config.js');
  const { getDb: _getDbR } = await import('../db.js');

  await runTUI(
    Array.isArray(skills) ? skills : [],
    bundlesWithCounts,
    async (item, onStatus) => {
      if (item.type === 'bundle') {
        const r = await installBundleBg(item.id, async (err, result) => {
          if (err) { onStatus(false, err.message?.slice(0, 60) || 'Install failed'); return; }
          installedSet.add(item.id);
          const { getCachedCount } = await import('../bundle-counts.js');
          const cached = getCachedCount(item.repo_url);
          if (cached !== null) item.skillCount = cached;
          validateAndPruneMarketplace();
          onStatus(true, `Installed ${item.name}`);
        });
        if (r?.error) {
          if (!r.dedup) onStatus(false, r.error.slice(0, 60));
          return;
        }
        onStatus(null, `Queued ${item.name}…`);
      } else {
        const r = await installSkill(item.code || item.id);
        if (r?.error) { onStatus(false, r.error.slice(0, 60)); return; }
        installedSet.add(item.id);
        if (item.code) installedSet.add(item.code);
        validateAndPruneMarketplace();
        onStatus(true, `Installed ${item.name}`);
      }
    },
    installedSet,
    async (item) => {
      const cfg = _lcR();
      const db  = _getDbR();
      if (item.type === 'bundle' && item.repo_url) {
        const owner = item.repo_url.split('/')[0];
        const repo  = item.repo_url.split('/')[1];
        const clonedName = `${owner}-${repo}`;
        const clonedDir  = path.join(_ssR, 'github', clonedName);
        if (fs.existsSync(clonedDir)) fs.rmSync(clonedDir, { recursive: true, force: true });
        const src = `github:${clonedName}`;
        cfg.sources = cfg.sources.filter(s => s.source !== src && !s.dir.startsWith(clonedDir));
        _scR(cfg);
        db.prepare('DELETE FROM skills WHERE source = ?').run(src);
        db.prepare('DELETE FROM chunks WHERE skill_id NOT IN (SELECT id FROM skills)').run();
      } else if (item.type === 'bundle') {
        const mktDir = path.join(_ssR, 'marketplace');
        for (const sid of (item.skills || [])) {
          const row = db.prepare('SELECT path FROM skills WHERE id = ?').get(sid);
          if (row?.path && fs.existsSync(row.path)) fs.unlinkSync(row.path);
          db.prepare('DELETE FROM skills WHERE id = ?').run(sid);
          db.prepare('DELETE FROM chunks WHERE skill_id = ?').run(sid);
        }
      } else {
        const row = db.prepare('SELECT path FROM skills WHERE id = ?').get(item.id);
        if (row?.path && fs.existsSync(row.path)) fs.unlinkSync(row.path);
        db.prepare('DELETE FROM skills WHERE id = ?').run(item.id);
        db.prepare('DELETE FROM chunks WHERE skill_id = ?').run(item.id);
      }
      installedSet.delete(item.id);
      if (item.code) installedSet.delete(item.code);
    }
  );
  process.exit(0);
}
