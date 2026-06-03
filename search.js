import { embed, cosineSimilarity } from './embedder.js';
import { getDb } from './db.js';

export async function search(query, topK = 5) {
  const db = getDb();
  const queryVec = await embed(query);

  // RAG: search over chunks, deduplicate by skill
  const chunks = db.prepare('SELECT skill_name, embedding FROM chunks').all();

  const bestBySkill = new Map();
  for (const chunk of chunks) {
    const score = cosineSimilarity(queryVec, JSON.parse(chunk.embedding));
    const prev = bestBySkill.get(chunk.skill_name);
    if (!prev || score > prev) bestBySkill.set(chunk.skill_name, score);
  }

  const skillNames = [...bestBySkill.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([name]) => name);

  return skillNames.map(name => {
    const skill = db.prepare('SELECT name, description, path, source FROM skills WHERE name = ?').get(name);
    return { ...skill, score: bestBySkill.get(name) };
  });
}

export function getContext(name) {
  const db = getDb();
  const skill = db.prepare('SELECT * FROM skills WHERE name = ?').get(name);
  if (!skill) return null;
  const callees = db.prepare('SELECT to_skill FROM edges WHERE from_skill = ?').all(name).map(r => r.to_skill);
  const callers = db.prepare('SELECT from_skill FROM edges WHERE to_skill = ?').all(name).map(r => r.from_skill);
  return { ...skill, callees, callers };
}

export function getCallers(name) {
  const db = getDb();
  return db.prepare('SELECT from_skill FROM edges WHERE to_skill = ?').all(name).map(r => r.from_skill);
}

export function getCallees(name) {
  const db = getDb();
  return db.prepare('SELECT to_skill FROM edges WHERE from_skill = ?').all(name).map(r => r.to_skill);
}

export function getImpact(name) {
  const db = getDb();
  const visited = new Set();
  const queue = [name];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const callers = db.prepare('SELECT from_skill FROM edges WHERE to_skill = ?').all(cur).map(r => r.from_skill);
    queue.push(...callers);
  }
  visited.delete(name);
  return [...visited];
}

export function listAll() {
  const db = getDb();
  return db.prepare('SELECT name, description, source FROM skills ORDER BY name').all();
}
