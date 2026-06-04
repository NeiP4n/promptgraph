import chokidar from 'chokidar';
import path from 'path';
import os from 'os';
import { indexFile } from './indexer.js';
import { getDb, skillId } from './db.js';
import { parseSkillFile } from './parser.js';

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
  watcher.on('unlink', filePath => remove(filePath));

  console.error('[PromptGraph] Watcher started');
}

function getSource(filePath) {
  for (const { dir, source } of SOURCES) {
    if (filePath.startsWith(dir)) return source;
  }
  return 'unknown';
}

function remove(filePath) {
  if (!filePath.endsWith('.md')) return;
  try {
    const source = getSource(filePath);
    const name = path.basename(filePath, '.md');
    const id = skillId(source, name);
    const db = getDb();
    db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    db.prepare('DELETE FROM chunks WHERE skill_id = ?').run(id);
    db.prepare('DELETE FROM edges WHERE from_skill = ? OR to_skill = ?').run(id, id);
    console.error(`[PromptGraph] Removed: ${id}`);
  } catch (e) {
    console.error(`[PromptGraph] Error removing ${filePath}: ${e.message}`);
  }
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
