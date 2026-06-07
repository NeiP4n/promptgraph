/**
 * Interactive marketplace TUI — nano-style keyboard navigation
 * Arrow keys, search, install, categories — all in one screen
 */
import readline from 'readline';
import chalk from 'chalk';
import process from 'process';

const ESC        = '\x1b';
const HIDE       = '\x1b[?25l';
const SHOW       = '\x1b[?25h';
const HOME       = '\x1b[H';
const CLEAR      = '\x1b[2J\x1b[H';
const CLEAR_EOL  = '\x1b[K';

const purple  = chalk.hex('#7C3AED');
const dim     = chalk.dim;
const bold    = chalk.bold;
const cyan    = chalk.cyan;
const yellow  = chalk.yellow;
const green   = chalk.green;
const red     = chalk.red;
const blue    = chalk.blue;
const white   = chalk.white;
const magenta = chalk.magenta;

const CAT_ICON = { Engineering:'🛠', 'AI Tools':'🤖', Coding:'💻', Creative:'🎨', Security:'🔒', Community:'🌐' };
const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']; // braille spinner

// ── helpers ──────────────────────────────────────────────────────────────────

function termSize() {
  return { cols: process.stdout.columns || 100, rows: process.stdout.rows || 30 };
}

function write(s) { process.stdout.write(s); }
function moveTo(row, col) { write(`\x1b[${row};${col}H`); }
function clearLine() { write('\x1b[2K\r'); }

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ── build item list ───────────────────────────────────────────────────────────

function buildItems(skills, bundles) {
  const items = [];
  // skills
  for (const s of skills) {
    items.push({ type: 'skill', id: s.id, name: s.name || s.id, description: s.description || '', category: s.category || 'Community', tags: s.tags || [], stars: s.stars || 0, code: s.code });
  }
  // bundles
  for (const b of bundles) {
    items.push({ type: 'bundle', id: b.id, name: b.name || b.id, description: b.description || '', category: b.category || 'Community', tags: b.tags || [], stars: b.stars || 0, skillCount: b.skillCount, repo_url: b.repo_url, skills: b.skills });
  }
  return items;
}

function filterItems(items, query, tab) {
  let filtered = items;
  if (tab === 'skills')  filtered = items.filter(i => i.type === 'skill');
  if (tab === 'bundles') filtered = items.filter(i => i.type === 'bundle');
  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter(i =>
      i.id.includes(q) || i.name.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.category.toLowerCase().includes(q) ||
      (i.tags || []).some(t => t.includes(q))
    );
  }
  return filtered;
}

// ── render ────────────────────────────────────────────────────────────────────

function render(state, installedSet = new Set()) {
  const { cols, rows } = termSize();
  const HEADER_ROWS = 4;
  const FOOTER_ROWS = 3;
  const LIST_ROWS = rows - HEADER_ROWS - FOOTER_ROWS;
  const NAME_W = Math.max(20, Math.floor(cols * 0.28));
  const DESC_W = cols - NAME_W - 28;

  const { items, cursor, scroll, query, searching, tab, status } = state;
  const skills  = items.filter(i => i.type === 'skill').length;
  const bundles = items.filter(i => i.type === 'bundle').length;

  write('\x1b[H'); // go home — screen already cleared on init, just reposition

  // ── header ─────────────────────────────────────────────────────────────────
  // Row 1: title bar
  const titleText = ' ◆ PromptGraph Marketplace';
  const tabParts = ['all', 'skills', 'bundles'].map(t =>
    t === tab
      ? `\x1b[48;2;124;58;237m\x1b[97m  ${t.toUpperCase()}  \x1b[0m`
      : dim(`  ${t}  `)
  ).join('');
  const titleLine = purple.bold(titleText) + '  ' + tabParts;
  write(titleLine + CLEAR_EOL + '\n');

  // Row 2: counts
  const countLine = dim('  ') +
    (tab !== 'bundles' ? chalk.white(`${skills} skills`) + dim('  ') : '') +
    (tab !== 'skills'  ? chalk.blue(`${bundles} bundles`) : '') +
    (query ? dim('  · filter: ') + cyan(query) : '');
  write(countLine + CLEAR_EOL + '\n');

  // Row 3: search bar
  const searchLabel = searching ? green('  / ') : dim('  / ');
  const cursor_blink = Math.floor(Date.now() / 500) % 2 ? '▌' : ' ';
  const searchVal = searching
    ? white(query || '') + cursor_blink
    : dim(query ? query : 'type / to search, Tab to switch view');
  write(searchLabel + searchVal + CLEAR_EOL + '\n');

  // Row 4: separator (with optional status inline or spinner)
  if (state.installing) {
    const frame = SPINNER_FRAMES[Math.floor(Date.now() / 120) % SPINNER_FRAMES.length];
    write(dim('─'.repeat(4)) + magenta(` ${frame} Installing… `) + CLEAR_EOL + '\n');
  } else if (status) {
    const msg = status.ok ? green(' ✓ ' + status.msg) : red(' ✗ ' + status.msg);
    write(dim('─'.repeat(4)) + msg + CLEAR_EOL + '\n');
  } else {
    write(dim('─'.repeat(cols)) + CLEAR_EOL + '\n');
  }

  // ── list ───────────────────────────────────────────────────────────────────
  let lastCat = null;
  let rendered = 0;

  for (let i = scroll; i < items.length && rendered < LIST_ROWS; i++) {
    const item = items[i];
    const selected = i === cursor;
    const bg    = selected ? '\x1b[48;2;55;35;110m' : '';
    const reset = '\x1b[0m';

    // category header (only when ungrouped / mixed)
    if (item.category !== lastCat) {
      if (rendered >= LIST_ROWS) break;
      const icon = CAT_ICON[item.category] || '📦';
      write((selected ? bg : '') + '  ' + purple.bold(icon + '  ' + item.category) + reset + CLEAR_EOL + '\n');
      lastCat = item.category;
      rendered++;
      if (rendered >= LIST_ROWS) break;
    }

    // item row
    const isInstalled = installedSet.has(item.id) || (item.code && installedSet.has(item.code));
    const arrow   = selected ? cyan('▶') : ' ';
    const type    = item.type === 'bundle' ? blue('⊞') : dim('·');
    const badge   = isInstalled ? green('✓') : ' ';
    const nameStr = truncate(item.name, NAME_W);
    const namePad = nameStr.padEnd(NAME_W);
    const nameCol = selected ? white.bold(namePad) : white(namePad);
    const extra = item.type === 'bundle'
      ? item.skillCount
        ? blue((item.skillCount + ' sk').padEnd(8))
        : item.repo_url
          ? chalk.hex('#3B82F6')('↗ GitHub')
          : dim(((item.skills?.length || 0) + ' sk').padEnd(8))
      : chalk.hex('#A78BFA')((item.code || '').padEnd(10));
    const desc = dim(truncate(item.description, Math.max(10, DESC_W)));

    write(bg + `  ${arrow} ${type} ${badge} ${nameCol}  ${extra}  ${desc}` + reset + CLEAR_EOL + '\n');
    rendered++;
  }

  // fill empty rows
  while (rendered < LIST_ROWS) {
    write(CLEAR_EOL + '\n');
    rendered++;
  }

  // ── footer ─────────────────────────────────────────────────────────────────
  write(dim('─'.repeat(cols)) + CLEAR_EOL + '\n');
  const sel = items[cursor];
  if (sel && !searching && !state.confirming) {
    const isInst = installedSet.has(sel.id) || (sel.code && installedSet.has(sel.code));
    const installCmd = sel.type === 'bundle' ? `bundle install ${sel.id}` : `install ${sel.code || sel.id}`;
    const instLabel = isInst
      ? green(' ✓ installed') + dim('  ') + dim('d') + chalk.red(' remove') + dim('  ')
      : dim(' Enter') + chalk.white(' install') + dim('  ');
    write(instLabel + dim('Tab') + ' switch  ' + dim('/') + ' search  ' + dim('q') + ' quit' + CLEAR_EOL + '\n');
    const ghUrl = sel.repo_url ? chalk.hex('#3B82F6')(`  ↗ github.com/${sel.repo_url}`) : '';
    write(dim(` → pg ${installCmd}`) + ghUrl + CLEAR_EOL + '\n');
  } else if (state.confirming) {
    write(chalk.red.bold(' Remove ') + chalk.white(state.confirming.name) + chalk.red('? ') +
      chalk.white.bold('[y]') + chalk.gray('es  ') + chalk.white.bold('[n]') + chalk.gray('o') + CLEAR_EOL + '\n');
    write(CLEAR_EOL + '\n');
  } else if (searching) {
    write(dim(' Type to filter  ') + cyan('Enter') + dim(' confirm  ') + cyan('Esc') + dim(' cancel') + CLEAR_EOL + '\n');
    write(CLEAR_EOL + '\n');
  } else {
    write(dim(' ↑↓ navigate  Enter install  d remove  Tab switch  / search  q quit') + CLEAR_EOL + '\n');
    write(CLEAR_EOL + '\n');
  }
}

// ── clamp scroll ─────────────────────────────────────────────────────────────

// Count how many screen rows items[start..end] occupy (including category headers)
function countVisibleRows(items, start, end) {
  let rows = 0;
  let lastCat = start > 0 ? items[start - 1]?.category : null;
  for (let i = start; i < end && i < items.length; i++) {
    if (items[i].category !== lastCat) { rows++; lastCat = items[i].category; }
    rows++;
  }
  return rows;
}

function clampScroll(state) {
  const { rows } = termSize();
  const HEADER_ROWS = 4, FOOTER_ROWS = 3;
  const LIST_ROWS = rows - HEADER_ROWS - FOOTER_ROWS;
  const { cursor, items } = state;

  if (state.scroll < 0) state.scroll = 0;
  if (state.scroll > cursor) state.scroll = cursor;

  // Check if cursor is visible from current scroll
  const visibleRows = countVisibleRows(items, state.scroll, cursor + 1);
  if (visibleRows > LIST_ROWS - 1) {
    // Cursor is below visible area — scroll forward until it fits
    while (state.scroll < cursor) {
      state.scroll++;
      const v = countVisibleRows(items, state.scroll, cursor + 1);
      if (v <= LIST_ROWS - 1) break;
    }
  }

  if (state.scroll >= items.length) state.scroll = Math.max(0, items.length - 1);
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function runTUI(allSkills, allBundles, installFn, installedSet = new Set(), removeFn = async () => {}) {
  const allItems = buildItems(allSkills, allBundles);

  const state = {
    tab: 'all',
    query: '',
    searching: false,
    confirming: null, // { id, name, type, repoUrl }
    cursor: 0,
    scroll: 0,
    items: allItems,
    status: null,
    installing: false,
  };

  function refresh(q, t) {
    state.items = filterItems(allItems, q ?? state.query, t ?? state.tab);
    if (state.cursor >= state.items.length) state.cursor = Math.max(0, state.items.length - 1);
    clampScroll(state);
    render(state, installedSet);
  }

  // Setup terminal
  write(HIDE + CLEAR + '\x1b[H\x1b[J');
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  function cleanup() {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    write(SHOW + CLEAR);
    process.stdin.pause();
  }

  process.on('SIGINT', cleanup);
  process.on('exit', cleanup);

  // Initial render
  refresh();

  // Status blink timer
  let statusTimer = null;
  function setStatus(ok, msg) {
    state.status = { ok, msg };
    clearTimeout(statusTimer);
    render(state, installedSet);
    statusTimer = setTimeout(() => { state.status = null; render(state, installedSet); }, 3000);
  }

  // Keypress handler
  process.stdin.on('keypress', async (ch, key) => {
    if (!key) return;

    if (state.searching) {
      if (key.name === 'escape') {
        state.searching = false;
        state.query = '';
        refresh();
      } else if (key.name === 'return') {
        state.searching = false;
        refresh();
      } else if (key.name === 'backspace') {
        state.query = state.query.slice(0, -1);
        refresh();
      } else if (ch && !key.ctrl && !key.meta && ch.length === 1) {
        state.query += ch;
        refresh();
      }
      return;
    }

    // Confirm-delete mode
    if (state.confirming) {
      if (ch === 'y' || ch === 'Y') {
        const item = state.confirming;
        state.confirming = null;
        setStatus(null, `Removing ${item.name}…`);
        try {
          await removeFn(item);
          installedSet.delete(item.id);
          if (item.code) installedSet.delete(item.code);
          setStatus(true, `Removed ${item.name}`);
        } catch (e) {
          setStatus(false, e.message.slice(0, 60));
        }
      } else {
        state.confirming = null;
        render(state, installedSet);
      }
      return;
    }

    // Normal mode
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      cleanup();
      return;
    }

    if (key.name === 'slash' || ch === '/') {
      state.searching = true;
      render(state, installedSet);
      return;
    }

    if (key.name === 'tab') {
      const tabs = ['all', 'skills', 'bundles'];
      state.tab = tabs[(tabs.indexOf(state.tab) + 1) % tabs.length];
      state.cursor = 0;
      state.scroll = 0;
      refresh(state.query, state.tab);
      return;
    }

    if (key.name === 'up') {
      if (state.cursor > 0) state.cursor--;
      clampScroll(state);
      render(state, installedSet);
      return;
    }

    if (key.name === 'down') {
      if (state.cursor < state.items.length - 1) state.cursor++;
      clampScroll(state);
      render(state, installedSet);
      return;
    }

    if (key.name === 'pageup') {
      state.cursor = Math.max(0, state.cursor - 10);
      clampScroll(state);
      render(state, installedSet);
      return;
    }

    if (key.name === 'pagedown') {
      state.cursor = Math.min(state.items.length - 1, state.cursor + 10);
      clampScroll(state);
      render(state, installedSet);
      return;
    }

    if (key.name === 'home') { state.cursor = 0; state.scroll = 0; render(state, installedSet); return; }
    if (key.name === 'end')  { state.cursor = state.items.length - 1; clampScroll(state); render(state, installedSet); return; }

    if (ch === 'd' || ch === 'D') {
      const sel = state.items[state.cursor];
      if (!sel) return;
      const isInst = installedSet.has(sel.id) || (sel.code && installedSet.has(sel.code));
      if (!isInst) { setStatus(false, 'Not installed'); return; }
      state.confirming = { id: sel.id, name: sel.name, type: sel.type, code: sel.code, repo_url: sel.repo_url };
      render(state, installedSet);
      return;
    }

    if (key.name === 'return' || key.name === 'i') {
      const sel = state.items[state.cursor];
      if (!sel || state.installing) return;
      state.installing = true;
      // Live spinner — keeps rendering during long installs
      const spinInterval = setInterval(() => render(state, installedSet), 120);
      render(state, installedSet);
      try {
        await installFn(sel);
        clearInterval(spinInterval);
        setStatus(true, `Installed ${sel.id}`);
      } catch (e) {
        clearInterval(spinInterval);
        setStatus(false, e.message.slice(0, 60));
      } finally {
        state.installing = false;
      }
      return;
    }

    if (key.name === 'escape') {
      state.query = '';
      refresh();
      return;
    }
  });

  // Resize handler
  process.stdout.on('resize', () => { clampScroll(state); render(state, installedSet); });

  // Keep alive
  return new Promise(resolve => {
    process.stdin.once('close', resolve);
    process.on('SIGINT', resolve);
  });
}
