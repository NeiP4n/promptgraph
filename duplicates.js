import { getDb, blobToVec } from './db.js';
import { cosineSimilarity } from './embedder.js';
import { annSearch, buildAnnIndex } from './ann.js';
import { getStore } from './src/store/index.js';

// ── Near-duplicate / overlap detector ────────────────────────────────────────
// With ~2000 skills, overlap and redundancy are real. Represent each skill by the
// mean of its chunk embeddings, use the ANN index to get candidate neighbors
// (avoids O(n²)), then confirm with exact cosine on the skill-level vectors.

function skillMeanVectors(db) {
  const rows = db.prepare('SELECT skill_id, embedding FROM chunks').all();
  const acc = new Map();   // skill_id -> { vec: Float32Array, n }
  for (const r of rows) {
    const v = blobToVec(r.embedding);
    const cur = acc.get(r.skill_id);
    if (!cur) acc.set(r.skill_id, { vec: Float32Array.from(v), n: 1 });
    else { for (let i = 0; i < v.length; i++) cur.vec[i] += v[i]; cur.n++; }
  }
  const out = new Map();
  for (const [id, { vec, n }] of acc) {
    for (let i = 0; i < vec.length; i++) vec[i] /= n;
    out.set(id, vec);
  }
  return out;
}

// Calibrated to BGE-Small mean-pooled vectors, whose similarity scale is compressed:
// genuine near-duplicates land around 0.70–0.73, not 0.9+. Default 0.70 surfaces real
// overlap; 0.73+ is near-identical content.
export async function findDuplicates({ threshold = 0.70, maxPairs = 200, neighbors = 8 } = {}) {
  const db = getDb();
  // A fresh CLI process has an empty in-memory ANN store — build it from chunks
  // so neighbor lookup works (the MCP server keeps it warm; the CLI must not assume that).
  if (getStore().size === 0) await buildAnnIndex();
  const vecs = skillMeanVectors(db);
  const meta = new Map(
    db.prepare('SELECT id, name, source FROM skills').all().map(s => [s.id, s])
  );

  const pairs = [];
  const seen = new Set();

  for (const [id, vec] of vecs) {
    const hits = await annSearch(vec, neighbors);
    if (!hits) break;   // ANN unavailable
    for (const { skill_id: other } of hits) {
      if (other === id) continue;
      const key = id < other ? `${id}|${other}` : `${other}|${id}`;
      if (seen.has(key)) continue;
      const ov = vecs.get(other);
      if (!ov) continue;
      const sim = cosineSimilarity(vec, ov);
      if (sim >= threshold) {
        seen.add(key);
        const a = meta.get(id), b = meta.get(other);
        pairs.push({
          a: id, b: other,
          aName: a?.name || id, bName: b?.name || other,
          aSource: a?.source || '?', bSource: b?.source || '?',
          sameSource: a?.source === b?.source,
          sim: +sim.toFixed(4),
        });
      }
    }
  }

  pairs.sort((x, y) => y.sim - x.sim);
  return pairs.slice(0, maxPairs);
}
