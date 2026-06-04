import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const CONFIG_PATH = path.join(os.homedir(), '.claude', '.promptgraph', 'config.json');

const DEFAULTS = {
  sources: [
    { dir: path.join(os.homedir(), '.claude', 'skills-store'), source: 'skills-store' },
    { dir: path.join(os.homedir(), '.claude', 'skills'), source: 'skills' },
    { dir: path.join(os.homedir(), '.claude', 'commands'), source: 'commands' },
  ],
};

export function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  // deep copy to avoid mutating DEFAULTS
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
      config.sources.push({ dir, source: 'custom' });
    }
  }

  saveConfig(config);
  console.log(`\nConfig saved to ${CONFIG_PATH}`);
  return config;
}
