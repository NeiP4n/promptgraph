import fs from 'fs';
import path from 'path';

const SKILL_REF_RE = /\/([a-z0-9][a-z0-9-]+)/g;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

export function parseSkillFile(filePath, source) {
  const raw = fs.readFileSync(filePath, 'utf8');

  let name = null;
  let description = null;
  let content = raw;

  const fm = raw.match(FRONTMATTER_RE);
  if (fm) {
    try {
      const nameMatch = fm[1].match(/^name:\s*(.+)$/m);
      const descMatch = fm[1].match(/^description:\s*(.+)$/m);
      if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
      if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '');
    } catch {}
  }

  name = name || path.basename(filePath, '.md');
  description = description || extractFirstParagraph(raw);

  const calls = new Set();
  for (const match of raw.matchAll(SKILL_REF_RE)) {
    const ref = match[1];
    if (ref !== name && ref.length > 2) calls.add(ref);
  }

  return {
    name,
    description,
    path: filePath,
    source,
    content: raw,
    calls: [...calls],
  };
}

function extractFirstParagraph(content) {
  const lines = content.replace(FRONTMATTER_RE, '').split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
  return lines[0]?.trim().slice(0, 200) || '';
}
