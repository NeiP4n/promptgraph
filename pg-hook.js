#!/usr/bin/env node
import { embed, cosineSimilarity } from './embedder.js';
import { getDb } from './db.js';

const chunks = [];
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', async () => {
  try {
    const json = JSON.parse(input);
    const prompt = json?.prompt || json?.user_prompt || '';
    if (!prompt || prompt.length < 5) process.exit(0);

    const queryVec = await embed(prompt);
    const db = getDb();
    const skills = db.prepare('SELECT name, description, path, embedding FROM skills').all();

    const results = skills
      .map(s => ({
        name: s.name,
        description: s.description,
        path: s.path,
        score: cosineSimilarity(queryVec, JSON.parse(s.embedding)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .filter(s => s.score > 0.55);

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
