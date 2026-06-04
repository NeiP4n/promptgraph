import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const SKILL_REF_RE = /\/([a-z0-9][a-z0-9-]+)/g;

export function parseSkillFile(filePath, source) {
  const raw = fs.readFileSync(filePath, 'utf8');

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
