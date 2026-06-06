import fs from 'fs';

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

const SKIP_FILENAME_RE = /^(_|\.)|^v?\d+[\.\-]\d+|^\d{4}[\-_]\d{2}|^readme|^license|^changelog|^contributing|^code.of.conduct|^security|^authors|^credits|^disclaimer|^notice|^copying|^warranty|^promotion|^funding/i;

const SKIP_DIRS = new Set([
  '.github', 'docs', 'doc', 'documentation', 'examples', 'example',
  'tests', 'test', '__tests__', 'spec', 'fixtures', 'assets', 'images',
  'img', 'screenshots', 'media', 'static', 'public', 'dist', 'build',
  'node_modules', 'vendor', 'third_party',
]);

const BADGE_RE = /!\[.*\]\(https?:\/\/(img\.shields\.io|badge\.fury|travis-ci|github\.com\/[^)]+\/badge)/i;
const README_HEADER_RE = /^#\s*readme\b/i;

export function hardFilter(filePath, raw) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const filename = parts[parts.length - 1];
  const base = filename.replace(/\.md$/i, '').toLowerCase();

  if (SKIP_FILENAMES.has(base)) {
    return { pass: false, reason: `skip filename: ${base}` };
  }

  if (SKIP_FILENAME_RE.test(base)) {
    return { pass: false, reason: `skip filename pattern: ${base}` };
  }

  for (const part of parts.slice(0, -1)) {
    if (SKIP_DIRS.has(part.toLowerCase())) {
      return { pass: false, reason: `skip dir: ${part}` };
    }
  }

  if (raw) {
    const firstLines = raw.trimStart().slice(0, 300);
    if (README_HEADER_RE.test(firstLines)) {
      return { pass: false, reason: 'starts with # Readme' };
    }
    if (BADGE_RE.test(firstLines)) {
      return { pass: false, reason: 'badge-only content' };
    }
  }

  return { pass: true };
}
