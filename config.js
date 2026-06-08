import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
export const PROMPTGRAPH_DIR = path.join(CLAUDE_DIR, '.promptgraph');
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

function makeDefaults(skillsDir) {
  const base = skillsDir || path.join(CLAUDE_DIR, 'skills-store');
  return {
    skillsDir: base,
    sources: [
      { dir: base, source: 'skills-store' },
      { dir: path.join(base, 'marketplace'), source: 'marketplace' },
      { dir: path.join(CLAUDE_DIR, 'skills'),   source: 'skills' },
      { dir: path.join(CLAUDE_DIR, 'commands'), source: 'commands' },
    ],
  };
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
  const config = makeDefaults(skillsDir);
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
