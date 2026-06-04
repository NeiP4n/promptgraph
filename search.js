import { embed, cosineSimilarity } from './embedder.js';
import { getDb } from './db.js';
import { annSearch } from './ann.js';

function applyRatingBoost(db, id, score) {
  const r = db.prepare('SELECT success, fail FROM ratings WHERE skill_id = ?').get(id);
  if (r && (r.success + r.fail) > 3) {
    const rating = r.success / (r.success + r.fail);
    return score * (0.85 + 0.15 * rating);
  }
  return score;
}

export async function search(query, topK = 5) {
  const db = getDb();
  const queryVec = await embed(query);

  // Try ANN index first (fast, O(log N))
  const annResults = await annSearch(queryVec, topK * 4);

  if (annResults && annResults.length > 0) {
    const bestBySkill = new Map();
    for (const r of annResults) {
      const prev = bestBySkill.get(r.skill_id);
      if (!prev || r.score > prev) bestBySkill.set(r.skill_id, r.score);
    }
    return [...bestBySkill.entries()]
      .map(([id, score]) => ({ id, score: applyRatingBoost(db, id, score) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ id, score }) => {
        const skill = db.prepare('SELECT id, name, description, path, source FROM skills WHERE id = ?').get(id);
        return skill ? { ...skill, score } : null;
      })
      .filter(Boolean);
  }

  // Fallback: brute force (used before first reindex)
  const chunks = db.prepare('SELECT skill_id, embedding FROM chunks').all();
  const bestBySkill = new Map();
  for (const chunk of chunks) {
    const score = cosineSimilarity(queryVec, JSON.parse(chunk.embedding));
    const prev = bestBySkill.get(chunk.skill_id);
    if (!prev || score > prev) bestBySkill.set(chunk.skill_id, score);
  }
  return [...bestBySkill.entries()]
    .map(([id, score]) => ({ id, score: applyRatingBoost(db, id, score) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ id, score }) => {
      const skill = db.prepare('SELECT id, name, description, path, source FROM skills WHERE id = ?').get(id);
      return skill ? { ...skill, score } : null;
    })
    .filter(Boolean);
}

export function getContext(id) {
  const db = getDb();
  const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(id)
    || db.prepare('SELECT * FROM skills WHERE name = ? ORDER BY id LIMIT 1').get(id);
  if (!skill) return null;
  const callees = db.prepare('SELECT to_skill FROM edges WHERE from_skill = ?').all(skill.id).map(r => r.to_skill);
  const callers = db.prepare('SELECT from_skill FROM edges WHERE to_skill = ?').all(skill.id).map(r => r.from_skill);
  return { ...skill, callees, callers };
}

function resolveId(db, nameOrId) {
  // try exact id match first, then name match
  const byId = db.prepare('SELECT id FROM skills WHERE id = ?').get(nameOrId);
  if (byId) return byId.id;
  const byName = db.prepare('SELECT id FROM skills WHERE name = ? ORDER BY id LIMIT 1').get(nameOrId);
  return byName ? byName.id : nameOrId;
}

export function getCallers(nameOrId) {
  const db = getDb();
  const id = resolveId(db, nameOrId);
  return db.prepare('SELECT from_skill FROM edges WHERE to_skill = ?').all(id).map(r => r.from_skill);
}

export function getCallees(nameOrId) {
  const db = getDb();
  const id = resolveId(db, nameOrId);
  return db.prepare('SELECT to_skill FROM edges WHERE from_skill = ?').all(id).map(r => r.to_skill);
}

export function getImpact(nameOrId) {
  const db = getDb();
  const id = resolveId(db, nameOrId);
  const visited = new Set();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const callers = db.prepare('SELECT from_skill FROM edges WHERE to_skill = ?').all(cur).map(r => r.from_skill);
    queue.push(...callers);
  }
  visited.delete(id);
  return [...visited];
}

export function listAll() {
  const db = getDb();
  return db.prepare('SELECT id, name, description, source FROM skills ORDER BY source, name').all();
}
