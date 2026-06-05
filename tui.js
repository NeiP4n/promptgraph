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

const CAT_ICON = { Engineering:'🛠', 'AI Tools':'🤖', Coding:'💻', Creative:'🎨', Security:'🔒', Community:'🌐' };

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

function render(state) {
  const { cols, rows } = termSize();
  const HEADER_ROWS = 4;
  const FOOTER_ROWS = 3;
  const LIST_ROWS = rows - HEADER_ROWS - FOOTER_ROWS;

  const { items, cursor, scroll, query, searching, tab, status } = state;

  write(HOME);

  // ── header ─────────────────────────────────────────────────────────────────
  const title = purple.bold(' ◆ PromptGraph Marketplace ');
  const tabs = ['all', 'skills', 'bundles'].map(t =>
    t === tab ? cyan.bold(`[${t}]`) : dim(`[${t}]`)
  ).join(' ');
  write(truncate(title + ' '.repeat(4) + tabs, cols) + CLEAR_EOL + '\n');

  // search bar
  const searchLabel = searching ? green('/ ') : dim('/ ');
  const searchVal   = searching ? white(query) + (Math.floor(Date.now()/500)%2 ? '▌' : ' ') : dim(query || 'type / to search');
  write(' ' + searchLabel + truncate(searchVal, cols - 4) + CLEAR_EOL + '\n');

  const countLabel = dim(` ${items.length} items`);
  const hint = dim(status ? (status.ok ? green(' ✓ ' + status.msg) : red(' ✗ ' + status.msg)) : '');
  write(countLabel + hint + CLEAR_EOL + '\n');
  write(dim('─'.repeat(cols)) + CLEAR_EOL + '\n');

  // ── list ───────────────────────────────────────────────────────────────────
  let lastCat = null;
  let lineIdx = 0;
  let rendered = 0;

  for (let i = scroll; i < items.length && rendered < LIST_ROWS; i++) {
    const item = items[i];
    const selected = i === cursor;
    const bg = selected ? '\x1b[48;2;60;40;120m' : '';
    const reset = selected ? '\x1b[0m' : '';

    // category header
    if (item.category !== lastCat) {
      if (rendered >= LIST_ROWS) break;
      const icon = CAT_ICON[item.category] || '📦';
      write(bg + ' ' + purple(icon + '  ' + item.category) + reset + CLEAR_EOL + '\n');
      lastCat = item.category;
      rendered++;
    }

    if (rendered >= LIST_ROWS) break;

    // item row
    const sel   = selected ? cyan('▶') : ' ';
    const type  = item.type === 'bundle' ? blue('⊞') : dim('·');
    const name  = selected ? white.bold(item.name) : white(item.name);
    const stars = item.stars > 0 ? yellow('★' + item.stars) : dim('★0');
    const extra = item.type === 'bundle'
      ? (item.skillCount ? blue(item.skillCount + ' skills') : blue('GitHub'))
      : (item.code ? dim(item.code) : '');
    const desc  = dim(truncate(item.description, cols - 42));

    const left  = ` ${sel} ${type} ${truncate(item.name, 28).padEnd(28)} ${stars}  ${extra.padEnd(12)}`;
    write(bg + truncate(left, cols - desc.length - 2) + ' ' + desc + reset + CLEAR_EOL + '\n');
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
  if (sel && !searching) {
    const installCmd = sel.type === 'bundle' ? `bundle install ${sel.id}` : `install ${sel.code || sel.id}`;
    write(dim(` Enter`) + ' install  ' + dim('Tab') + ' switch  ' + dim('/') + ' search  ' + dim('q') + ' quit' + CLEAR_EOL + '\n');
    write(dim(` → pg ${installCmd}`) + CLEAR_EOL + '\n');
  } else if (searching) {
    write(dim(' Type to filter  ') + cyan('Enter') + dim(' confirm  ') + cyan('Esc') + dim(' cancel') + CLEAR_EOL + '\n');
    write(CLEAR_EOL + '\n');
  } else {
    write(dim(' ↑↓ navigate  Enter install  Tab switch  / search  q quit') + CLEAR_EOL + '\n');
    write(CLEAR_EOL + '\n');
  }
}

// ── clamp scroll ─────────────────────────────────────────────────────────────

function clampScroll(state) {
  const { rows } = termSize();
  const HEADER_ROWS = 4, FOOTER_ROWS = 3;
  const LIST_ROWS = rows - HEADER_ROWS - FOOTER_ROWS;
  const { cursor, items } = state;

  // ensure cursor visible — approximate (category headers add extra rows)
  if (cursor < state.scroll) state.scroll = cursor;
  if (cursor >= state.scroll + LIST_ROWS - 2) state.scroll = cursor - LIST_ROWS + 3;
  if (state.scroll < 0) state.scroll = 0;
  if (state.scroll >= items.length) state.scroll = Math.max(0, items.length - 1);
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function runTUI(allSkills, allBundles, installFn) {
  const allItems = buildItems(allSkills, allBundles);

  const state = {
    tab: 'all',
    query: '',
    searching: false,
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
    render(state);
  }

  // Setup terminal
  write(HIDE + CLEAR);
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
    render(state);
    statusTimer = setTimeout(() => { state.status = null; render(state); }, 3000);
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

    // Normal mode
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      cleanup();
      return;
    }

    if (key.name === 'slash' || ch === '/') {
      state.searching = true;
      render(state);
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
      render(state);
      return;
    }

    if (key.name === 'down') {
      if (state.cursor < state.items.length - 1) state.cursor++;
      clampScroll(state);
      render(state);
      return;
    }

    if (key.name === 'pageup') {
      state.cursor = Math.max(0, state.cursor - 10);
      clampScroll(state);
      render(state);
      return;
    }

    if (key.name === 'pagedown') {
      state.cursor = Math.min(state.items.length - 1, state.cursor + 10);
      clampScroll(state);
      render(state);
      return;
    }

    if (key.name === 'home') { state.cursor = 0; state.scroll = 0; render(state); return; }
    if (key.name === 'end')  { state.cursor = state.items.length - 1; clampScroll(state); render(state); return; }

    if (key.name === 'return' || key.name === 'i') {
      const sel = state.items[state.cursor];
      if (!sel || state.installing) return;
      state.installing = true;
      setStatus(null, `Installing ${sel.id}…`);
      try {
        await installFn(sel);
        setStatus(true, `Installed ${sel.id}`);
      } catch (e) {
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
  process.stdout.on('resize', () => { clampScroll(state); render(state); });

  // Keep alive
  return new Promise(resolve => {
    process.stdin.once('close', resolve);
    process.on('SIGINT', resolve);
  });
}
