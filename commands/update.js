import { colors, banner, success, error, info, section, table } from '../cli.js';
import chalk from 'chalk';

export default async function handler(args, bin) {
  const { spawnSync } = await import('child_process');
  const { createRequire } = await import('module');
  const https = (await import('https')).default;
  const req = createRequire(import.meta.url);
  const currentVersion = req('../package.json').version;

  const spin = (await import('../cli.js')).spinner('Checking latest version...');
  spin.start();
  let latest = null;
  try {
    latest = await new Promise((res, rej) => {
      const r = https.get('https://registry.npmjs.org/promptgraph-mcp/latest',
        { headers: { Accept: 'application/json' }, timeout: 8000, family: 4 },
        (resp) => {
          let d = ''; resp.setEncoding('utf8');
          resp.on('data', c => d += c);
          resp.on('end', () => { try { res(JSON.parse(d).version); } catch { rej(new Error('bad response')); } });
        }
      );
      r.on('error', rej);
      r.on('timeout', () => { r.destroy(new Error('timeout')); });
    });
  } catch {}
  spin.stop();

  if (!latest) { error('Could not reach npm registry. Check your network.'); process.exit(1); }
  if (latest === currentVersion) {
    success(`Already on latest version ${chalk.white.bold('v' + currentVersion)}`);
    process.exit(0);
  }

  info(`Current: ${chalk.gray('v' + currentVersion)}  →  Latest: ${chalk.white.bold('v' + latest)}`);

  // Kill other promptgraph node processes that may lock native .node files
  if (process.platform === 'win32') {
    // taskkill is reliable on Windows 10/11 (wmic deprecated since Win11 22H2)
    spawnSync('taskkill', ['/F', '/FI', `PID ne ${process.pid}`, '/FI', 'IMAGENAME eq node.exe'], { stdio: 'ignore', shell: true });
  } else {
    spawnSync('pkill', ['-f', 'promptgraph-mcp'], { stdio: 'ignore' });
  }

  // Brief pause so OS releases file locks before npm touches them
  await new Promise(r => setTimeout(r, 1500));

  const updateSpin = (await import('../cli.js')).spinner(`Installing promptgraph-mcp@latest (v${latest})...`);
  updateSpin.start();

  let result = spawnSync('npm', ['install', '-g', 'promptgraph-mcp@latest'], { encoding: 'utf8', stdio: 'pipe', shell: true });

  // EBUSY: MCP server may have been re-spawned by the editor — retry once with --force
  if (result.status !== 0 && (result.stderr || '').includes('EBUSY')) {
    updateSpin.stop();
    info('File busy (MCP server still running). Close Claude Code / your editor and press Enter to retry, or Ctrl+C to cancel.');
    await new Promise(r => process.stdin.once('data', r));
    updateSpin.start();
    result = spawnSync('npm', ['install', '-g', 'promptgraph-mcp@latest', '--force'], { encoding: 'utf8', stdio: 'pipe', shell: true });
  }

  updateSpin.stop();

  if (result.status !== 0) {
    error('Update failed:');
    console.log(chalk.gray(result.stderr || result.stdout));
    process.exit(1);
  }
  success(`Updated to ${chalk.white.bold('v' + latest)}`);
  process.exit(0);
}
