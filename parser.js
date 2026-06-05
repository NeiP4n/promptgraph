import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

// match /skill-name but not URLs (http://, https://, etc.)
const SKILL_REF_RE = /(?<!https?:|ftp:)(?<![a-zA-Z0-9])\/([a-z0-9][a-z0-9-]{2,})/g;

// Filenames that are never skills — docs, meta, legal files
const SKIP_FILENAMES = new Set([
  'readme', 'changelog', 'license', 'contributing', 'code-of-conduct',
  'security', 'authors', 'credits', 'install', 'installation', 'usage',
  'engagements', 'contributing', 'contributors', 'maintainers',
  'acknowledgements', 'faq', 'glossary', 'index', 'overview', 'summary',
  'roadmap', 'todo', 'notes', 'template', 'example', 'sample', 'demo',
  'getting-started', 'quickstart', 'guide', 'tutorial', 'walkthrough',
  'architecture', 'design', 'spec', 'specification', 'requirements',
  'privacy', 'terms', 'disclaimer', 'notice', 'copying', 'warranty',
  'codeofconduct', 'pull_request_template', 'issue_template', 'funding',
]);

// Path segments that indicate the file is NOT a skill
const SKIP_DIRS = new Set([
  '.github', 'docs', 'doc', 'documentation', 'examples', 'example',
  'tests', 'test', '__tests__', 'spec', 'fixtures', 'assets', 'images',
  'img', 'screenshots', 'media', 'static', 'public', 'dist', 'build',
  'node_modules', 'vendor', 'third_party',
]);

export function isSkillFile(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const base = parts[parts.length - 1].replace(/\.md$/i, '').toLowerCase();

  // Skip by filename
  if (SKIP_FILENAMES.has(base)) return false;

  // Skip if any parent directory is in the skip list
  for (const part of parts.slice(0, -1)) {
    if (SKIP_DIRS.has(part.toLowerCase())) return false;
  }

  // Read and check content quality
  try {
    const raw = fs.readFileSync(filePath, 'utf8');

    // Too short to be a real skill
    if (raw.length < 150) return false;

    // Has valid frontmatter with name → definitely a skill
    try {
      const { data } = matter(raw);
      if (data.name && typeof data.name === 'string') return true;
    } catch {}

    // No frontmatter — check if it looks like instructions (not pure docs)
    // Must have some imperative/instructional content, not just markdown prose
    const lines = raw.split('\n').filter(l => l.trim());
    const hasCodeBlock = raw.includes('```');
    const hasBullets = lines.some(l => /^[-*]\s/.test(l));
    const hasNumbered = lines.some(l => /^\d+\.\s/.test(l));
    const hasHeaders = lines.filter(l => /^#{1,3}\s/.test(l)).length >= 2;

    // Must look structured, not just a prose document
    return (hasCodeBlock || hasBullets || hasNumbered) && hasHeaders;
  } catch {
    return false;
  }
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
