import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import fs from 'fs';

export default async function handler(args, bin) {
  if (!process.stdout.isTTY) {
    error('marketplace TUI requires an interactive terminal');
    process.exit(1);
  }
  const { browseMarketplace, browseBundles, installSkill, installBundle } = await import('../marketplace.js');
  const { loadConfig: _lcMkt } = await import('../config.js');
  const { getDb: _getDbMkt } = await import('../db.js');
  const { spinner: spin2 } = await import('../cli.js');
  const sp = spin2('Fetching marketplace...');
  sp.start();
  const [skills, bundles] = await Promise.all([browseMarketplace(1000), browseBundles(1000)]);
  sp.stop();

  if (skills?.error) { error(skills.error); process.exit(1); }

  const { getCachedCount, refreshCountsInBackground } = await import('../bundle-counts.js');
  const bundlesWithCounts = (Array.isArray(bundles) ? bundles : []).map(b => {
    if (!b.repo_url) return b;
    const cached = getCachedCount(b.repo_url);
    return cached !== null ? { ...b, skillCount: cached } : b;
  });
  refreshCountsInBackground(bundlesWithCounts);

  const installedSet = new Set();
  try {
    const cfg = _lcMkt();
    const db = _getDbMkt();
    const { SKILLS_STORE_DIR } = await import('../config.js');
    const githubDir = path.join(SKILLS_STORE_DIR, 'github');

    for (const b of (Array.isArray(bundles) ? bundles : [])) {
      if (b.repo_url) {
        const owner = b.repo_url.split('/')[0];
        const repo  = b.repo_url.split('/')[1];
        const clonedName = `${owner}-${repo}`;
        const clonedDir  = path.join(githubDir, clonedName);
        const dirExists  = fs.existsSync(clonedDir) &&
          fs.readdirSync(clonedDir).length > 0;
        if (dirExists) installedSet.add(b.id);
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
    async (item) => {
      if (item.type === 'bundle') {
        const r = await installBundle(item.id);
        if (r?.error) throw new Error(r.error);
        installedSet.add(item.id);
      } else {
        const r = await installSkill(item.code || item.id);
        if (r?.error) throw new Error(r.error);
        installedSet.add(item.id);
        if (item.code) installedSet.add(item.code);
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
