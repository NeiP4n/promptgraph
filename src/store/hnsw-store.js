import { VectorStore } from './vector-store.js';
import fs from 'fs';
import path from 'path';

const DIMS = 384;
const EF_SEARCH = 100;

let HierarchicalNSW = null;
let moduleError = null;

async function getHnswModule() {
  if (HierarchicalNSW) return HierarchicalNSW;
  if (moduleError) throw moduleError;
  try {
    const mod = await import('hnswlib-node');
    HierarchicalNSW = mod.default.HierarchicalNSW;
    return HierarchicalNSW;
  } catch (e) {
    moduleError = new Error(
      'hnswlib-node not available. Run: npm install hnswlib-node'
    );
    throw moduleError;
  }
}

function toArray(v) {
  return Array.from(v);
}

export class HNSWVectorStore extends VectorStore {
  constructor() {
    super();
    this._index = null;
    this._vectors = [];
    this._idMap = [];
    this._itemCount = 0;
    this._maxElements = 0;
  }

  async add(id, vector) {
    const HNSW = await getHnswModule();
    const vec = toArray(vector);
    if (!this._index) {
      this._maxElements = 10000;
      this._index = new HNSW('cosine', DIMS);
      this._index.initIndex(this._maxElements, 200);
    }
    if (this._itemCount >= this._maxElements) {
      await this._rebuild(this._maxElements * 2);
    }
    this._index.addPoint(vec, this._itemCount);
    this._vectors.push(vec);
    this._idMap.push(id);
    this._itemCount++;
  }

  async addBatch(entries) {
    for (const { id, vector } of entries) {
      await this.add(id, vector);
    }
  }

  async remove(id) {
    const remainingVectors = [];
    const remainingIds = [];
    for (let i = 0; i < this._itemCount; i++) {
      if (this._idMap[i] !== id) {
        remainingVectors.push(this._vectors[i]);
        remainingIds.push(this._idMap[i]);
      }
    }
    this._index = null;
    this._vectors = remainingVectors;
    this._idMap = remainingIds;
    this._itemCount = remainingVectors.length;
    this._maxElements = 0;
    if (this._itemCount > 0) {
      await this._rebuild(this._itemCount + 1000);
    }
  }

  async search(vector, topK = 20) {
    await getHnswModule();
    if (!this._index || this._itemCount === 0) return [];

    const efSearch = Math.max(topK * 4, EF_SEARCH);
    this._index.setEf(efSearch);

    const numCandidates = Math.min(topK * 8, this._itemCount);
    const result = this._index.searchKnn(toArray(vector), numCandidates);

    const bestBySkill = new Map();
    const neighbors = result.neighbors;
    const distances = result.distances;
    for (let i = 0; i < neighbors.length; i++) {
      const idx = neighbors[i];
      const score = 1 - distances[i];
      const skillId = this._idMap[idx];
      const prev = bestBySkill.get(skillId);
      if (!prev || score > prev) bestBySkill.set(skillId, score);
    }

    return [...bestBySkill.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([skill_id, score]) => ({ skill_id, score }));
  }

  async build(entries) {
    const HNSW = await getHnswModule();
    const count = entries.length;

    this._vectors = [];
    this._idMap = [];
    this._itemCount = 0;
    this._maxElements = 0;
    this._index = null;

    if (count === 0) return;

    this._maxElements = count + 1000;
    this._index = new HNSW('cosine', DIMS);
    this._index.initIndex(this._maxElements, 200);

    for (let i = 0; i < count; i++) {
      const { skill_id, vector } = entries[i];
      const vec = toArray(vector);
      this._index.addPoint(vec, i);
      this._vectors.push(vec);
      this._idMap.push(skill_id);
      this._itemCount++;
    }
  }

  async clear() {
    this._index = null;
    this._vectors = [];
    this._idMap = [];
    this._itemCount = 0;
    this._maxElements = 0;
  }

  get size() {
    return this._itemCount;
  }

  async save(dir) {
    const HNSW = await getHnswModule();
    if (!this._index) return;
    fs.mkdirSync(dir, { recursive: true });
    this._index.writeIndexSync(path.join(dir, 'index.bin'));
    fs.writeFileSync(path.join(dir, 'vectors.json'), JSON.stringify(this._vectors), 'utf8');
    fs.writeFileSync(path.join(dir, 'idmap.json'), JSON.stringify(this._idMap), 'utf8');
  }

  async load(dir) {
    const HNSW = await getHnswModule();
    const indexPath = path.join(dir, 'index.bin');
    const vectorsPath = path.join(dir, 'vectors.json');
    const idmapPath = path.join(dir, 'idmap.json');
    if (!fs.existsSync(indexPath)) return false;

    this._index = new HNSW('cosine', DIMS);
    this._index.readIndexSync(indexPath);
    this._vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));
    this._idMap = JSON.parse(fs.readFileSync(idmapPath, 'utf8'));
    this._itemCount = this._idMap.length;
    this._maxElements = this._index.getMaxElements();
    return true;
  }

  static async fromDir(dir) {
    const store = new HNSWVectorStore();
    await store.load(dir);
    return store;
  }

  async _rebuild(newMax) {
    const HNSW = await getHnswModule();
    this._maxElements = newMax;
    this._index = new HNSW('cosine', DIMS);
    this._index.initIndex(this._maxElements, 200);
    for (let i = 0; i < this._itemCount; i++) {
      this._index.addPoint(this._vectors[i], i);
    }
  }
}
