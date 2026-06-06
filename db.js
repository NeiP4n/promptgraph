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

  // migrate: add registry metadata columns
  if (!cols.includes('version')) {
    db.exec('ALTER TABLE skills ADD COLUMN version TEXT');
  }
  if (!cols.includes('author')) {
    db.exec('ALTER TABLE skills ADD COLUMN author TEXT');
  }
  if (!cols.includes('license')) {
    db.exec('ALTER TABLE skills ADD COLUMN license TEXT');
  }
  if (!cols.includes('updated_at')) {
    db.exec('ALTER TABLE skills ADD COLUMN updated_at TEXT');
  }
  if (!cols.includes('downloads')) {
    db.exec('ALTER TABLE skills ADD COLUMN downloads INTEGER DEFAULT 0');
  }
  if (!cols.includes('verified')) {
    db.exec('ALTER TABLE skills ADD COLUMN verified INTEGER DEFAULT 0');
  }
  if (!cols.includes('trust_level')) {
    db.exec('ALTER TABLE skills ADD COLUMN trust_level TEXT DEFAULT \'unknown\'');
  }
  if (!cols.includes('rating')) {
    db.exec('ALTER TABLE skills ADD COLUMN rating REAL DEFAULT 0');
  }
  if (!cols.includes('rating_count')) {
    db.exec('ALTER TABLE skills ADD COLUMN rating_count INTEGER DEFAULT 0');
  }
  if (!cols.includes('popularity')) {
    db.exec('ALTER TABLE skills ADD COLUMN popularity REAL DEFAULT 0');
  }
  if (!cols.includes('last_update')) {
    db.exec('ALTER TABLE skills ADD COLUMN last_update TEXT');
  }

  // migrate: registry entries metadata table
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_entries (
      id TEXT PRIMARY KEY,
      trust_level TEXT DEFAULT 'unknown',
      downloads INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      rating_count INTEGER DEFAULT 0,
      popularity REAL DEFAULT 0,
      last_update TEXT
    );
  `);

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
