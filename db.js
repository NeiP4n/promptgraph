import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { PROMPTGRAPH_DIR } from './config.js';

const DB_PATH = path.join(PROMPTGRAPH_DIR, 'promptgraph.db');

let _db = null;

const MIGRATIONS = [
  {
    version: 1, description: 'initial schema',
    up: db => db.exec(`
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
        id UNINDEXED, name, description, content,
        content='skills', content_rowid='rowid'
      );
    `),
  },
  {
    version: 2, description: 'add hash column',
    up: db => {
      const cols = db.pragma('table_info(skills)').map(c => c.name);
      if (!cols.includes('hash')) db.exec('ALTER TABLE skills ADD COLUMN hash TEXT');
    },
  },
  {
    version: 3, description: 'add registry metadata columns',
    up: db => {
      const cols = db.pragma('table_info(skills)').map(c => c.name);
      for (const [col, def] of [
        ['version', 'TEXT'],
        ['author', 'TEXT'],
        ['license', 'TEXT'],
        ['updated_at', 'TEXT'],
        ['downloads', 'INTEGER DEFAULT 0'],
        ['verified', 'INTEGER DEFAULT 0'],
        ['trust_level', "TEXT DEFAULT 'unknown'"],
        ['rating', 'REAL DEFAULT 0'],
        ['rating_count', 'INTEGER DEFAULT 0'],
        ['popularity', 'REAL DEFAULT 0'],
        ['last_update', 'TEXT'],
      ]) {
        if (!cols.includes(col)) db.exec(`ALTER TABLE skills ADD COLUMN ${col} ${def}`);
      }
    },
  },
  {
    version: 4, description: 'registry_entries table',
    up: db => db.exec(`
      CREATE TABLE IF NOT EXISTS registry_entries (
        id TEXT PRIMARY KEY,
        trust_level TEXT DEFAULT 'unknown',
        downloads INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        popularity REAL DEFAULT 0,
        last_update TEXT
      );
    `),
  },
  {
    version: 5, description: 'convert TEXT embeddings to Float32 BLOB',
    up: db => {
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
    },
  },
]

function getSchemaVersion(db) {
  try {
    return db.prepare('SELECT MAX(version) as v FROM _schema_version').get().v || 0
  } catch {
    return 0
  }
}

function runMigrations(db) {
  const current = getSchemaVersion(db)
  const pending = MIGRATIONS.filter(m => m.version > current).sort((a, b) => a.version - b.version)
  if (!pending.length) return

  db.exec(`CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY, description TEXT, applied_at TEXT)`)

  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db)
      db.prepare('INSERT INTO _schema_version (version, description, applied_at) VALUES (?, ?, ?)').run(
        migration.version, migration.description, new Date().toISOString()
      )
    })()
    console.error(`[PromptGraph] DB migrated to v${migration.version}: ${migration.description}`)
  }
}

export function getDb() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  _db = db;
  db.pragma('journal_mode = WAL');
  runMigrations(db);
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
