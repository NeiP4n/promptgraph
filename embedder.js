import { EmbeddingModel, FlagEmbedding } from 'fastembed';
import path from 'path';
import os from 'os';
import { hashText, cacheGetMany, cachePutMany } from './embed-cache.js';

const CACHE_DIR = path.join(os.homedir(), '.claude', '.promptgraph', 'model-cache');
const BATCH_SIZE = 256;
const MAX_EMBEDDING_CALLS = 1_000_000;
let embedCallCount = 0;

// Embedding batch passed to fastembed. onnxruntime's CPU arena scales ~linearly
// with batch size, while CPU throughput is essentially batch-independent
// (~0.26s/text either way). Measured on this model: batch 16 → ~0.7 GB peak,
// 32 → ~1.2 GB, 64 → ~2.6 GB, 256 → ~5.8 GB, all at the same speed. So a small
// batch is strictly better — same wall-clock, far less RAM — which is what lets
// a first index run on a weak (2-4 GB) device without OOM/swap. Default 16;
// override with PG_EMBED_BATCH (larger only trades RAM for nothing on CPU).
const EMBED_BATCH = Math.max(1, parseInt(process.env.PG_EMBED_BATCH, 10) || 16);

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

// Release the embedding model so its ~2 GB arena can be reclaimed. Safe to call
// once embedding is done (e.g. before building the ANN index); getModel() will
// transparently re-init on the next embed.
export function freeModel() {
  model = null;
}

export async function embed(text) {
  const [v] = await embedBatch([text]);
  return v;
}

// Embed `texts`, returning a vector per input in order.
// Two layers cut the ONNX work that dominates indexing on slow devices:
//   1. dedup — identical texts (common boilerplate across a skill collection)
//      are embedded once and fanned back out to every position.
//   2. persistent cache — unique texts already embedded in a prior run are read
//      from disk, so a full reindex of unchanged content runs the model zero times.
export async function embedBatch(texts, onProgress) {
  const n = texts.length;
  if (embedCallCount + n > MAX_EMBEDDING_CALLS) {
    throw new Error(`Embedding queue limit exceeded (max ${MAX_EMBEDDING_CALLS} chunks per session). Use --fast or reindex incrementally.`);
  }
  embedCallCount += n;

  const out = new Array(n);
  if (n === 0) return out;

  // 1. group input positions by content hash (dedup)
  const groups = new Map(); // hash -> { text, positions: number[] }
  const order = [];
  for (let i = 0; i < n; i++) {
    const h = hashText(texts[i]);
    let g = groups.get(h);
    if (!g) { g = { text: texts[i], positions: [] }; groups.set(h, g); order.push(h); }
    g.positions.push(i);
  }

  // 2. fill from the persistent cache; collect misses to embed
  const cached = cacheGetMany(order);
  const missHashes = [];
  const missTexts = [];
  let done = 0;
  for (const h of order) {
    const g = groups.get(h);
    const v = cached.get(h);
    if (v) {
      for (const p of g.positions) out[p] = v;
      done += g.positions.length;
    } else {
      missHashes.push(h);
      missTexts.push(g.text);
    }
  }
  if (onProgress && done > 0) onProgress(Math.min(done, n), n);

  // 3. run the model only on cache misses, then persist them
  if (missTexts.length > 0) {
    const m = await getModel();
    const toPersist = [];
    let mi = 0;
    for await (const batch of m.embed(missTexts, EMBED_BATCH)) {
      for (const raw of batch) {
        const vec = Array.from(raw);
        const h = missHashes[mi++];
        const g = groups.get(h);
        for (const p of g.positions) out[p] = vec;
        toPersist.push([h, vec]);
        done += g.positions.length;
      }
      if (onProgress) onProgress(Math.min(done, n), n);
    }
    cachePutMany(toPersist);
  }

  return out;
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export { BATCH_SIZE };
