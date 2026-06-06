import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { hardFilter } from './src/filter/hard-filter.js';
import { classify } from './src/filter/classifier.js';
import { loadModel } from './src/filter/train.js';

const SKILL_REF_RE = /(?<!https?:|ftp:)(?<![a-zA-Z0-9])\/([a-z0-9][a-z0-9-]{2,})/g;

export function isSkillFile(filePath, raw) {
  const result = hardFilter(filePath, raw);
  if (!result.pass) return false;

  try {
    if (!raw) raw = fs.readFileSync(filePath, 'utf8');
    const firstLines = raw.trimStart().slice(0, 300);
    if (/^#\s*readme\b/i.test(firstLines)) return false;
    if (/!\[.*\]\(https?:\/\/(img\.shields\.io|badge\.fury|travis-ci|github\.com\/[^)]+\/badge)/i.test(firstLines)) return false;

    return true;
  } catch {
    return true;
  }
}

export async function filterWithClassifier(skills) {
  const centroids = loadModel();
  if (!centroids) return skills;

  const { embedBatch } = await import('./embedder.js');
  const texts = skills.map(s => s.content || '');
  const embeddings = await embedBatch(texts);

  return skills.filter((_, i) => {
    const decision = classify(embeddings[i], centroids);
    return decision.label === 'skill' || decision.label === 'unsure';
  });
}

export function parseSkillFile(filePath, source, opts = {}) {
  const raw = opts.raw ?? fs.readFileSync(filePath, 'utf8');

  let name, description, content;

  try {
    const { data, content: body } = matter(raw);
    name = data.name;
    description = data.description;
    content = body;
  } catch {
    content = raw;
  }

  name = (name && String(name).trim()) || path.basename(filePath, '.md');
  description = (description && String(description).trim()) || extractFirstParagraph(content || raw);

  const calls = new Set();
  for (const match of raw.matchAll(SKILL_REF_RE)) {
    const ref = match[1];
    if (ref !== name && ref.length > 2) calls.add(ref);
  }

  return { name, description, path: filePath, source, content: raw, calls: [...calls] };
}

function extractFirstParagraph(content) {
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
  return lines[0]?.trim().slice(0, 200) || '';
}
