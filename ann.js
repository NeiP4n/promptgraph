import { getDb, blobToVec } from './db.js';
import { getStore, resetStore } from './src/store/index.js';

export async function buildAnnIndex() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT skill_id, embedding FROM chunks').all();
    const entries = rows.map(r => ({
      skill_id: r.skill_id,
      vector: blobToVec(r.embedding),
    }));
    const store = getStore();
    await store.build(entries);
    console.error(`[PromptGraph] ANN index ready: ${store.size} vectors`);
  } catch (e) {
    console.error(`[PromptGraph] ANN build failed: ${e.message}`);
  }
}

export async function annSearch(queryVec, topK = 20) {
  try {
    const store = getStore();
    if (store.size === 0) return null;
    return await store.search(queryVec, topK);
  } catch (e) {
    console.error(`[PromptGraph] ANN search error: ${e.message}`);
    return null;
  }
}

export function resetAnnIndex() {
  resetStore();
}
