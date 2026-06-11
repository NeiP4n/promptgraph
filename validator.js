import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { MAX_DOWNLOAD_SIZE } from './config.js';

// patterns that indicate malicious or junk skills
const DANGEROUS_PATTERNS = [
  { re: /curl\s+[^\n|]*\|\s*(ba)?sh/i, msg: 'pipes remote content to shell (curl | sh)' },
  { re: /wget\s+[^\n|]*\|\s*(ba)?sh/i, msg: 'pipes remote content to shell (wget | sh)' },
  { re: /rm\s+-rf\s+[~/]/i, msg: 'destructive rm -rf on home/root' },
  { re: /\b(eval|exec)\s*\(\s*(atob|base64|fromCharCode)/i, msg: 'obfuscated code execution' },
  { re: /(AWS|SECRET|PRIVATE|API)_?KEY\s*=\s*["'][A-Za-z0-9/+]{16,}/i, msg: 'hardcoded credential' },
  { re: /process\.env\.[A-Z_]+\s*[^\n]{0,40}(fetch|http|post|curl)/i, msg: 'reads env vars and exfiltrates over network' },
  { re: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?|rules)/i, msg: 'prompt injection attempt' },
  { re: /\b(reveal|print|output|show)\s+(your\s+)?(system\s+prompt|instructions|api\s*key)/i, msg: 'prompt extraction attempt' },
  { re: /\.ssh\/id_rsa|\.aws\/credentials|\.env\b.*(cat|read|cp|mv)/i, msg: 'accesses sensitive credential files' },
];

const MIN_CONTENT_LENGTH = 200;       // chars of actual instruction
const MAX_CONTENT_LENGTH = 5242880;    // 5MB cap
const MIN_DESCRIPTION_LENGTH = 15;
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function validateSkill(filePath) {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(filePath)) {
    return { ok: false, errors: ['File does not exist'], warnings: [] };
  }

  const raw = fs.readFileSync(filePath, 'utf8');

  // size checks
  if (raw.length < MIN_CONTENT_LENGTH) {
    errors.push(`Too short (${raw.length} chars, min ${MIN_CONTENT_LENGTH}). Likely not a real skill.`);
  }
  if (raw.length > MAX_CONTENT_LENGTH) {
    errors.push(`Too large (${raw.length} chars, max ${MAX_CONTENT_LENGTH}).`);
  }

  // frontmatter
  let data, content;
  try {
    const parsed = matter(raw);
    data = parsed.data;
    content = parsed.content;
  } catch (e) {
    errors.push(`Invalid frontmatter: ${e.message}`);
    return { ok: false, errors, warnings };
  }

  // name — derive from filename if missing (handles plain .md repos)
  if (!data.name) {
    warnings.push('Missing frontmatter "name" — derived from filename');
  } else if (typeof data.name !== 'string') {
    errors.push('Field "name" must be a string');
  } else if (!NAME_RE.test(data.name)) {
    warnings.push(`Invalid name "${data.name}" — will be derived from filename instead.`);
  }

  // description — derive from first paragraph if missing
  if (!data.description) {
    warnings.push('Missing frontmatter "description" — derived from content');
  } else if (typeof data.description !== 'string') {
    errors.push('Field "description" must be a string');
  } else if (data.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    warnings.push(`Description very short (${data.description.trim().length} chars).`);
  }

  // body must have real instruction content
  if (content && content.trim().length < MIN_CONTENT_LENGTH) {
    warnings.push('Body is very short — may lack actionable instructions.');
  }

  // security scan over the whole file
  for (const { re, msg } of DANGEROUS_PATTERNS) {
    if (re.test(raw)) {
      errors.push(`Security: ${msg}`);
    }
  }

  // junk filename heuristic
  const base = filePath.split(/[\\/]/).pop().toLowerCase();

  // path traversal check (must be an actual path component, not substring match)
  const pathParts = filePath.split(/[\\/]/);
  if (pathParts.includes('..')) {
    errors.push('Path traversal detected: file path contains ".."');
  }

  // extension whitelist — reject unexpected file types
  const ALLOWED_EXTENSIONS = new Set(['.md', '.json', '.yaml', '.yml', '.txt', '.js', '.ts', '.py', '.rs', '.toml']);
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    errors.push(`File extension "${ext}" not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
  }

  // binary content detection — must be valid UTF-8 with no null bytes
  if (raw.includes('\0')) {
    errors.push('File contains null bytes (binary content)');
  }

  if (['readme.md', 'changelog.md', 'license.md', 'contributing.md'].includes(base)) {
    warnings.push('Filename looks like a docs file, not a skill.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

const BUNDLE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

const GITHUB_REPO_RE = /^(https?:\/\/github\.com\/[\w.-]+\/[\w.-]+|[\w.-]+\/[\w.-]+)$/;

export function validateBundle(def) {
  const errors = [];
  const warnings = [];

  if (!def.id || typeof def.id !== 'string') {
    errors.push('Missing required field: id');
  } else if (!BUNDLE_ID_RE.test(def.id)) {
    errors.push(`Invalid id "${def.id}". Use lowercase, digits, hyphens (2-64 chars).`);
  }

  if (!def.name || typeof def.name !== 'string' || def.name.trim().length < 3) {
    errors.push('Missing or too short field: name (min 3 chars)');
  }

  if (!def.description || typeof def.description !== 'string' || def.description.trim().length < 15) {
    errors.push('Missing or too short field: description (min 15 chars)');
  }

  if (def.repo_url) {
    if (!GITHUB_REPO_RE.test(def.repo_url)) {
      errors.push(`Invalid repo_url "${def.repo_url}". Use "owner/repo" or a full GitHub URL.`);
    }
  } else {
    if (!Array.isArray(def.skills) || def.skills.length < 1) {
      errors.push('Field "skills" must be an array with at least 1 skill ID (or use repo_url instead)');
    } else {
      for (const s of def.skills) {
        if (typeof s !== 'string' || !BUNDLE_ID_RE.test(s)) {
          errors.push(`Invalid skill id in bundle: "${s}"`);
        }
      }
    }
  }

  if (def.tags && !Array.isArray(def.tags)) {
    errors.push('Field "tags" must be an array of strings');
  }

  if (def.skills?.length > 20) {
    warnings.push('Bundle has more than 20 skills — consider splitting into sub-bundles');
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function sanitizeExternalContent(content) {
  if (typeof content !== 'string') return ''
  let sanitized = content.replace(/\0/g, '')
  if (Buffer.byteLength(sanitized, 'utf8') > MAX_DOWNLOAD_SIZE) {
    sanitized = Buffer.from(sanitized, 'utf8').subarray(0, MAX_DOWNLOAD_SIZE).toString('utf8')
  }
  return sanitized
}

// CLI: node validator.js <file>
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node validator.js <skill.md>');
    process.exit(1);
  }
  const result = validateSkill(file);
  if (result.warnings.length) {
    console.log('⚠ Warnings:');
    result.warnings.forEach(w => console.log('  - ' + w));
  }
  if (result.ok) {
    console.log('✓ Skill is valid');
    process.exit(0);
  } else {
    console.log('✗ Validation failed:');
    result.errors.forEach(e => console.log('  - ' + e));
    process.exit(1);
  }
}
