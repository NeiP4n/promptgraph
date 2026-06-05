import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

// match /skill-name but not URLs (http://, https://, etc.)
const SKILL_REF_RE = /(?<!https?:|ftp:)(?<![a-zA-Z0-9])\/([a-z0-9][a-z0-9-]{2,})/g;

// Filenames that are never skills — docs, meta, legal files
const SKIP_FILENAMES = new Set([
  'readme', 'changelog', 'license', 'contributing', 'code-of-conduct',
  'security', 'authors', 'credits', 'install', 'installation', 'usage',
  'engagements', 'contributors', 'maintainers', 'acknowledgements',
  'faq', 'glossary', 'index', 'overview', 'summary', 'roadmap', 'todo',
  'notes', 'template', 'example', 'sample', 'demo', 'getting-started',
  'quickstart', 'guide', 'tutorial', 'walkthrough', 'architecture',
  'design', 'spec', 'specification', 'requirements', 'privacy', 'terms',
  'disclaimer', 'notice', 'copying', 'warranty', 'codeofconduct',
  'pull_request_template', 'issue_template', 'funding',
]);

// Filename patterns that are never skills — readme* catches ALL variants (readme_de, readme_zh-CN, etc.)
const SKIP_FILENAME_RE = /^(_|\.)|^v?\d+[\.\-]\d+|^\d{4}[\-_]\d{2}|^readme|^license|^changelog|^contributing|^code.of.conduct|^security|^authors|^credits|^disclaimer|^notice|^copying|^warranty|^promotion|^funding/i;

// Path segments that indicate the file is NOT a skill
const SKIP_DIRS = new Set([
  '.github', 'docs', 'doc', 'documentation', 'examples', 'example',
  'tests', 'test', '__tests__', 'spec', 'fixtures', 'assets', 'images',
  'img', 'screenshots', 'media', 'static', 'public', 'dist', 'build',
  'node_modules', 'vendor', 'third_party',
]);

// First-header values that signal documentation, not a skill
const DOC_FIRST_HEADERS = /^(overview|introduction|about|background|welcome|getting started|what is|why |table of contents|toc|foreword|preface|readme)/i;

// Imperative verbs commonly found in skill headers
const IMPERATIVE_HEADERS = /\b(run|use|apply|execute|check|debug|fix|create|add|remove|deploy|test|write|generate|analyze|review|refactor|optimize|configure|setup|install|scan|audit|validate|search|find|extract|parse)\b/i;

// Instructional section headers
const INSTRUCTION_HEADERS = /^#{1,3}\s+(steps?|usage|instructions?|how\s+to|when\s+to\s+use|workflow|process|procedure|example|examples?|commands?|output|result)/i;

// ── scoring ───────────────────────────────────────────────────────────────────

function skillScore(raw, base) {
  let score = 0;

  // Fast path: frontmatter with name = definitely a skill
  try {
    const { data } = matter(raw);
    if (data.name && typeof data.name === 'string') return 10;
  } catch {}

  const lines = raw.split('\n');
  const nonEmpty = lines.filter(l => l.trim());
  const headers = nonEmpty.filter(l => /^#{1,3}\s/.test(l));

  // Minimum viable content
  if (raw.length < 150)  return -99;
  if (headers.length < 1) return -99;

  // ── positive signals ──────────────────────────────────────────────────────

  // Instructional section names (## Steps, ## Usage, etc.)
  if (lines.some(l => INSTRUCTION_HEADERS.test(l))) score += 2;

  // Headers with imperative verbs
  if (headers.some(h => IMPERATIVE_HEADERS.test(h))) score += 2;

  // Code block
  if (raw.includes('```') || raw.includes('    ')) score += 1;

  // Numbered list (step-by-step)
  if (nonEmpty.some(l => /^\d+\.\s/.test(l))) score += 1;

  // Bullet list
  if (nonEmpty.some(l => /^[-*+]\s/.test(l))) score += 1;

  // Multiple headers (structure)
  if (headers.length >= 2) score += 1;
  if (headers.length >= 4) score += 1;

  // ── negative signals ──────────────────────────────────────────────────────

  // First header looks like documentation
  const firstHeader = headers[0]?.replace(/^#+\s*/, '') || '';
  if (DOC_FIRST_HEADERS.test(firstHeader)) score -= 3;

  // Content is mostly long prose paragraphs (narrative, not instructional)
  const paragraphs = raw.split(/\n\n+/).filter(p => p.trim() && !p.trim().startsWith('#'));
  const longProse = paragraphs.filter(p => p.split(' ').length > 60 && !/```/.test(p));
  if (longProse.length > paragraphs.length * 0.6 && paragraphs.length > 3) score -= 2;

  // Filename looks like a version, date, or index
  if (SKIP_FILENAME_RE.test(base)) score -= 3;

  // Very high word repetition (filler content)
  const words = raw.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (words.length > 80) {
    const unique = new Set(words);
    if (unique.size / words.length < 0.22) score -= 2;
  }

  return score;
}

// ── public API ────────────────────────────────────────────────────────────────

export function isSkillFile(filePath, raw) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const base = parts[parts.length - 1].replace(/\.md$/i, '').toLowerCase();

  // Hard-reject by filename
  if (SKIP_FILENAMES.has(base)) return false;
  if (SKIP_FILENAME_RE.test(base)) return false;

  // Hard-reject by parent directory
  for (const part of parts.slice(0, -1)) {
    if (SKIP_DIRS.has(part.toLowerCase())) return false;
  }

  try {
    if (!raw) raw = fs.readFileSync(filePath, 'utf8');

    // Hard-reject: content starts with README header or badge lines
    const firstLines = raw.trimStart().slice(0, 300);
    if (/^#\s*readme\b/i.test(firstLines)) return false;
    if (/!\[.*\]\(https?:\/\/(img\.shields\.io|badge\.fury|travis-ci|github\.com\/[^)]+\/badge)/i.test(firstLines)) return false;

    return skillScore(raw, base) >= 3;
  } catch {
    return false;
  }
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
