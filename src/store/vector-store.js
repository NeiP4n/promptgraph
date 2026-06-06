export class VectorStore {
  async add(id, vector) { throw new Error('not implemented'); }
  async addBatch(entries) { throw new Error('not implemented'); }
  async remove(id) { throw new Error('not implemented'); }
  async search(vector, topK) { throw new Error('not implemented'); }
  async build(entries) { throw new Error('not implemented'); }
  async clear() { throw new Error('not implemented'); }
  get size() { return 0; }
}
