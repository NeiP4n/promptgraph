import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { indexFile } from './indexer.js';
import { getDb } from './db.js';
import { loadConfig } from './config.js';

export function startWatcher() {
  const config = loadConfig();
  const paths = config.sources.map(s => s.dir).filter(d => fs.existsSync(d));
  if (paths.length === 0) return;

  const watcher = chokidar.watch(paths, {
    ignored: /[/\\]\./,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  watcher.on('add', filePath => reindex(filePath, config));
  watcher.on('change', filePath => reindex(filePath, config));
  watcher.on('unlink', filePath => remove(filePath));

  console.error('[PromptGraph] Watcher started');
}

function getSource(filePath, config) {
  const normFile = path.resolve(filePath);
  // Sort longest-first so skills-store/marketplace wins over skills-store
  const sorted = [...config.sources].sort((a, b) => b.dir.length - a.dir.length);
  for (const { dir, source } of sorted) {
    if (normFile.startsWith(path.resolve(dir))) return source;
  }
  return 'unknown';
}

function deleteById(id) {
  const db = getDb();
  db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  db.prepare('DELETE FROM chunks WHERE skill_id = ?').run(id);
  db.prepare('DELETE FROM edges WHERE from_skill = ? OR to_skill = ?').run(id, id);
  db.prepare('DELETE FROM ratings WHERE skill_id = ?').run(id);
}

function remove(filePath) {
  if (!filePath.endsWith('.md')) return;
  try {
    const db = getDb();
    // find by path — file is already deleted, can't read frontmatter
    const row = db.prepare('SELECT id FROM skills WHERE path = ?').get(filePath);
    if (row) {
      deleteById(row.id);
      console.error(`[PromptGraph] Removed: ${row.id}`);
    }
  } catch (e) {
    console.error(`[PromptGraph] Error removing ${filePath}: ${e.message}`);
  }
}

async function reindex(filePath, config) {
  if (!filePath.endsWith('.md')) return;
  try {
    const db = getDb();
    const source = getSource(filePath, config);

    // check if path had a different id before (rename case)
    const existing = db.prepare('SELECT id FROM skills WHERE path = ?').get(filePath);

    await indexFile(filePath, source);

    // if new id differs from old id — delete old record
    if (existing) {
      const updated = db.prepare('SELECT id FROM skills WHERE path = ?').get(filePath);
      if (updated && updated.id !== existing.id) {
        deleteById(existing.id);
        console.error(`[PromptGraph] Renamed: ${existing.id} → ${updated.id}`);
      }
    }

    console.error(`[PromptGraph] Reindexed: ${path.basename(filePath)}`);
  } catch (e) {
    console.error(`[PromptGraph] Error reindexing ${filePath}: ${e.message}`);
  }
}
