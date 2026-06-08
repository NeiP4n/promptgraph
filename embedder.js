import { EmbeddingModel, FlagEmbedding } from 'fastembed';
import path from 'path';
import os from 'os';

const CACHE_DIR = path.join(os.homedir(), '.claude', '.promptgraph', 'model-cache');
const BATCH_SIZE = 256;
const MAX_EMBEDDING_CALLS = 1_000_000;
let embedCallCount = 0;

export function getEmbedCallCount() { return embedCallCount; }
export function resetEmbedCallCount() { embedCallCount = 0; }

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
  embedCallCount++;
  const m = await getModel();
  const results = [];
  for await (const batch of m.embed([text])) {
    results.push(...batch);
  }
  return Array.from(results[0]);
}

export async function embedBatch(texts, onProgress) {
  if (embedCallCount + texts.length > MAX_EMBEDDING_CALLS) {
    throw new Error(`Embedding queue limit exceeded (max ${MAX_EMBEDDING_CALLS} chunks per session). Use --fast or reindex incrementally.`);
  }
  embedCallCount += texts.length;
  const m = await getModel();
  const all = [];
  let done = 0;
  for await (const batch of m.embed(texts)) {
    all.push(...batch);
    done += batch.length;
    if (onProgress) onProgress(done, texts.length);
  }
  return all.map(v => Array.from(v));
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export { BATCH_SIZE };
