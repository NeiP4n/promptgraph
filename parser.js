import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { hardFilter } from './src/filter/hard-filter.js';
import { classify } from './src/filter/classifier.js';
import { loadModel } from './src/filter/train.js';

const SKILL_REF_RE = /(?<!https?:|ftp:)(?<![a-zA-Z0-9])\/([a-z0-9][a-z0-9-]{2,})/g;

// Generic filenames that carry no identity — name comes from the parent folder.
const GENERIC_SKILL_FILENAMES = new Set([
  'skill', 'skills', 'index', 'readme', 'agent', 'agents', 'main',
  'prompt', 'prompts', 'instructions', 'instruction',
]);

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
    const decision = classify(embeddings[i], centroids, skills[i].content, skills[i].path);
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

  // Derive name when frontmatter lacks one. For the common "<skill-name>/SKILL.md"
  // layout (anthropics/skills, google/skills, opencode, …) the filename is generic,
  // so every skill would collapse to the same id ("skill") and overwrite each other.
  // Use the parent folder name in that case.
  let derived = path.basename(filePath, '.md');
  if (GENERIC_SKILL_FILENAMES.has(derived.toLowerCase())) {
    const parent = path.basename(path.dirname(filePath));
    if (parent && parent !== '.') derived = parent;
  }
  name = (name && String(name).trim()) || derived;
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
