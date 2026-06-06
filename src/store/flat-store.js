import { VectorStore } from './vector-store.js';

export class FlatVectorStore extends VectorStore {
  constructor() {
    super();
    this._items = [];
  }

  async add(id, vector) {
    this._items.push({ skill_id: id, vec: new Float32Array(vector) });
  }

  async addBatch(entries) {
    for (const { id, vector } of entries) {
      this._items.push({ skill_id: id, vec: new Float32Array(vector) });
    }
  }

  async remove(id) {
    this._items = this._items.filter(item => item.skill_id !== id);
  }

  async search(vector, topK = 20) {
    const qArr = new Float32Array(vector);
    const bestBySkill = new Map();
    for (const entry of this._items) {
      const score = cosineSim(qArr, entry.vec);
      const prev = bestBySkill.get(entry.skill_id);
      if (!prev || score > prev) bestBySkill.set(entry.skill_id, score);
    }
    return [...bestBySkill.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([skill_id, score]) => ({ skill_id, score }));
  }

  async build(entries) {
    this._items = [];
    for (const { skill_id, vector } of entries) {
      this._items.push({ skill_id, vec: new Float32Array(vector) });
    }
  }

  async clear() {
    this._items = [];
  }

  get size() {
    return this._items.length;
  }
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}
