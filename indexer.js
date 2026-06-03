import { globSync } from 'glob';
import { parseSkillFile } from './parser.js';
import { embed } from './embedder.js';
import { getDb } from './db.js';
import { loadConfig } from './config.js';

export async function indexAll() {
  const config = loadConfig();
  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO skills (name, description, path, source, content, embedding)
    VALUES (@name, @description, @path, @source, @content, @embedding)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      path = excluded.path,
      source = excluded.source,
      content = excluded.content,
      embedding = excluded.embedding
  `);
  const upsertEdge = db.prepare(`INSERT OR IGNORE INTO edges (from_skill, to_skill) VALUES (?, ?)`);
  db.prepare('DELETE FROM edges').run();

  let count = 0;
  for (const { dir, source } of config.sources) {
    const files = globSync(`${dir}/**/*.md`);
    for (const file of files) {
      try {
        const skill = parseSkillFile(file, source);
        const embedding = await embed(skill.name + ' ' + skill.description + ' ' + skill.content.slice(0, 500));
        upsert.run({ ...skill, embedding: JSON.stringify(embedding) });
        for (const called of skill.calls) {
          upsertEdge.run(skill.name, called);
        }
        count++;
        process.stdout.write(`\r  Indexed: ${count} skills`);
      } catch (e) {
        console.error(`\n  Error indexing ${file}: ${e.message}`);
      }
    }
  }
  console.log(`\n  Done. ${count} skills indexed.`);
}

export async function indexFile(filePath, source) {
  const db = getDb();
  const skill = parseSkillFile(filePath, source);
  const embedding = await embed(skill.name + ' ' + skill.description + ' ' + skill.content.slice(0, 500));
  db.prepare(`
    INSERT INTO skills (name, description, path, source, content, embedding)
    VALUES (@name, @description, @path, @source, @content, @embedding)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      path = excluded.path,
      source = excluded.source,
      content = excluded.content,
      embedding = excluded.embedding
  `).run({ ...skill, embedding: JSON.stringify(embedding) });

  db.prepare('DELETE FROM edges WHERE from_skill = ?').run(skill.name);
  const upsertEdge = db.prepare('INSERT OR IGNORE INTO edges (from_skill, to_skill) VALUES (?, ?)');
  for (const called of skill.calls) {
    upsertEdge.run(skill.name, called);
  }
}
