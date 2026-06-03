import chokidar from 'chokidar';
import path from 'path';
import os from 'os';
import { indexFile } from './indexer.js';
import { getDb } from './db.js';

const SOURCES = [
  { dir: path.join(os.homedir(), '.claude', 'skills-store'), source: 'skills-store' },
  { dir: path.join(os.homedir(), '.claude', 'skills'), source: 'skills' },
];

export function startWatcher() {
  const paths = SOURCES.map(s => s.dir);

  const watcher = chokidar.watch(paths, {
    ignored: /[/\\]\./,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  watcher.on('add', filePath => reindex(filePath));
  watcher.on('change', filePath => reindex(filePath));
  watcher.on('unlink', filePath => {
    const name = path.basename(filePath, '.md');
    const db = getDb();
    db.prepare('DELETE FROM skills WHERE name = ?').run(name);
    db.prepare('DELETE FROM edges WHERE from_skill = ? OR to_skill = ?').run(name, name);
    console.error(`[PromptGraph] Removed: ${name}`);
  });

  console.error('[PromptGraph] Watcher started');
}

function getSource(filePath) {
  for (const { dir, source } of SOURCES) {
    if (filePath.startsWith(dir)) return source;
  }
  return 'unknown';
}

async function reindex(filePath) {
  if (!filePath.endsWith('.md')) return;
  try {
    await indexFile(filePath, getSource(filePath));
    console.error(`[PromptGraph] Reindexed: ${path.basename(filePath)}`);
  } catch (e) {
    console.error(`[PromptGraph] Error reindexing ${filePath}: ${e.message}`);
  }
}
