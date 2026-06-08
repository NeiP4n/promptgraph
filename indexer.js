import { globSync } from 'glob';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { parseSkillFile, isSkillFile, filterWithClassifier } from './parser.js';
import { embedBatch, cosineSimilarity } from './embedder.js';
import { BATCH_SIZE } from './config.js';
import { getDb, skillId, vecToBlob } from './db.js';
import { loadConfig } from './config.js';
import { chunkText } from './chunker.js';
import { buildAnnIndex } from './ann.js';
import { progress, progressDone, success, info, spinner } from './cli.js';
import chalk from 'chalk';

const MAX_FILE_SIZE = 5 * 1024 * 1024;   // 5 MB per file
const MAX_FILE_COUNT = 100000;            // 100k files per reindex

function sanitizePath(filePath) {
  return path.resolve(filePath);
}

export async function indexBatch(db, skills, { fast = false } = {}) {
  const upsertSkill = db.prepare(`
    INSERT INTO skills (id, name, description, path, source, content, hash, version, author, license, updated_at, downloads, verified)
    VALUES (@id, @name, @description, @path, @source, @content, @hash, @version, @author, @license, @updated_at, @downloads, @verified)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      path = excluded.path,
      content = excluded.content,
      hash = excluded.hash,
      version = excluded.version,
      author = excluded.author,
      license = excluded.license,
      updated_at = excluded.updated_at,
      downloads = excluded.downloads,
      verified = excluded.verified
  `);
  const deleteChunks = db.prepare('DELETE FROM chunks WHERE skill_id = ?');
  const deleteEdges = db.prepare('DELETE FROM edges WHERE from_skill = ?');
  const upsertChunk = db.prepare('INSERT OR REPLACE INTO chunks (skill_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?)');
  const upsertEdge = db.prepare('INSERT OR IGNORE INTO edges (from_skill, to_skill) VALUES (?, ?)');
  const upsertFts = db.prepare(`INSERT OR REPLACE INTO skills_fts(id, name, description, content) VALUES (?, ?, ?, ?)`);

  const allChunks = [];
  if (!fast) {
    for (const skill of skills) {
      const id = skillId(skill.source, skill.name);
      const chunks = chunkText(skill.name + ' ' + skill.description + '\n' + skill.content);
      for (let i = 0; i < chunks.length; i++) {
        allChunks.push({ id, skill, chunkIndex: i, text: chunks[i] });
      }
    }
  }

  // pass 1: upsert all skills metadata first (so chunks can reference them)
  db.transaction(() => {
    for (const skill of skills) {
      const id = skillId(skill.source, skill.name);
      upsertSkill.run({ id, name: skill.name, description: skill.description, path: skill.path, source: skill.source, content: skill.content, hash: skill.hash || null, version: skill.version || null, author: skill.author || null, license: skill.license || null, updated_at: skill.updated_at || null, downloads: skill.downloads ?? 0, verified: skill.verified ? 1 : 0 });
      upsertFts.run(id, skill.name, skill.description || '', skill.content || '');
      if (!fast) {
        deleteChunks.run(id);
        deleteEdges.run(id);
      }
    }
  })();

  // pass 1b: embed all chunks in one call (fastembed batches internally by 256), with progress
  if (!fast && allChunks.length) {
    const texts = allChunks.map(c => c.text);
    const total = texts.length;
    const spin = spinner('Preparing model...');
    spin.start();
    let embedStart = null;
    const embeddings = await embedBatch(texts, (done, tot) => {
      if (!embedStart) { spin.stop(); embedStart = Date.now(); }
      const elapsed = (Date.now() - embedStart) / 1000;
      const eta = done > 0 ? Math.round((tot - done) * elapsed / done) : '?';
      progress(done, tot, { eta });
    });
    if (!embedStart) spin.stop();
    progressDone();
    db.transaction(() => {
      for (let i = 0; i < allChunks.length; i++) {
        const { id, chunkIndex, text } = allChunks[i];
        upsertChunk.run(id, chunkIndex, text, vecToBlob(embeddings[i]));
      }
    })();
  }

  // pass 2: resolve edges after all skills in batch are committed
  const resolveSameSource = db.prepare("SELECT id FROM skills WHERE name = ? AND source = ? LIMIT 1");
  const resolveAny = db.prepare("SELECT id FROM skills WHERE name = ? ORDER BY id LIMIT 1");
  db.transaction(() => {
    for (const skill of skills) {
      const id = skillId(skill.source, skill.name);
      for (const calledName of skill.calls) {
        // prefer a skill in the same source, fall back to any, then bare name
        const same = resolveSameSource.get(calledName, skill.source);
        const resolved = same || resolveAny.get(calledName);
        upsertEdge.run(id, resolved ? resolved.id : calledName);
      }
    }
  })();
}

export async function indexAll({ fast = false } = {}) {
  const config = loadConfig();
  const db = getDb();

  // collect all files on disk — use longest-matching source for files in subdirs
  // (e.g. skills-store/marketplace/*.md → 'marketplace', not 'skills-store')
  const normalizedSources = config.sources.map(s => ({
    ...s,
    normDir: path.resolve(s.dir),
  })).sort((a, b) => b.normDir.length - a.normDir.length); // longest first

  const seenFiles = new Set();
  const allFiles = [];
  for (const { dir, source } of normalizedSources) {
    const files = globSync(`${dir}/**/*.md`);
    for (const f of files) {
      const norm = sanitizePath(f);
      if (!seenFiles.has(norm)) {
        seenFiles.add(norm);
        allFiles.push({ file: norm, source });
      }
    }
    if (allFiles.length > MAX_FILE_COUNT) {
      info(chalk.yellow(`Reached max file count (${MAX_FILE_COUNT}) — truncating`));
      break;
    }
  }
  const total = allFiles.length;
  info(`Found ${chalk.white.bold(total)} files`);

  // reconcile: remove skills whose files no longer exist OR whose name changed
  const allDbSkills = db.prepare('SELECT id, path, name, source FROM skills').all();
  const existingPaths = new Set(allFiles.map(f => f.file));
  let removed = 0;

  // build expected id map from disk
  const expectedIds = new Map();
  for (const { file, source } of allFiles) {
    try {
      const parsed = parseSkillFile(file, source);
      expectedIds.set(file, skillId(source, parsed.name));
    } catch {}
  }

  for (const row of allDbSkills) {
    const pathGone = !existingPaths.has(row.path);
    const idChanged = expectedIds.has(row.path) && expectedIds.get(row.path) !== row.id;
    if (pathGone || idChanged) {
      db.prepare('DELETE FROM skills WHERE id = ?').run(row.id);
      db.prepare('DELETE FROM chunks WHERE skill_id = ?').run(row.id);
      db.prepare('DELETE FROM edges WHERE from_skill = ? OR to_skill = ?').run(row.id, row.id);
      db.prepare('DELETE FROM ratings WHERE skill_id = ?').run(row.id);
      removed++;
    }
  }
  if (removed > 0) info(`Removed ${chalk.yellow(removed)} stale/deleted skills`);

  let count = 0;
  let errors = 0;
  let skipped = 0;
  let classifierRemoved = 0;
  let batch = [];
  const start = Date.now();
  let processedCount = 0;
  let processedStart = null;

  // Build a path→{hash,id} map from DB for O(1) lookups
  const dbByPath = new Map();
  for (const row of db.prepare('SELECT id, path, hash FROM skills').all()) {
    dbByPath.set(row.path, row);
  }

  for (const { file, source } of allFiles) {
    try {
      // 1. Read file once (with size gate)
      let raw;
      try {
        const stat = fs.statSync(file);
        if (stat.size > MAX_FILE_SIZE) { skipped++; count++; continue; }
        raw = fs.readFileSync(file, 'utf8');
      } catch { skipped++; count++; continue; }

      // 2. Hash first — cheapest check
      const hash = createHash('md5').update(raw).digest('hex');

      // 3. If path already in DB with same hash → skip without parsing
      const dbRow = dbByPath.get(file);
      if (dbRow?.hash === hash) {
        skipped++; count++;
        if (count % 200 === 0) {
          const eta = processedCount > 0 && processedStart
            ? Math.round((total - count) * (Date.now() - processedStart) / processedCount / 1000)
            : '?';
          progress(count, total, { skipped, eta, errors });
        }
        continue;
      }

      // 4. Only now check if it's a real skill (content already in memory)
      if (!isSkillFile(file, raw)) { skipped++; count++; continue; }

      if (!processedStart) processedStart = Date.now();
      const parsed = parseSkillFile(file, source, { raw });
      batch.push({ ...parsed, hash });

      if (batch.length >= BATCH_SIZE) {
        const filtered = await filterWithClassifier(batch);
        classifierRemoved += batch.length - filtered.length;
        await indexBatch(db, filtered, { fast });
        count += filtered.length;
        processedCount += filtered.length;
        batch = [];
        const eta = processedCount > 0 ? Math.round((total - count) * (Date.now() - processedStart) / processedCount / 1000) : '?';
        progress(count, total, { skipped, eta, errors });
        await new Promise(r => setImmediate ? setImmediate(r) : setTimeout(r, 0));
      }
    } catch (e) {
      errors++;
      console.error(`[PromptGraph] Error indexing ${file}: ${e.message}`);
      try {
        const stale = db.prepare('SELECT id FROM skills WHERE path = ?').get(file);
        if (stale) {
          db.prepare('DELETE FROM skills WHERE id = ?').run(stale.id);
          db.prepare('DELETE FROM chunks WHERE skill_id = ?').run(stale.id);
          db.prepare('DELETE FROM edges WHERE from_skill = ? OR to_skill = ?').run(stale.id, stale.id);
          db.prepare('DELETE FROM ratings WHERE skill_id = ?').run(stale.id);
        }
      } catch {}
    }
  }

  if (batch.length > 0) {
    const filtered = await filterWithClassifier(batch);
    classifierRemoved += batch.length - filtered.length;
    await indexBatch(db, filtered, { fast });
    count += filtered.length;
  }

  progress(total, total, { skipped, errors });
  progressDone();
  if (!fast) {
    const spin = spinner('Building ANN index...');
    spin.start();
    await buildAnnIndex();
    spin.stop();
  }
  const stats = [`${errors} errors`, `${skipped} skipped`, `${removed} removed`];
  if (classifierRemoved > 0) stats.push(`${classifierRemoved} filtered`);
  success(`Indexed ${chalk.white.bold(count)} skills  ${chalk.gray(`(${stats.join(', ')})`)}`);
  if (fast) info(chalk.yellow('Fast mode: keyword search only. Run `pg reindex` for semantic search.'));
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  info(chalk.gray(`Time: ${elapsed}s`));
}

export async function indexFile(filePath, source) {
  const safe = sanitizePath(filePath);
  const stat = fs.statSync(safe);
  if (stat.size > MAX_FILE_SIZE) throw new Error(`File too large: ${filePath}`);
  const db = getDb();
  const raw = fs.readFileSync(safe, 'utf8');
  const hash = createHash('md5').update(raw).digest('hex');
  const skill = parseSkillFile(safe, source, { raw });
  await indexBatch(db, [{ ...skill, hash }]);
}

// Index only one source directory — fast mode first (no embeddings), then embed in background
export async function indexSource(dir, sourceName) {
  const db = getDb();
  const files = globSync(`${dir}/**/*.md`);
  const total = files.length;
  info(`Indexing ${chalk.white.bold(total)} files from ${sourceName}...`);

  const dbByPath = new Map();
  for (const row of db.prepare('SELECT id, path, hash FROM skills WHERE source = ?').all(sourceName)) {
    dbByPath.set(row.path, row);
  }

  // Remove skills from this source whose files are gone
  const existingPaths = new Set(files.map(f => path.resolve(f)));
  for (const [, row] of dbByPath) {
    if (!existingPaths.has(path.resolve(row.path))) {
      db.prepare('DELETE FROM skills WHERE id = ?').run(row.id);
      db.prepare('DELETE FROM chunks WHERE skill_id = ?').run(row.id);
      db.prepare('DELETE FROM edges WHERE from_skill = ? OR to_skill = ?').run(row.id, row.id);
    }
  }

  let count = 0, skipped = 0, errors = 0, batch = [];
  const start = Date.now();

  // Pass 1: fast — upsert skills into DB with keyword search only (instant)
  for (const file of files) {
    try {
      const norm = sanitizePath(file);
      const stat = fs.statSync(norm);
      if (stat.size > MAX_FILE_SIZE) { skipped++; count++; continue; }
      const raw = fs.readFileSync(norm, 'utf8');
      const hash = createHash('md5').update(raw).digest('hex');
      const dbRow = dbByPath.get(file);
      if (dbRow?.hash === hash) { skipped++; count++; continue; }
      if (!isSkillFile(file, raw)) { skipped++; count++; continue; }
      const parsed = parseSkillFile(file, sourceName, { raw });
      batch.push({ ...parsed, hash });
      if (batch.length >= BATCH_SIZE) {
        await indexBatch(db, batch, { fast: true });
        count += batch.length; batch = [];
        progress(count, total, { skipped, errors });
      }
    } catch (e) { errors++; count++; }
  }
  if (batch.length > 0) { await indexBatch(db, batch, { fast: true }); count += batch.length; }
  progress(total, total, { skipped, errors });
  progressDone();
  const elapsed1 = ((Date.now() - start) / 1000).toFixed(1);
  success(`Indexed ${chalk.white.bold(count)} skills from ${sourceName} ${chalk.gray(`(${skipped} skipped, ${elapsed1}s)`)}`);
  info(chalk.gray('  Run `pg reindex` anytime to enable semantic search.'));
}
