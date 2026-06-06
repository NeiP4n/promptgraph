import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const PROMPTGRAPH_DIR = path.join(CLAUDE_DIR, '.promptgraph');
export const SKILLS_STORE_DIR = path.join(CLAUDE_DIR, 'skills-store');
const CONFIG_PATH = path.join(PROMPTGRAPH_DIR, 'config.json');

export const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024  // 50 MB per file
export const MAX_FILE_COUNT = 50000                  // max files per repo
export const MAX_REPO_SIZE = 500 * 1024 * 1024      // 500 MB per repo
export const RATE_LIMIT_REQUESTS = 30               // requests per window
export const RATE_LIMIT_WINDOW_MS = 60000           // 1 minute window
export const BATCH_SIZE = 100                       // batch indexing size

const DEFAULTS = {
  sources: [
    { dir: path.join(CLAUDE_DIR, 'skills-store'), source: 'skills-store' },
    { dir: path.join(CLAUDE_DIR, 'skills'),    source: 'skills' },
    { dir: path.join(CLAUDE_DIR, 'commands'),  source: 'commands' },
  ],
};


export function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  return JSON.parse(JSON.stringify(DEFAULTS));
}

export function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function promptConfig() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(r => rl.question(q, r));

  console.log('\n=== PromptGraph Setup ===\n');
  console.log('Default skill directories:');
  DEFAULTS.sources.forEach((s, i) => console.log(`  ${i + 1}. ${s.dir}`));

  const extra = await ask('\nAdd extra skill directories? (comma-separated paths, or press Enter to skip): ');
  rl.close();

  const config = structuredClone(DEFAULTS);

  if (extra.trim()) {
    const extraDirs = extra.split(',').map(d => d.trim()).filter(Boolean);
    for (const dir of extraDirs) {
      const base = path.basename(path.resolve(dir));
      const existing = config.sources.filter(s => s.source === `custom:${base}`);
      const tag = existing.length === 0 ? `custom:${base}` : `custom:${base}-${existing.length}`;
      config.sources.push({ dir, source: tag });
    }
  }

  saveConfig(config);
  console.log(`\nConfig saved to ${CONFIG_PATH}`);
  return config;
}

export function sanitizePath(inputPath) {
  if (inputPath.includes('..')) {
    throw new Error(`Path traversal blocked: "${inputPath}"`);
  }
  return path.resolve(inputPath);
}
