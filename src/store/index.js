import { FlatVectorStore } from './flat-store.js';
import { HNSWVectorStore } from './hnsw-store.js';

let _store = null;

export function getStore(type = null) {
  if (_store) return _store;

  if (!type) {
    type = process.env.PG_VECTOR_STORE || 'flat';
  }

  _store = type === 'hnsw' ? new HNSWVectorStore() : new FlatVectorStore();
  return _store;
}

export function resetStore() {
  _store = null;
}
