import { cosineSimilarity } from '../../embedder.js';

const DEDUP_THRESHOLD = 0.97;

export function dedup(skills, embeddings) {
  if (!skills.length) return { skills: [], embeddings: [] };
  if (embeddings && embeddings.length !== skills.length) {
    throw new Error('embeddings length must match skills length');
  }

  const keep = [true]; // first skill always kept
  const kept = [0];

  for (let i = 1; i < skills.length; i++) {
    let dup = false;
    if (embeddings) {
      for (const j of kept) {
        if (cosineSimilarity(embeddings[i], embeddings[j]) >= DEDUP_THRESHOLD) {
          dup = true;
          break;
        }
      }
    }
    if (dup) {
      keep.push(false);
    } else {
      keep.push(true);
      kept.push(i);
    }
  }

  return {
    skills: skills.filter((_, i) => keep[i]),
    embeddings: embeddings ? embeddings.filter((_, i) => keep[i]) : undefined,
  };
}
