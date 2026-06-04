#!/usr/bin/env node
import { embed } from './embedder.js';
import { getDb } from './db.js';
import { annSearch } from './ann.js';
import { cosineSimilarity } from './embedder.js';

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', async () => {
  try {
    const json = JSON.parse(input);
    const prompt = json?.prompt || json?.user_prompt || '';
    if (!prompt || prompt.length < 5) process.exit(0);

    const queryVec = await embed(prompt);
    const db = getDb();

    // Use ANN index (fast). Fall back to brute-force only if ANN unavailable.
    let topIds;
    const annResults = await annSearch(queryVec, 15);

    if (annResults && annResults.length > 0) {
      const bestBySkill = new Map();
      for (const r of annResults) {
        const prev = bestBySkill.get(r.skill_id);
        if (!prev || r.score > prev) bestBySkill.set(r.skill_id, r.score);
      }
      topIds = [...bestBySkill.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .filter(([, score]) => score > 0.55);
    } else {
      // Fallback: brute-force (only before first reindex)
      const chunks = db.prepare('SELECT skill_id, embedding FROM chunks').all();
      const bestBySkill = new Map();
      for (const chunk of chunks) {
        const score = cosineSimilarity(queryVec, JSON.parse(chunk.embedding));
        const prev = bestBySkill.get(chunk.skill_id);
        if (!prev || score > prev) bestBySkill.set(chunk.skill_id, score);
      }
      topIds = [...bestBySkill.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .filter(([, score]) => score > 0.55);
    }

    if (topIds.length === 0) process.exit(0);

    const results = topIds.map(([id, score]) => {
      const skill = db.prepare('SELECT name, description, path FROM skills WHERE id = ?').get(id);
      return skill ? { ...skill, score } : null;
    }).filter(Boolean);

    if (results.length === 0) process.exit(0);

    const context = [
      '## Relevant skills found by PromptGraph',
      ...results.map(s => `- **${s.name}** (score: ${s.score.toFixed(2)}): ${s.description}\n  path: ${s.path}`),
      '\nIf any skill matches the task — Read its file and follow its instructions.',
    ].join('\n');

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context,
      }
    }));
  } catch {
    process.exit(0);
  }
});
