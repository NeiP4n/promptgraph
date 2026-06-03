import { EmbeddingModel, FlagEmbedding } from 'fastembed';
import path from 'path';
import os from 'os';

const CACHE_DIR = path.join(os.homedir(), '.claude', '.promptgraph', 'model-cache');

let model = null;

async function getModel() {
  if (!model) {
    model = await FlagEmbedding.init({
      model: EmbeddingModel.BGESmallENV15,
      cacheDir: CACHE_DIR,
    });
  }
  return model;
}

export async function embed(text) {
  const m = await getModel();
  const results = [];
  for await (const batch of m.embed([text])) {
    results.push(...batch);
  }
  return Array.from(results[0]);
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
