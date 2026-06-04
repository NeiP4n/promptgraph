import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

// match /skill-name but not URLs (http://, https://, etc.)
const SKILL_REF_RE = /(?<!https?:|ftp:)(?<![a-zA-Z0-9])\/([a-z0-9][a-z0-9-]{2,})/g;

// files that are likely not skills
const SKIP_FILENAMES = new Set(['readme', 'changelog', 'license', 'contributing', 'code-of-conduct', 'security', 'authors', 'credits']);

export function isSkillFile(filePath) {
  const base = filePath.split(/[\\/]/).pop().replace(/\.md$/i, '').toLowerCase();
  return !SKIP_FILENAMES.has(base);
}

export function parseSkillFile(filePath, source, opts = {}) {
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
