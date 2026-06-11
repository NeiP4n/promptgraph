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
  'claude', 'bugs', 'bug_report', 'bug-report', 'feature_request',
  'feature-request',
]);

const SKIP_FILENAME_RE = /^(_|\.)|^v?\d+[\.\-]\d+|^\d{4}[\-_]\d{2}|^readme|^license|^changelog|^contributing|^code.of.conduct|^security|^authors|^credits|^disclaimer|^notice|^copying|^warranty|^promotion|^funding|^claude|^bugs?\b|^feature.?request/i;

const SKIP_DIRS = new Set([
  '.github', 'docs', 'doc', 'documentation', 'examples', 'example',
  'tests', 'test', '__tests__', 'spec', 'fixtures', 'assets', 'images',
  'img', 'screenshots', 'media', 'static', 'public', 'dist', 'build',
  'node_modules', 'vendor', 'third_party',
  'references', 'reference', 'refs', 'cheatsheet', 'cheat-sheet',
  'cheatsheets', 'resources',
  'src', 'cli', 'lib', 'bin',
]);

const BADGE_RE = /!\[.*\]\(https?:\/\/(img\.shields\.io|badge\.fury|travis-ci|github\.com\/[^)]+\/badge)/i;
const README_HEADER_RE = /^#\s*readme\b/i;

// GitHub Copilot / agent convention keeps real skills under .github/{skills,prompts,
// agents,commands} (e.g. microsoft/skills). Allow those even though .github is a skip dir.
const COPILOT_SKILL_DIRS = new Set(['skills', 'prompts', 'agents', 'commands']);

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

  const dirSegs = parts.slice(0, -1);
  for (let i = 0; i < dirSegs.length; i++) {
    const seg = dirSegs[i].toLowerCase();
    if (SKIP_DIRS.has(seg)) {
      // .github/{skills,prompts,agents,commands}/… is a valid skill location
      if (seg === '.github' && COPILOT_SKILL_DIRS.has((dirSegs[i + 1] || '').toLowerCase())) {
        continue;
      }
      return { pass: false, reason: `skip dir: ${dirSegs[i]}` };
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
