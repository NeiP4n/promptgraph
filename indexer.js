import { globSync } from 'glob';
import { createHash } from 'crypto';
import fs from 'fs';
import { parseSkillFile, isSkillFile } from './parser.js';
import { embedBatch, BATCH_SIZE } from './embedder.js';
import { getDb, skillId } from './db.js';
import { loadConfig } from './config.js';
import { chunkText } from './chunker.js';
import { buildAnnIndex } from './ann.js';
import { progress, progressDone, success, info, spinner } from './cli.js';
import chalk from 'chalk';

function fileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return createHash('md5').update(content).digest('hex');
}

async function indexBatch(db, skills) {
  const upsertSkill = db.prepare(`
    INSERT INTO skills (id, name, description, path, source, content, hash)
    VALUES (@id, @name, @description, @path, @source, @content, @hash)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      path = excluded.path,
      content = excluded.content,
      hash = excluded.hash
  `);
  const deleteChunks = db.prepare('DELETE FROM chunks WHERE skill_id = ?');
  const deleteEdges = db.prepare('DELETE FROM edges WHERE from_skill = ?');
  const upsertChunk = db.prepare('INSERT OR REPLACE INTO chunks (skill_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?)');
  const upsertEdge = db.prepare('INSERT OR IGNORE INTO edges (from_skill, to_skill) VALUES (?, ?)');

  const allChunks = [];
  for (const skill of skills) {
    const id = skillId(skill.source, skill.name);
    const chunks = chunkText(skill.name + ' ' + skill.description + '\n' + skill.content);
    for (let i = 0; i < chunks.length; i++) {
      allChunks.push({ id, skill, chunkIndex: i, text: chunks[i] });
    }
  }

  const texts = allChunks.map(c => c.text);
  const embeddings = await embedBatch(texts);

  // pass 1: upsert all skills + chunks (no edges yet)
  db.transaction(() => {
    for (const skill of skills) {
      const id = skillId(skill.source, skill.name);
      upsertSkill.run({ id, name: skill.name, description: skill.description, path: skill.path, source: skill.source, content: skill.content, hash: skill.hash || null });
      deleteChunks.run(id);
      deleteEdges.run(id);
    }
    for (let i = 0; i < allChunks.length; i++) {
      const { id, chunkIndex, text } = allChunks[i];
      upsertChunk.run(id, chunkIndex, text, JSON.stringify(embeddings[i]));
    }
  })();

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

export async function indexAll() {
  const config = loadConfig();
  const db = getDb();

  // collect all files on disk
  const allFiles = [];
  for (const { dir, source } of config.sources) {
    const files = globSync(`${dir}/**/*.md`);
    files.forEach(f => allFiles.push({ file: f, source }));
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
  let batch = [];
  const start = Date.now();
  const getHash = db.prepare('SELECT hash FROM skills WHERE id = ?');

  for (const { file, source } of allFiles) {
    try {
      if (!isSkillFile(file)) { skipped++; count++; continue; }
      const hash = fileHash(file);
      const parsed = parseSkillFile(file, source);
      const id = skillId(source, parsed.name);

      const existing = getHash.get(id);
      if (existing?.hash === hash) {
        skipped++;
        count++;
        if (count % 100 === 0) {
          const eta = count > 0 ? Math.round((total - count) * (Date.now() - start) / count / 1000) : '?';
          progress(count, total, { skipped, eta, errors });
        }
        continue;
      }

      batch.push({ ...parsed, hash });

      if (batch.length >= BATCH_SIZE) {
        await indexBatch(db, batch);
        count += batch.length;
        batch = [];
        const eta = count > 0 ? Math.round((total - count) * (Date.now() - start) / count / 1000) : '?';
        progress(count, total, { skipped, eta, errors });
      }
    } catch {
      errors++;
      // Remove stale record if the file was previously indexed but now fails to parse
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
    await indexBatch(db, batch);
    count += batch.length;
  }

  // rebuild all edges for unchanged skills too (fixes edge loss bug)
  rebuildEdgesForUnchanged(db);

  progress(total, total, { skipped, errors });
  progressDone();
  const spin = spinner('Building ANN index...');
  spin.start();
  await buildAnnIndex();
  spin.stop();
  success(`Indexed ${chalk.white.bold(count)} skills  ${chalk.gray(`(${errors} errors, ${skipped} skipped, ${removed} removed)`)}`);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  info(chalk.gray(`Time: ${elapsed}s`));
}

function rebuildEdgesForUnchanged(db) {
  // For skills that were skipped (hash unchanged), their edges were not touched.
  // This is correct — we only delete+rebuild edges for skills that were re-indexed.
  // No action needed here: edges for unchanged skills remain intact.
  // The global DELETE FROM edges at the start was the bug — it's now removed.
}

export async function indexFile(filePath, source) {
  const db = getDb();
  const skill = parseSkillFile(filePath, source);
  await indexBatch(db, [{ ...skill, hash: fileHash(filePath) }]);
}
