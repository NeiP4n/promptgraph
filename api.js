import { search as internalSearch, getContext, listAll as internalList } from './search.js';
import { indexAll, indexSource } from './indexer.js';
import { getDb } from './db.js';
import { loadConfig } from './config.js';

/**
 * Search for skills by query text.
 * @param {string} query - Natural language search query
 * @param {{ topK?: number, embedWeight?: number, bm25Weight?: number, source?: string, category?: string }} [options]
 * @returns {Promise<Array<{id: string, name: string, description: string, source: string, score: number, snippet: string}>>}
 */
export async function search(query, options = {}) {
  try {
    const { topK = 5, source } = options;
    const results = await internalSearch(query, source ? topK * 3 : topK);
    if (source) {
      return results.filter(r => r.source === source).slice(0, topK);
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Index all .md files in a directory under a source name.
 * @param {string} sourceDir - Path to directory containing .md skill files
 * @param {string} sourceName - Source label stored with each skill
 * @returns {Promise<{indexed: number, skipped: number, errors: number}>}
 */
export async function index(sourceDir, sourceName) {
  try {
    if (sourceDir.includes('..')) {
      return { indexed: 0, skipped: 0, errors: 1, error: 'Path traversal detected in sourceDir' };
    }
    const db = getDb();
    const { globSync } = await import('glob');
    const fs = await import('fs');
    const path = await import('path');
    const { createHash } = await import('crypto');
    const { parseSkillFile, isSkillFile } = await import('./parser.js');
    const { embedBatch, BATCH_SIZE } = await import('./embedder.js');
    const { skillId, vecToBlob } = await import('./db.js');
    const { chunkText } = await import('./chunker.js');

    const files = globSync(`${sourceDir}/**/*.md`);
    let indexed = 0, skipped = 0, errors = 0;
    const batch = [];

    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        if (stat.size > 5 * 1024 * 1024) { skipped++; continue; }
        const raw = fs.readFileSync(file, 'utf8');
        const hash = createHash('md5').update(raw).digest('hex');
        if (!isSkillFile(file, raw)) { skipped++; continue; }
        const parsed = parseSkillFile(file, sourceName, { raw });
        batch.push({ ...parsed, hash });
        if (batch.length >= BATCH_SIZE) {
          await indexBatch(db, batch);
          indexed += batch.length;
          batch.length = 0;
        }
      } catch { errors++; }
    }
    if (batch.length > 0) {
      await indexBatch(db, batch);
      indexed += batch.length;
    }
    return { indexed, skipped, errors };
  } catch (e) {
    return { indexed: 0, skipped: 0, errors: 1, error: e.message };
  }
}

/**
 * Remove a skill by its ID.
 * @param {string} skillId - Skill ID (format: "source::name")
 * @returns {{ok: boolean, error?: string}}
 */
export function remove(skillId) {
  try {
    const db = getDb();
    db.prepare('DELETE FROM skills WHERE id = ?').run(skillId);
    db.prepare('DELETE FROM chunks WHERE skill_id = ?').run(skillId);
    db.prepare('DELETE FROM edges WHERE from_skill = ? OR to_skill = ?').run(skillId, skillId);
    db.prepare('DELETE FROM ratings WHERE skill_id = ?').run(skillId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Reindex changed files only (hash-based). Scans all configured sources,
 * updates files whose content hash changed, and removes stale skills.
 * @returns {Promise<{updated: number, removed: number, errors: number}>}
 */
export async function update() {
  try {
    const db = getDb();
    const config = loadConfig();
    const { globSync } = await import('glob');
    const fs = await import('fs');
    const path = await import('path');
    const { createHash } = await import('crypto');
    const { parseSkillFile, isSkillFile } = await import('./parser.js');
    const { embedBatch, BATCH_SIZE } = await import('./embedder.js');
    const { skillId, vecToBlob } = await import('./db.js');
    const { chunkText } = await import('./chunker.js');
    const { indexBatch } = await import('./indexer.js');

    const normalizedSources = config.sources.map(s => ({ ...s, normDir: path.resolve(s.dir) }))
      .sort((a, b) => b.normDir.length - a.normDir.length);

    const seenFiles = new Set();
    const allFiles = [];
    for (const { dir, source } of normalizedSources) {
      const files = globSync(`${dir}/**/*.md`);
      for (const f of files) {
        const norm = path.resolve(f);
        if (!seenFiles.has(norm)) { seenFiles.add(norm); allFiles.push({ file: norm, source }); }
      }
    }

    const dbByPath = new Map();
    for (const row of db.prepare('SELECT id, path, hash FROM skills').all()) {
      dbByPath.set(row.path, row);
    }

    const existingPaths = new Set(allFiles.map(f => f.file));
    let removed = 0;
    for (const [filePath, row] of dbByPath) {
      if (!existingPaths.has(filePath)) {
        db.prepare('DELETE FROM skills WHERE id = ?').run(row.id);
        db.prepare('DELETE FROM chunks WHERE skill_id = ?').run(row.id);
        db.prepare('DELETE FROM edges WHERE from_skill = ? OR to_skill = ?').run(row.id, row.id);
        db.prepare('DELETE FROM ratings WHERE skill_id = ?').run(row.id);
        removed++;
      }
    }

    let updated = 0, errors = 0, batch = [];
    for (const { file, source } of allFiles) {
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const hash = createHash('md5').update(raw).digest('hex');
        const dbRow = dbByPath.get(file);
        if (dbRow?.hash === hash) continue;
        if (!isSkillFile(file, raw)) continue;
        const parsed = parseSkillFile(file, source, { raw });
        batch.push({ ...parsed, hash });
        if (batch.length >= BATCH_SIZE) {
          await indexBatch(db, batch);
          updated += batch.length;
          batch.length = 0;
        }
      } catch { errors++; }
    }
    if (batch.length > 0) {
      await indexBatch(db, batch);
      updated += batch.length;
    }

    return { updated, removed, errors };
  } catch (e) {
    return { updated: 0, removed: 0, errors: 1, error: e.message };
  }
}

/**
 * Get full skill details by ID, including edges.
 * @param {string} skillId
 * @returns {object|null}
 */
export function get(skillId) {
  try {
    return getContext(skillId);
  } catch {
    return null;
  }
}

/**
 * List all skills with optional filtering.
 * @param {{ source?: string, category?: string, limit?: number, offset?: number }} [options]
 * @returns {Array<object>}
 */
export function list(options = {}) {
  try {
    const { source, limit, offset } = options;
    let results = internalList();
    if (source) results = results.filter(r => r.source === source);
    if (offset) results = results.slice(offset);
    if (limit) results = results.slice(0, limit);
    return results;
  } catch {
    return [];
  }
}
