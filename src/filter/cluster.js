import { cosineSimilarity } from '../../embedder.js';

const INFERENCE_THRESHOLD = 0.35;

export function findClusters(skills, embeddings) {
  if (!skills.length || !embeddings) return [];
  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < skills.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = { centroid: embeddings[i], members: [skills[i]], indices: [i] };
    assigned.add(i);

    for (let j = i + 1; j < skills.length; j++) {
      if (assigned.has(j)) continue;
      if (cosineSimilarity(embeddings[i], embeddings[j]) >= INFERENCE_THRESHOLD) {
        cluster.members.push(skills[j]);
        cluster.indices.push(j);
        assigned.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

export function expandResults(annResults, db) {
  if (!annResults || annResults.length === 0) return annResults;

  const seenIds = new Set();
  const expanded = [];

  for (const r of annResults) {
    if (!seenIds.has(r.skill_id)) {
      seenIds.add(r.skill_id);
      expanded.push(r);
    }

    const callees = db.prepare('SELECT to_skill FROM edges WHERE from_skill = ?').all(r.skill_id);
    for (const c of callees) {
      if (!seenIds.has(c.to_skill)) {
        seenIds.add(c.to_skill);
        expanded.push({ skill_id: c.to_skill, score: r.score * 0.85 });
      }
    }
  }

  return expanded.sort((a, b) => b.score - a.score);
}
