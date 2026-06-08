import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import fs from 'fs';

export const colors = {
  primary: chalk.hex('#7C3AED'),
  success: chalk.hex('#10B981'),
  warning: chalk.hex('#F59E0B'),
  error: chalk.hex('#EF4444'),
  muted: chalk.hex('#6B7280'),
  white: chalk.white,
  bold: chalk.bold,
};

function getVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    return pkg.version;
  } catch { return ''; }
}

export function banner() {
  console.log(
    boxen(
      colors.primary.bold('PromptGraph') + '  ' + colors.muted('v' + getVersion()) + '\n' +
      colors.muted('Semantic skill router for Claude Code'),
      { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: '#7C3AED', dimBorder: true }
    )
  );
}

export function spinner(text) {
  return ora({ text: colors.muted(text), spinner: 'dots', color: 'magenta' });
}

// Full clear including scrollback (console.clear leaves scrollback on Windows)
export function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

export function success(msg) {
  console.log('\n' + colors.success('✓') + '  ' + msg);
}

export function error(msg) {
  console.log(colors.error('✗') + '  ' + msg);
}

export function info(msg) {
  console.log(colors.muted('  ' + msg));
}

export function section(title) {
  console.log('\n' + colors.primary.bold(title));
}

let _progressActive = false;

export function progress(current, total, { skipped = 0, eta = '?', errors = 0 } = {}) {
  const pct = Math.round(current / total * 100);
  const bar = buildBar(pct);

  const stats = [
    colors.white.bold(String(pct).padStart(3) + '%'),
    colors.muted(current + '/' + total),
    skipped > 0 ? colors.muted('skip ' + skipped) : '',
    errors > 0 ? colors.error('err ' + errors) : '',
    eta !== '?' && eta > 0 ? colors.muted('eta ' + formatTime(eta)) : eta === '?' ? colors.muted('scanning...') : '',
  ].filter(Boolean).join('  ');

  process.stdout.write('\r  ' + bar + '  ' + stats + '   ');
  _progressActive = true;
}

export function progressDone() {
  if (_progressActive) {
    process.stdout.write('\n');
    _progressActive = false;
  }
}

function buildBar(pct) {
  const width = 24;
  const filled = Math.round(pct / 100 * width);
  const empty = width - filled;
  return colors.primary('█'.repeat(filled)) + colors.muted('░'.repeat(empty));
}

function formatTime(seconds) {
  if (seconds < 60) return seconds + 's';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + 'm ' + s + 's';
}

export function table(rows) {
  if (!rows.length) { info('No results'); return; }
  const cols = Object.keys(rows[0]);
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const header = cols.map((c, i) => colors.muted(c.toUpperCase().padEnd(widths[i]))).join('  ');
  const divider = colors.muted(widths.map(w => '─'.repeat(w)).join('──'));
  console.log('\n' + header);
  console.log(divider);
  for (const row of rows) {
    const line = cols.map((c, i) => {
      const val = String(row[c] ?? '');
      if (c === 'score' || c === 'rating') return colors.primary(val.padEnd(widths[i]));
      if (c === 'name') return colors.white.bold(val.padEnd(widths[i]));
      return colors.muted(val.padEnd(widths[i]));
    }).join('  ');
    console.log(line);
  }
  console.log();
}
