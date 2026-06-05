import { EmbeddingModel, FlagEmbedding } from 'fastembed';
import path from 'path';
import os from 'os';

const CACHE_DIR = path.join(os.homedir(), '.claude', '.promptgraph', 'model-cache');
const BATCH_SIZE = 256;

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

export async function embedBatch(texts) {
  const m = await getModel();
  const all = [];
  for await (const batch of m.embed(texts)) {
    all.push(...batch);
  }
  return all.map(v => Array.from(v));
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export { BATCH_SIZE };
