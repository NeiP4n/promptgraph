import chokidar from 'chokidar';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { indexFile } from './indexer.js';
import { getDb, skillId } from './db.js';
import { loadConfig } from './config.js';
import matter from 'gray-matter';

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
  watcher.on('unlink', filePath => remove(filePath, config));

  console.error('[PromptGraph] Watcher started');
}

function getSource(filePath, config) {
  for (const { dir, source } of config.sources) {
    if (filePath.startsWith(dir)) return source;
  }
  return 'unknown';
}

function readName(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { data } = matter(raw);
    return (data.name && String(data.name).trim()) || path.basename(filePath, '.md');
  } catch {
    return path.basename(filePath, '.md');
  }
}

function remove(filePath, config) {
  if (!filePath.endsWith('.md')) return;
  try {
    const source = getSource(filePath, config);
    const name = readName(filePath);
    const id = skillId(source, name);
    const db = getDb();
    db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    db.prepare('DELETE FROM chunks WHERE skill_id = ?').run(id);
    db.prepare('DELETE FROM edges WHERE from_skill = ? OR to_skill = ?').run(id, id);
    db.prepare('DELETE FROM ratings WHERE skill_id = ?').run(id);
    console.error(`[PromptGraph] Removed: ${id}`);
  } catch (e) {
    console.error(`[PromptGraph] Error removing ${filePath}: ${e.message}`);
  }
}

async function reindex(filePath, config) {
  if (!filePath.endsWith('.md')) return;
  try {
    await indexFile(filePath, getSource(filePath, config));
    console.error(`[PromptGraph] Reindexed: ${path.basename(filePath)}`);
  } catch (e) {
    console.error(`[PromptGraph] Error reindexing ${filePath}: ${e.message}`);
  }
}
