import { embed, cosineSimilarity } from './embedder.js';
import { getDb } from './db.js';

export async function search(query, topK = 5) {
  const db = getDb();
  const queryVec = await embed(query);
  const skills = db.prepare('SELECT name, description, path, source, embedding FROM skills').all();

  return skills
    .map(skill => ({
      name: skill.name,
      description: skill.description,
      path: skill.path,
      source: skill.source,
      score: cosineSimilarity(queryVec, JSON.parse(skill.embedding)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function getContext(name) {
  const db = getDb();
  const skill = db.prepare('SELECT * FROM skills WHERE name = ?').get(name);
  if (!skill) return null;
  const callees = db.prepare('SELECT to_skill FROM edges WHERE from_skill = ?').all(name).map(r => r.to_skill);
  const callers = db.prepare('SELECT from_skill FROM edges WHERE to_skill = ?').all(name).map(r => r.from_skill);
  return { ...skill, embedding: undefined, callees, callers };
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
