import { getDb, blobToVec } from './db.js';

// In-memory flat index — no external dependency.
// For typical skill counts (<5000) this is faster than vectra's disk-based HNSW
// because all data fits in RAM and no I/O is needed per query.
let _cache = null;
let _cacheChunkCount = -1;

function loadCache(db) {
  const count = db.prepare('SELECT COUNT(*) as n FROM chunks').get().n;
  if (_cache && count === _cacheChunkCount) return _cache;
  const rows = db.prepare('SELECT skill_id, embedding FROM chunks').all();
  _cache = rows.map(r => ({
    skill_id: r.skill_id,
    vec: new Float32Array(blobToVec(r.embedding)),
  }));
  _cacheChunkCount = count;
  return _cache;
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

// Called after reindex — invalidate cache so next search reloads
export async function buildAnnIndex() {
  _cache = null;
  _cacheChunkCount = -1;
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as n FROM chunks').get().n;
  console.error(`[PromptGraph] In-memory index ready: ${count} chunks`);
}

export async function annSearch(queryVec, topK = 20) {
  try {
    const db = getDb();
    const cache = loadCache(db);
    if (!cache.length) return null;

    const qArr = new Float32Array(queryVec);
    const bestBySkill = new Map();
    for (const entry of cache) {
      const score = cosineSim(qArr, entry.vec);
      const prev = bestBySkill.get(entry.skill_id);
      if (!prev || score > prev) bestBySkill.set(entry.skill_id, score);
    }

    return [...bestBySkill.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([skill_id, score]) => ({ skill_id, score }));
  } catch {
    return null;
  }
}
