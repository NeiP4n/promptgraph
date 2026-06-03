import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DB_PATH = path.join(os.homedir(), '.claude', '.promptgraph', 'promptgraph.db');

export function getDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT
    );

    CREATE TABLE IF NOT EXISTS edges (
      from_skill TEXT NOT NULL,
      to_skill TEXT NOT NULL,
      PRIMARY KEY (from_skill, to_skill)
    );
  `);

  return db;
}
