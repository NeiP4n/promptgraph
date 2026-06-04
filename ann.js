import { LocalIndex } from 'vectra';
import path from 'path';
import os from 'os';
import { getDb } from './db.js';

const INDEX_PATH = path.join(os.homedir(), '.claude', '.promptgraph', 'hnsw-index');

let _index = null;

async function getIndex() {
  if (_index) return _index;
  _index = new LocalIndex(INDEX_PATH);
  if (!await _index.isIndexCreated()) {
    await _index.createIndex({ version: 1, deleteIfExists: true });
  }
  return _index;
}

export async function buildAnnIndex() {
  const index = await getIndex();
  await index.createIndex({ version: 1, deleteIfExists: true });

  const db = getDb();
  const chunks = db.prepare('SELECT skill_id, chunk_index, embedding FROM chunks').all();

  // Batch ALL inserts into a single disk write — vectra otherwise
  // persists the whole index on every insertItem (O(N^2) I/O).
  await index.beginUpdate();
  try {
    for (const chunk of chunks) {
      const vec = JSON.parse(chunk.embedding);
      await index.insertItem({
        vector: vec,
        metadata: { skill_id: chunk.skill_id, chunk_index: chunk.chunk_index },
      });
    }
    await index.endUpdate();
  } catch (e) {
    try { index.cancelUpdate(); } catch {}
    throw e;
  }

  _index = null; // force reload so queries see fresh index
  console.error(`[PromptGraph] ANN index built: ${chunks.length} chunks`);
}

export async function annSearch(queryVec, topK = 20) {
  try {
    const index = await getIndex();
    if (!await index.isIndexCreated()) return null;
    const items = await index.listItems();
    if (!items || items.length === 0) return null;

    const results = await index.queryItems(queryVec, topK);
    return results.map(r => ({
      skill_id: r.item.metadata.skill_id,
      score: r.score,
    }));
  } catch {
    return null;
  }
}
