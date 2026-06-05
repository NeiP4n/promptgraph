import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { PROMPTGRAPH_DIR } from './config.js';

const DB_PATH = path.join(PROMPTGRAPH_DIR, 'promptgraph.db');

let _db = null;

export function getDb() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  _db = db;
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      hash TEXT
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB NOT NULL,
      UNIQUE(skill_id, chunk_index)
    );

    CREATE TABLE IF NOT EXISTS edges (
      from_skill TEXT NOT NULL,
      to_skill TEXT NOT NULL,
      PRIMARY KEY (from_skill, to_skill)
    );

    CREATE TABLE IF NOT EXISTS ratings (
      skill_id TEXT PRIMARY KEY,
      uses INTEGER DEFAULT 0,
      success INTEGER DEFAULT 0,
      fail INTEGER DEFAULT 0
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
      id UNINDEXED,
      name,
      description,
      content,
      content='skills',
      content_rowid='rowid'
    );
  `);

  // migrate: add hash column if missing
  const cols = db.pragma('table_info(skills)').map(c => c.name);
  if (!cols.includes('hash')) {
    db.exec('ALTER TABLE skills ADD COLUMN hash TEXT');
  }

  // migrate: convert JSON text embeddings to Float32 BLOB (one-time, ~10x smaller)
  const textEmbeddings = db.prepare("SELECT COUNT(*) as n FROM chunks WHERE typeof(embedding) = 'text'").get();
  if (textEmbeddings?.n > 0) {
    const rows = db.prepare("SELECT rowid, embedding FROM chunks WHERE typeof(embedding) = 'text'").all();
    const upd = db.prepare('UPDATE chunks SET embedding = ? WHERE rowid = ?');
    db.transaction(() => {
      for (const row of rows) {
        const vec = JSON.parse(row.embedding);
        upd.run(Buffer.from(new Float32Array(vec).buffer), row.rowid);
      }
    })();
    console.error(`[PromptGraph] Migrated ${textEmbeddings.n} embeddings TEXT→BLOB`);
  }

  return db;
}

export function skillId(source, name) {
  return `${source}::${name}`;
}

export function vecToBlob(vec) {
  return Buffer.from(new Float32Array(vec).buffer);
}

export function blobToVec(blob) {
  if (typeof blob === 'string') return JSON.parse(blob);
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
}
