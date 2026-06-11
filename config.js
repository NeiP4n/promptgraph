import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');

// Data dir (config/db/index) is platform-neutral at ~/.promptgraph so non-Claude
// users (opencode/cursor/…) don't get a stray ~/.claude folder. Existing Claude
// installs keep using ~/.claude/.promptgraph so their index isn't orphaned.
const LEGACY_PG_DIR = path.join(CLAUDE_DIR, '.promptgraph');
const NEUTRAL_PG_DIR = path.join(HOME, '.promptgraph');
export const PROMPTGRAPH_DIR = fs.existsSync(LEGACY_PG_DIR) ? LEGACY_PG_DIR : NEUTRAL_PG_DIR;
const CONFIG_PATH = path.join(PROMPTGRAPH_DIR, 'config.json');

export const PLATFORM_SKILLS_DIRS = {
  'claude-code':    path.join(HOME, '.claude', 'skills-store'),
  'claude-desktop': path.join(HOME, '.claude', 'skills-store'),
  'opencode':       path.join(HOME, '.config', 'opencode', 'skills'),
  'cursor':         path.join(HOME, '.cursor', 'skills'),
  'windsurf':       path.join(HOME, '.codeium', 'windsurf', 'skills'),
  'cline':          path.join(HOME, '.vscode', 'skills'),
  'codex':          path.join(HOME, '.codex', 'skills'),
};

export function getSkillsStoreDir(config) {
  const cfg = config || loadConfig();
  if (cfg.skillsDir) return cfg.skillsDir;
  return path.join(CLAUDE_DIR, 'skills-store');
}

export const SKILLS_STORE_DIR = path.join(CLAUDE_DIR, 'skills-store');

export const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024  // 50 MB per file
export const MAX_FILE_COUNT = 50000                  // max files per repo
export const MAX_REPO_SIZE = 500 * 1024 * 1024      // 500 MB per repo
export const RATE_LIMIT_REQUESTS = 30               // requests per window
export const RATE_LIMIT_WINDOW_MS = 60000           // 1 minute window
export const BATCH_SIZE = 100                       // batch indexing size

function makeDefaults(skillsDir, platform) {
  const base = skillsDir || path.join(CLAUDE_DIR, 'skills-store');
  const sources = [
    { dir: base, source: 'skills-store' },
    { dir: path.join(base, 'marketplace'), source: 'marketplace' },
  ];
  // Claude-specific dirs (~/.claude/skills, ~/.claude/commands) only on Claude
  // platforms — otherwise an opencode/cursor user would index (and create) ~/.claude.
  const isClaude = !platform || platform.startsWith('claude');
  if (isClaude) {
    sources.push({ dir: path.join(CLAUDE_DIR, 'skills'),   source: 'skills' });
    sources.push({ dir: path.join(CLAUDE_DIR, 'commands'), source: 'commands' });
  }
  return { skillsDir: base, sources };
}


export function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  return JSON.parse(JSON.stringify(makeDefaults()));
}

export function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function promptConfig() {
  const config = makeDefaults();
  saveConfig(config);
  return config;
}

export function setupForPlatform(platformId) {
  const skillsDir = PLATFORM_SKILLS_DIRS[platformId] || path.join(CLAUDE_DIR, 'skills-store');
  const existing = loadConfig();
  const config = makeDefaults(skillsDir, platformId);
  config.platform = platformId;
  // preserve any custom sources the user added
  if (existing.sources) {
    for (const s of existing.sources) {
      if (s.source && s.source.startsWith('custom:') && !config.sources.find(x => x.dir === s.dir)) {
        config.sources.push(s);
      }
    }
  }
  saveConfig(config);
  return config;
}

export function sanitizePath(inputPath) {
  if (inputPath.includes('..')) {
    throw new Error(`Path traversal blocked: "${inputPath}"`);
  }
  return path.resolve(inputPath);
}
