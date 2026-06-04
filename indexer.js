import { globSync } from 'glob';
import { parseSkillFile } from './parser.js';
import { embed } from './embedder.js';
import { getDb, skillId } from './db.js';
import { loadConfig } from './config.js';
import { chunkText } from './chunker.js';
import { buildAnnIndex } from './ann.js';

async function indexSkill(db, skill) {
  const id = skillId(skill.source, skill.name);

  db.prepare(`
    INSERT INTO skills (id, name, description, path, source, content)
    VALUES (@id, @name, @description, @path, @source, @content)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      path = excluded.path,
      content = excluded.content
  `).run({ id, name: skill.name, description: skill.description, path: skill.path, source: skill.source, content: skill.content });

  db.prepare('DELETE FROM chunks WHERE skill_id = ?').run(id);

  const chunks = chunkText(skill.name + ' ' + skill.description + '\n' + skill.content);
  const upsertChunk = db.prepare(`INSERT OR REPLACE INTO chunks (skill_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?)`);
  for (let i = 0; i < chunks.length; i++) {
    const vec = await embed(chunks[i]);
    upsertChunk.run(id, i, chunks[i], JSON.stringify(vec));
  }

  db.prepare('DELETE FROM edges WHERE from_skill = ?').run(id);
  const upsertEdge = db.prepare('INSERT OR IGNORE INTO edges (from_skill, to_skill) VALUES (?, ?)');
  for (const called of skill.calls) {
    upsertEdge.run(id, called);
  }
}

export async function indexAll() {
  const config = loadConfig();
  const db = getDb();
  db.prepare('DELETE FROM edges').run();

  let count = 0;
  for (const { dir, source } of config.sources) {
    const files = globSync(`${dir}/**/*.md`);
    for (const file of files) {
      try {
        const skill = parseSkillFile(file, source);
        await indexSkill(db, skill);
        count++;
        process.stdout.write(`\r  Indexed: ${count} skills`);
      } catch (e) {
        console.error(`\n  Error indexing ${file}: ${e.message}`);
      }
    }
  }
  process.stdout.write('\r  Building ANN index...');
  await buildAnnIndex();
  console.log(`\n  Done. ${count} skills indexed.`);
}

export async function indexFile(filePath, source) {
  const db = getDb();
  const skill = parseSkillFile(filePath, source);
  await indexSkill(db, skill);
}
