import { embed, cosineSimilarity } from './embedder.js';
import { getDb, blobToVec } from './db.js';
import { annSearch } from './ann.js';

function getHybridWeights(query) {
  const hasTechTerms = /[A-Z]|\d/.test(query);
  if (hasTechTerms) return { embedWeight: 0.5, bm25Weight: 0.5 }
  return { embedWeight: 0.7, bm25Weight: 0.3 }
}

function applyRatingBoost(db, id, score) {
  const r = db.prepare('SELECT success, fail FROM ratings WHERE skill_id = ?').get(id);
  if (r && (r.success + r.fail) > 3) {
    const rating = r.success / (r.success + r.fail);
    return score * (0.85 + 0.15 * rating);
  }
  return score;
}

function normalizeBM25(raw) {
  return Math.max(0, 1 + raw / 10);
}

async function runEmbeddingSearch(db, queryVec, topK) {
  // Try ANN index first (fast)
  const annResults = await annSearch(queryVec, topK);
  if (annResults && annResults.length > 0) {
    const bestBySkill = new Map();
    for (const r of annResults) {
      const prev = bestBySkill.get(r.skill_id);
      if (!prev || r.score > prev) bestBySkill.set(r.skill_id, r.score);
    }
    return [...bestBySkill.entries()]
      .map(([id, score]) => ({ id, score: Math.max(0, score) }))
      .sort((a, b) => b.score - a.score);
  }

  // Fallback: brute force cosine (used before first reindex)
  const chunks = db.prepare('SELECT skill_id, embedding FROM chunks').all();
  if (chunks.length > 0) {
    const bestBySkill = new Map();
    for (const chunk of chunks) {
      const score = cosineSimilarity(queryVec, blobToVec(chunk.embedding));
      const prev = bestBySkill.get(chunk.skill_id);
      if (!prev || score > prev) bestBySkill.set(chunk.skill_id, score);
    }
    return [...bestBySkill.entries()]
      .map(([id, score]) => ({ id, score: Math.max(0, score) }))
      .sort((a, b) => b.score - a.score);
  }

  return [];
}

function runBM25Search(db, query, topK) {
  try {
    const terms = query.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(Boolean).join(' OR ');
    const rows = db.prepare(
      `SELECT s.id, bm25(skills_fts) AS score FROM skills_fts
       JOIN skills s ON skills_fts.id = s.id
       WHERE skills_fts MATCH ? ORDER BY score LIMIT ?`
    ).all(terms, topK);
    return rows.map(r => ({ id: r.id, score: normalizeBM25(r.score) }));
  } catch {
    return [];
  }
}

export async function search(query, topK = 5) {
  const db = getDb();
  const { embedWeight, bm25Weight } = getHybridWeights(query);
  const queryVec = await embed(query);

  const embedResults = await runEmbeddingSearch(db, queryVec, topK * 4);
  const bm25Results = runBM25Search(db, query, topK * 4);

  // Fallback: pure BM25 if embeddings unavailable
  if (!embedResults.length) {
    return bm25Results.slice(0, topK)
      .map(r => skillWithSnippet(db, r.id, applyRatingBoost(db, r.id, r.score)))
      .filter(Boolean);
  }

  // Fallback: pure embedding if BM25 returns nothing
  if (!bm25Results.length) {
    return embedResults.slice(0, topK)
      .map(({ id, score }) => skillWithSnippet(db, id, applyRatingBoost(db, id, score)))
      .filter(Boolean);
  }

  // Hybrid: combine normalized scores from both signals
  const combined = new Map();
  for (const { id, score } of embedResults) {
    combined.set(id, { embedScore: score, bm25Score: 0 });
  }
  for (const { id, score } of bm25Results) {
    const entry = combined.get(id);
    if (entry) {
      entry.bm25Score = score;
    } else {
      combined.set(id, { embedScore: 0, bm25Score: score });
    }
  }

  const ordered = [...combined.entries()]
    .map(([id, s]) => ({
      id,
      score: embedWeight * s.embedScore + bm25Weight * s.bm25Score,
    }))
    .sort((a, b) => b.score - a.score)

  const rerankerEnabled = process.env.PG_RERANKER !== '0'

  if (rerankerEnabled) {
    const { Reranker } = await import('./src/reranker/reranker.js')
    const reranker = new Reranker()
    const topN = ordered.slice(0, 20)
      .map(({ id, score }) => {
        const s = skillWithSnippet(db, id, score)
        return s ? { id, text: s.snippet, score } : null
      })
      .filter(Boolean)
    const reranked = await reranker.rerank(query, topN, topK)
    return reranked.map(r => skillWithSnippet(db, r.id, applyRatingBoost(db, r.id, r.score))).filter(Boolean)
  }

  return ordered.slice(0, topK)
    .map(({ id, score }) => skillWithSnippet(db, id, applyRatingBoost(db, id, score)))
    .filter(Boolean);
}

function skillWithSnippet(db, id, score) {
  const skill = db.prepare('SELECT id, name, description, path, source, content, version, author, license, updated_at, downloads, verified FROM skills WHERE id = ?').get(id);
  if (!skill) return null;
  const { content, ...rest } = skill;
  const snippet = content?.replace(/^---[\s\S]*?---\n?/, '').trim().slice(0, 400) || '';
  return { ...rest, score, snippet };
}

export function getContext(nameOrId) {
  const db = getDb();
  let skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(nameOrId);
  if (!skill) {
    const res = resolveId(db, nameOrId);
    if (res.error) return res;
    skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(res.id);
  }
  if (!skill) return null;
  const callees = db.prepare('SELECT to_skill FROM edges WHERE from_skill = ?').all(skill.id).map(r => r.to_skill);
  const callers = db.prepare('SELECT from_skill FROM edges WHERE to_skill = ?').all(skill.id).map(r => r.from_skill);

  return { ...skill, callees, callers };
}

function resolveId(db, nameOrId) {
  const byId = db.prepare('SELECT id FROM skills WHERE id = ?').get(nameOrId);
  if (byId) return { id: byId.id };
  const byName = db.prepare('SELECT id FROM skills WHERE name = ?').all(nameOrId);
  if (byName.length === 1) return { id: byName[0].id };
  if (byName.length > 1) {
    const candidates = byName.map(r => r.id).join(', ');
    return { error: `Ambiguous name "${nameOrId}" — multiple skills match. Use a full id: ${candidates}` };
  }
  return { error: `Skill not found: ${nameOrId}` };
}

export function getCallers(nameOrId) {
  const db = getDb();
  const res = resolveId(db, nameOrId);
  if (res.error) return res;
  return db.prepare('SELECT from_skill FROM edges WHERE to_skill = ?').all(res.id).map(r => r.from_skill);
}

export function getCallees(nameOrId) {
  const db = getDb();
  const res = resolveId(db, nameOrId);
  if (res.error) return res;
  return db.prepare('SELECT to_skill FROM edges WHERE from_skill = ?').all(res.id).map(r => r.to_skill);
}

export function getImpact(nameOrId) {
  const db = getDb();
  const res = resolveId(db, nameOrId);
  if (res.error) return res;
  const visited = new Set();
  const queue = [res.id];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const callers = db.prepare('SELECT from_skill FROM edges WHERE to_skill = ?').all(cur).map(r => r.from_skill);
    queue.push(...callers);
  }
  visited.delete(res.id);
  return [...visited];
}

export function listAll() {
  const db = getDb();
  return db.prepare('SELECT id, name, description, source, version, author, license, updated_at, downloads, verified FROM skills ORDER BY source, name').all();
}
