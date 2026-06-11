// Persistent, content-addressed cache for embedding vectors.
// Keyed by md5(modelTag + text) so re-indexing unchanged content — even after
// the DB is wiped or rebuilt — never re-runs the (slow) ONNX model. On weak
// devices this turns a full reindex from minutes into near-instant.
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { PROMPTGRAPH_DIR } from './config.js';

const CACHE_PATH = path.join(PROMPTGRAPH_DIR, 'embed-cache.db');
const MODEL_TAG = 'bge-small-en-v1.5';
const ENABLED = !process.env.PG_NO_EMBED_CACHE;

let _db = null;
let _broken = false;
let _stmtGet = null;
let _stmtPut = null;

function db() {
  if (_db || _broken || !ENABLED) return _db;
  try {
    fs.mkdirSync(PROMPTGRAPH_DIR, { recursive: true });
    _db = new Database(CACHE_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.exec('CREATE TABLE IF NOT EXISTS embed_cache (hash TEXT PRIMARY KEY, vec BLOB NOT NULL)');
    _stmtGet = _db.prepare('SELECT vec FROM embed_cache WHERE hash = ?');
    _stmtPut = _db.prepare('INSERT OR IGNORE INTO embed_cache (hash, vec) VALUES (?, ?)');
  } catch {
    _broken = true; // disk full / locked / unsupported — silently fall back to no-cache
    _db = null;
  }
  return _db;
}

export function hashText(text) {
  return createHash('md5').update(MODEL_TAG).update('\0').update(text).digest('hex');
}

function vecToBlob(vec) {
  return Buffer.from(new Float32Array(vec).buffer);
}

function blobToVec(buf) {
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
}

// Look up many hashes at once → Map<hash, number[]>. Missing keys are absent.
export function cacheGetMany(hashes) {
  const out = new Map();
  if (!db()) return out;
  try {
    for (const h of hashes) {
      const row = _stmtGet.get(h);
      if (row) out.set(h, blobToVec(row.vec));
    }
  } catch {}
  return out;
}

// Persist [hash, number[]] pairs. Best-effort; failures are swallowed.
export function cachePutMany(entries) {
  if (!db() || entries.length === 0) return;
  try {
    const tx = _db.transaction(rows => {
      for (const [h, vec] of rows) _stmtPut.run(h, vecToBlob(vec));
    });
    tx(entries);
  } catch {}
}
