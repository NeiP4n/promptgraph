import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { validateSkill } from './validator.js';

// ── doc filename filter — same as cleanupRepoRoot in github-import.js ──────────
const SKIP_RE = /^(readme|changelog|license|contributing|code\.?of\.?conduct|security|authors|credits|install|installation|usage|promotion|faq|glossary|index|overview|summary|roadmap|todo|notes|template|example|sample|demo|guide|tutorial|walkthrough|architecture|design|spec|requirements|privacy|terms|disclaimer|notice|copying|warranty|funding|changelog)/i;

const SKIP_DIRS_LOCAL = new Set([
  '.github', 'docs', 'doc', 'documentation', 'assets', 'images', 'img',
  'screenshots', 'media', 'static', 'scripts', 'ci_scripts',
  'node_modules', 'vendor', 'dist', 'build', 'tests', 'test',
  'examples', 'example', 'fixtures',
]);

function isDocFile(name) {
  const base = path.basename(name, '.md').toLowerCase();
  return SKIP_RE.test(base);
}

function isSkipDir(name) {
  return SKIP_DIRS_LOCAL.has(name.toLowerCase());
}

// ── find .md files in subdirectories only (never root) ────────────────────────
function findSubdirMdFiles(repoRoot) {
  const files = [];
  const entries = fs.readdirSync(repoRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const fullPath = path.join(repoRoot, entry.name);

    if (entry.isDirectory()) {
      if (isSkipDir(entry.name)) continue;
      // Walk subdirectory recursively
      walkDir(fullPath, entry.name, files);
    }
    // Root files are SKIPPED — never count them
  }
  return files;
}

function walkDir(dirPath, relativePrefix, out) {
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = relativePrefix + '/' + entry.name;

    if (entry.isDirectory()) {
      if (isSkipDir(entry.name)) continue;
      walkDir(fullPath, relativePath, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      if (isDocFile(entry.name)) continue;
      out.push({ path: fullPath, relative: relativePath });
    }
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const repoArg = args.find(a => a.startsWith('--repo='))?.split('=').slice(1).join('=') || args[0];

  if (!repoArg) {
    console.error(JSON.stringify({ ok: false, errors: ['Usage: node validate-repo-action.js <owner/repo>'] }));
    process.exit(1);
  }

  const repo = repoArg.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  const cloneUrl = `https://github.com/${repo}.git`;
  const tmpDir = path.join(process.env.RUNNER_TEMP || process.env.TMPDIR || '/tmp', `validate-${repo.replace('/', '-')}`);

  // Clean any previous run
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

  // Clone with depth 1 (no API calls, no rate limits)
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const clone = spawnSync('git', ['clone', '--depth=1', cloneUrl, tmpDir], {
    stdio: 'pipe', env: gitEnv,
  });

  if (clone.status !== 0) {
    const msg = (clone.stderr?.toString() || 'unknown error').trim();
    console.error(JSON.stringify({ ok: false, errors: [`Failed to clone ${repo}: ${msg}`] }));
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // Find .md files in subdirectories only
  const candidates = findSubdirMdFiles(tmpDir);

  if (candidates.length === 0) {
    console.error(JSON.stringify({
      ok: false,
      errors: ['No valid .md skill files found in subdirectories'],
      detail: 'Root-level .md files are ignored. Skills must be in a subdirectory (skills/, prompts/, etc.).',
    }));
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // Validate each .md file via validateSkill()
  const results = [];
  let totalErrors = 0;

  for (const file of candidates) {
    const result = validateSkill(file.path);
    results.push({
      file: file.relative,
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings,
    });
    if (!result.ok) totalErrors++;
  }

  // Summary
  const summary = {
    ok: totalErrors === 0,
    repo,
    total_md_files: candidates.length,
    passed: candidates.length - totalErrors,
    failed: totalErrors,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));

  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(totalErrors === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(JSON.stringify({ ok: false, errors: [e.message] }));
  process.exit(1);
});
