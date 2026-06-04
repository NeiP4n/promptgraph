import { globSync } from 'glob';
import { createHash } from 'crypto';
import fs from 'fs';
import { parseSkillFile, isSkillFile } from './parser.js';
import { embedBatch, BATCH_SIZE } from './embedder.js';
import { getDb, skillId } from './db.js';
import { loadConfig } from './config.js';
import { chunkText } from './chunker.js';
import { buildAnnIndex } from './ann.js';
import { progress, success, info, spinner } from './cli.js';
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

  // collect all chunks across skills in batch
  const allChunks = [];
  for (const skill of skills) {
    const id = skillId(skill.source, skill.name);
    const chunks = chunkText(skill.name + ' ' + skill.description + '\n' + skill.content);
    for (let i = 0; i < chunks.length; i++) {
      allChunks.push({ id, skill, chunkIndex: i, text: chunks[i] });
    }
  }

  // embed all chunks in one batch call
  const texts = allChunks.map(c => c.text);
  const embeddings = await embedBatch(texts);

  const txn = db.transaction(() => {
    for (const skill of skills) {
      const id = skillId(skill.source, skill.name);
      upsertSkill.run({ id, name: skill.name, description: skill.description, path: skill.path, source: skill.source, content: skill.content, hash: skill.hash || null });
      deleteChunks.run(id);
      deleteEdges.run(id);
      for (const calledName of skill.calls) {
        // try to resolve to a real skill id, fallback to bare name
        const resolved = db.prepare("SELECT id FROM skills WHERE name = ? ORDER BY id LIMIT 1").get(calledName);
        upsertEdge.run(id, resolved ? resolved.id : calledName);
      }
    }
    for (let i = 0; i < allChunks.length; i++) {
      const { id, chunkIndex, text } = allChunks[i];
      upsertChunk.run(id, chunkIndex, text, JSON.stringify(embeddings[i]));
    }
  });
  txn();
}

export async function indexAll() {
  const config = loadConfig();
  const db = getDb();
  db.prepare('DELETE FROM edges').run();

  // pre-count total files
  let total = 0;
  const allFiles = [];
  for (const { dir, source } of config.sources) {
    const files = globSync(`${dir}/**/*.md`);
    files.forEach(f => allFiles.push({ file: f, source }));
    total += files.length;
  }
  info(`Found ${chalk.white.bold(total)} files`);

  let count = 0;
  let errors = 0;
  let batch = [];
  const start = Date.now();

  const getHash = db.prepare('SELECT hash FROM skills WHERE id = ?');

  let skipped = 0;
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
        if (count % 50 === 0) {
          const eta = count > 0 ? Math.round((total - count) * (Date.now() - start) / count / 1000) : '?';
          progress(count, total, `skipped: ${skipped}  eta: ${eta}s`);
        }
        continue;
      }
      const skill = { ...parsed, hash };
      batch.push(skill);
      if (batch.length >= BATCH_SIZE) {
        await indexBatch(db, batch);
        count += batch.length;
        batch = [];
        const pct = Math.round(count / total * 100);
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        const eta = count > 0 ? Math.round((total - count) * (Date.now() - start) / count / 1000) : '?';
        process.stdout.write(`\r  [${pct}%] ${count}/${total} skills | ${elapsed}s elapsed | ETA: ${eta}s | errors: ${errors}  `);
      }
    } catch (e) {
      errors++;
    }
  }

  if (batch.length > 0) {
    await indexBatch(db, batch);
    count += batch.length;
  }

  progress(total, total, 'done');
  console.log();
  const spin = spinner('Building ANN index...');
  spin.start();
  await buildAnnIndex();
  spin.stop();
  success(`Indexed ${chalk.white.bold(count)} skills  ${chalk.gray(`(${errors} errors, ${skipped} skipped)`)}`);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  info(chalk.gray(`Time: ${elapsed}s`));
}

export async function indexFile(filePath, source) {
  const db = getDb();
  const skill = parseSkillFile(filePath, source);
  await indexBatch(db, [skill]);
}
