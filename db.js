import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DB_PATH = path.join(os.homedir(), '.claude', '.promptgraph', 'promptgraph.db');

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
      embedding TEXT NOT NULL,
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
  `);

  // migrate: add hash column if missing
  const cols = db.pragma('table_info(skills)').map(c => c.name);
  if (!cols.includes('hash')) {
    db.exec('ALTER TABLE skills ADD COLUMN hash TEXT');
  }

  return db;
}

export function skillId(source, name) {
  return `${source}::${name}`;
}
