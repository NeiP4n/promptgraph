import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { globSync } from 'glob';
import { embedBatch } from '../../embedder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAINING_DIR = path.resolve(__dirname, '../../registry/training');
const MODEL_PATH = path.join(os.homedir(), '.claude', '.promptgraph', 'model.json');

function readAllMd(dir) {
  const files = globSync(`${dir}/**/*.md`, { dot: true });
  return files.map(f => fs.readFileSync(f, 'utf8'));
}

function meanVector(vectors) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const centroid = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) centroid[i] += v[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= vectors.length;
  return Array.from(centroid);
}

export async function train() {
  const goodDir = path.join(TRAINING_DIR, 'good');
  const badDir = path.join(TRAINING_DIR, 'bad');

  const goodTexts = readAllMd(goodDir);
  const badTexts = readAllMd(badDir);

  if (goodTexts.length < 1 || badTexts.length < 1) {
    throw new Error(`Need at least 1 good and 1 bad training example (good: ${goodTexts.length}, bad: ${badTexts.length})`);
  }

  const allTexts = [...goodTexts, ...badTexts];
  const allVecs = await embedBatch(allTexts);

  const goodVecs = allVecs.slice(0, goodTexts.length);
  const badVecs = allVecs.slice(goodTexts.length);

  const model = {
    version: 1,
    good: meanVector(goodVecs),
    bad: meanVector(badVecs),
    counts: { good: goodTexts.length, bad: badTexts.length },
  };

  fs.mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
  fs.writeFileSync(MODEL_PATH, JSON.stringify(model));
  return model;
}

export function loadModel() {
  try {
    const raw = fs.readFileSync(MODEL_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export { MODEL_PATH };
