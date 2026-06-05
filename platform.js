import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

const HOME = os.homedir();

export const PLATFORMS = {
  'claude-code': {
    name: 'Claude Code',
    configPath: path.join(HOME, '.claude', 'settings.json'),
    addMcp: (config, serverPath) => {
      const json = readJson(config.configPath);
      json.mcpServers = json.mcpServers || {};
      json.mcpServers.promptgraph = { command: 'npx', args: ['promptgraph-mcp'] };
      writeJson(config.configPath, json);
    },
  },
  'claude-desktop': {
    name: 'Claude Desktop',
    configPath: getClaudeDesktopConfig(),
    addMcp: (config, serverPath) => {
      const json = readJson(config.configPath);
      json.mcpServers = json.mcpServers || {};
      json.mcpServers.promptgraph = { command: 'npx', args: ['promptgraph-mcp'] };
      writeJson(config.configPath, json);
    },
  },
  'cline': {
    name: 'Cline (VS Code)',
    configPath: path.join(HOME, '.vscode', 'mcp.json'),
    addMcp: (config, serverPath) => {
      const json = readJson(config.configPath) || { servers: {} };
      json.servers = json.servers || {};
      json.servers.promptgraph = { command: 'npx', args: ['promptgraph-mcp'] };
      fs.mkdirSync(path.dirname(config.configPath), { recursive: true });
      writeJson(config.configPath, json);
    },
  },
  'codex': {
    name: 'OpenAI Codex CLI',
    configPath: path.join(HOME, '.codex', 'config.json'),
    addMcp: (config, serverPath) => {
      const json = readJson(config.configPath) || {};
      json.mcpServers = json.mcpServers || {};
      json.mcpServers.promptgraph = { command: 'npx', args: ['promptgraph-mcp'] };
      fs.mkdirSync(path.dirname(config.configPath), { recursive: true });
      writeJson(config.configPath, json);
    },
  },
  'cursor': {
    name: 'Cursor',
    configPath: path.join(HOME, '.cursor', 'mcp.json'),
    addMcp: (config, serverPath) => {
      const json = readJson(config.configPath) || { mcpServers: {} };
      json.mcpServers.promptgraph = { command: 'npx', args: ['promptgraph-mcp'] };
      fs.mkdirSync(path.dirname(config.configPath), { recursive: true });
      writeJson(config.configPath, json);
    },
  },
  'windsurf': {
    name: 'Windsurf',
    configPath: path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'),
    addMcp: (config, serverPath) => {
      const json = readJson(config.configPath) || { mcpServers: {} };
      json.mcpServers.promptgraph = { command: 'npx', args: ['promptgraph-mcp'] };
      fs.mkdirSync(path.dirname(config.configPath), { recursive: true });
      writeJson(config.configPath, json);
    },
  },
  'opencode': {
    name: 'OpenCode',
    configPath: getOpenCodeConfig(),
    addMcp: (config) => {
      const json = readJson(config.configPath) || {};
      json.mcp = json.mcp || {};
      json.mcp.promptgraph = {
        type: 'local',
        command: ['npx', 'promptgraph-mcp', 'mcp'],
        enabled: true,
      };
      fs.mkdirSync(path.dirname(config.configPath), { recursive: true });
      writeJson(config.configPath, json);
    },
  },
};

export function detectPlatforms() {
  return Object.entries(PLATFORMS)
    .filter(([id, p]) => {
      if (!p.configPath) return false;
      if (fs.existsSync(path.dirname(p.configPath))) return true;
      if (id === 'opencode') return isOpenCodeInstalled();
      return false;
    })
    .map(([id, p]) => ({ id, ...p }));
}

function isOpenCodeInstalled() {
  try {
    const r = spawnSync('opencode', ['--version'], { encoding: 'utf8', timeout: 3000 });
    return r.status === 0;
  } catch { return false; }
}

function getOpenCodeConfig() {
  if (process.platform === 'win32') {
    return path.join(HOME, 'AppData', 'Roaming', 'opencode', 'opencode.json');
  }
  if (process.platform === 'darwin') {
    return path.join(HOME, 'Library', 'Application Support', 'opencode', 'opencode.json');
  }
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
