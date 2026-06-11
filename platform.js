import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

const HOME = os.homedir();

const STD_ENTRY = { command: 'npx', args: ['promptgraph-mcp'] };
const OC_ENTRY  = process.platform === 'win32'
  ? { type: 'local', command: ['cmd', '/c', 'npx', 'promptgraph-mcp'], enabled: true }
  : { type: 'local', command: ['npx', 'promptgraph-mcp'], enabled: true };

// Shared helper: write standard mcpServers entry (Claude Code, Cursor, Windsurf, Codex format)
function addStdMcp(configPath) {
  const json = readJson(configPath) || {};
  json.mcpServers = json.mcpServers || {};
  json.mcpServers.promptgraph = STD_ENTRY;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  writeJson(configPath, json);
}

// Cline uses servers.promptgraph (not mcpServers)
function addClineMcp(configPath) {
  const json = readJson(configPath) || {};
  json.servers = json.servers || {};
  json.servers.promptgraph = STD_ENTRY;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  writeJson(configPath, json);
}

// OpenCode uses mcp.promptgraph object
function addOpenCodeMcp(configPath) {
  const json = readJson(configPath) || {};
  json.mcp = json.mcp || {};
  if (!json.mcp.promptgraph) {
    json.mcp.promptgraph = OC_ENTRY;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    writeJson(configPath, json);
  }
}

// `verified: true` means the MCP config format + skills dir were actually tested
// on that platform. Unverified entries are best-effort (config path/format may be
// wrong) — `pg setup` warns before writing so we never imply false support.
export const PLATFORMS = {
  'claude-code': {
    name: 'Claude Code',
    configPath: path.join(HOME, '.claude', 'settings.json'),
    addMcp: (config) => addStdMcp(config.configPath),
    verified: true,
  },
  'opencode': {
    name: 'OpenCode',
    configPath: getOpenCodeConfig(),
    addMcp: (config) => addOpenCodeMcp(config.configPath),
    verified: true,
  },
  'claude-desktop': {
    name: 'Claude Desktop',
    configPath: getClaudeDesktopConfig(),
    addMcp: (config) => addStdMcp(config.configPath),
    verified: true,
  },
  'cline': {
    name: 'Cline (VS Code)',
    configPath: path.join(HOME, '.vscode', 'mcp.json'),
    addMcp: (config) => addClineMcp(config.configPath),
    verified: false,
  },
  'codex': {
    name: 'OpenAI Codex CLI',
    configPath: path.join(HOME, '.codex', 'config.json'),
    addMcp: (config) => addStdMcp(config.configPath),
    verified: false,
  },
  'cursor': {
    name: 'Cursor',
    configPath: path.join(HOME, '.cursor', 'mcp.json'),
    addMcp: (config) => addStdMcp(config.configPath),
    verified: false,
  },
  'windsurf': {
    name: 'Windsurf',
    configPath: path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'),
    addMcp: (config) => addStdMcp(config.configPath),
    verified: false,
  },
};

export function detectPlatforms() {
  return Object.entries(PLATFORMS)
    .filter(([id, p]) => {
      if (!p.configPath) return false;
      if (fs.existsSync(path.dirname(p.configPath))) return true;
      if (id === 'opencode') return isOpenCodeInstalled();
      if (id === 'claude-code') return isClaudeCodeInstalled();
      return false;
    })
    .map(([id, p]) => ({ id, ...p }));
}

function isBinaryInstalled(bin) {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const r = spawnSync(cmd, [bin], { encoding: 'utf8', timeout: 3000, stdio: 'pipe' });
    return r.status === 0 && r.stdout.trim().length > 0;
  } catch { return false; }
}

function isOpenCodeInstalled() {
  return isBinaryInstalled('opencode') || isBinaryInstalled('OpenCode');
}
function isClaudeCodeInstalled() { return isBinaryInstalled('claude'); }

function getOpenCodeConfig() {
  if (process.platform === 'win32') return path.join(HOME, '.config', 'opencode', 'opencode.json');
  if (process.platform === 'darwin') return path.join(HOME, 'Library', 'Application Support', 'opencode', 'opencode.json');
  return path.join(HOME, '.config', 'opencode', 'opencode.json');
}

function getClaudeDesktopConfig() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || '';
    const packages = path.join(base, 'Packages');
    if (fs.existsSync(packages)) {
      const claudeDir = fs.readdirSync(packages).find(d => d.startsWith('Claude_'));
      if (claudeDir) return path.join(packages, claudeDir, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
    }
  }
  if (process.platform === 'darwin') return path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return path.join(HOME, '.config', 'Claude', 'claude_desktop_config.json');
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return {}; }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
