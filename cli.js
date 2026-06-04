import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';

export const colors = {
  primary: chalk.hex('#7C3AED'),
  success: chalk.hex('#10B981'),
  warning: chalk.hex('#F59E0B'),
  error: chalk.hex('#EF4444'),
  muted: chalk.hex('#6B7280'),
  white: chalk.white,
  bold: chalk.bold,
};

export function banner() {
  console.log(
    boxen(
      colors.primary.bold('PromptGraph') + '  ' + colors.muted('v' + (await getVersion())) + '\n' +
      colors.muted('Semantic skill router for Claude Code'),
      {
        padding: { top: 0, bottom: 0, left: 2, right: 2 },
        borderStyle: 'round',
        borderColor: '#7C3AED',
        dimBorder: true,
      }
    )
  );
}

async function getVersion() {
  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    return require('./package.json').version;
  } catch { return ''; }
}

export function spinner(text) {
  return ora({
    text: colors.muted(text),
    spinner: 'dots',
    color: 'magenta',
  });
}

export function success(msg) {
  console.log(colors.success('✓') + ' ' + msg);
}

export function error(msg) {
  console.log(colors.error('✗') + ' ' + msg);
}

export function info(msg) {
  console.log(colors.muted('·') + ' ' + msg);
}

export function section(title) {
  console.log('\n' + colors.primary.bold(title));
}

export function progress(current, total, extra = '') {
  const pct = Math.round(current / total * 100);
  const bar = buildBar(pct);
  process.stdout.write(
    `\r  ${bar} ${colors.white.bold(pct + '%')} ${colors.muted(current + '/' + total)} ${colors.muted(extra)}  `
  );
}

function buildBar(pct) {
  const width = 20;
  const filled = Math.round(pct / 100 * width);
  const empty = width - filled;
  return colors.primary('█'.repeat(filled)) + colors.muted('░'.repeat(empty));
}

export function table(rows) {
  if (!rows.length) { info('No results'); return; }
  const cols = Object.keys(rows[0]);
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const header = cols.map((c, i) => colors.muted(c.toUpperCase().padEnd(widths[i]))).join('  ');
  const divider = colors.muted(widths.map(w => '─'.repeat(w)).join('  '));
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
