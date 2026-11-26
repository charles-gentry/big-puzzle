import { generatePuzzle } from './generator.js';
import { buildModel } from './puzzle.js';
import { parsePuzzlePhotos } from './ai.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const STORE_GAME = 'bigpuzzle.game.v1';
const STORE_SETTINGS = 'bigpuzzle.settings.v1';

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/* ================= Settings ================= */
const DEFAULTS = { scale: 1.2, theme: 'light', keyboard: 'qwerty', speak: false, mistakes: false, tipSeen: false };
const settings = { ...DEFAULTS, ...load(STORE_SETTINGS, {}) };
const SCALE_MIN = 0.8, SCALE_MAX = 2.4, SCALE_STEP = 0.15;

function applySettings() {
  document.documentElement.style.setProperty('--scale', settings.scale);
  document.documentElement.dataset.theme = settings.theme;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fffaf0';
  save(STORE_SETTINGS, settings);
  if (game) { buildKeyboard(); requestAnimationFrame(layoutGrid); }
}
function changeSize(delta) {
  const next = Math.round((settings.scale + delta * SCALE_STEP) * 100) / 100;
  settings.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, next));
  applySettings();
  if (sheetKind === 'settings') renderSettings();
}

/* ================= Screens & history ================= */
let current = 'home';
function show(name, { push = true } = {}) {
  $$('.screen').forEach(s => { s.hidden = s.dataset.screen !== name; });
  current = name;
  if (push) history.pushState({ screen: name }, '', '#' + name);
  window.scrollTo(0, 0);
  if (name === 'home') refreshHome();
  if (name === 'play') requestAnimationFrame(() => { layoutGrid(); render(); });
}
window.addEventListener('popstate', e => {
  if (!$('#sheet').hidden) { closeSheet(); history.pushState({ screen: current }, '', '#' + current); return; }
  let s = e.state?.screen || 'home';
  if (s === 'loading') s = 'photo';
  if (s === 'play' && !game) s = 'home';
  show(s, { push: false });
});

function refreshHome() {
  const saved = load(STORE_GAME, null);
  const btn = $('#btn-continue');
  if (saved?.data) {
    const filled = saved.entries.flat().filter(Boolean).length;
    const total = saved.data.grid.join('').replace(/#/g, '').length;
    $('#continue-detail').textContent = `${saved.data.title} · ${filled} of ${total} squares filled`;
    btn.hidden = false;
  } else btn.hidden = true;
}

/* ================= Game state ================= */
let game = null; // { data, model, entries, wi, pos, revealed }

function startGame(data, saved) {
  const model = buildModel(data);
  game = {
    data, model,
    entries: saved?.entries || model.cells.map(row => row.map(() => '')),
    revealed: saved?.revealed || model.cells.map(row => row.map(() => false)),
    wi: saved?.wi ?? 0,
    pos: saved?.pos ?? 0,
    finished: saved?.finished || false,
  };
  if (!model.words[game.wi]) { game.wi = 0; game.pos = 0; }
  $('#btn-hint').hidden = !model.hasSolution;
  buildGrid();
  buildKeyboard();
  persist();
  show('play');
  speakClue();
}
function persist() {
  if (!game) return;
  const { data, entries, revealed, wi, pos, finished } = game;
  save(STORE_GAME, { data, entries, revealed, wi, pos, finished });
}
const word = () => game.model.words[game.wi];
const cellAt = (r, c) => game.model.cells[r][c];
const isWrong = (r, c) => {
  const sol = cellAt(r, c).sol, v = game.entries[r][c];
  return Boolean(sol && v && v !== sol);
};

/* ================= Grid ================= */
let gridEls = [];
function buildGrid() {
  const { rows, cols, cells } = game.model;
  const grid = $('#grid');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;
  gridEls = [];
  for (let r = 0; r < rows; r++) {
    const rowEls = [];
    for (let c = 0; c < cols; c++) {
      const cell = cells[r][c];
      const el = document.createElement('div');
      el.className = 'cell' + (cell.block ? ' block' : '');
      if (!cell.block) {
        el.dataset.r = r; el.dataset.c = c;
        if (cell.num) el.innerHTML = `<span class="num">${cell.num}</span>`;
        el.insertAdjacentHTML('beforeend', '<span class="letter"></span>');
      }
      grid.appendChild(el);
      rowEls.push(el);
    }
    gridEls.push(rowEls);
  }
  layoutGrid();
}
function layoutGrid() {
  if (!game || current !== 'play') return;
  const pane = $('#grid-pane');
  const tip = $('#grid-tip');
  const fit = extra => Math.floor(Math.min((pane.clientWidth - 18) / game.model.cols, (pane.clientHeight - 18 - extra) / game.model.rows, 64));
  let size = fit(0);
  const small = size < 26;
  if (small) size = fit(24);
  tip.hidden = !small;
  game.gridSmall = small;
  $('#grid').style.setProperty('--cell-size', Math.max(6, size) + 'px');
}
new ResizeObserver(() => layoutGrid()).observe($('#grid-pane'));

$('#grid-pane').addEventListener('click', e => {
  if (game?.gridSmall) { openBigGrid(); return; }
  const el = e.target.closest('.cell[data-r]');
  if (!el) return;
  tapCell(+el.dataset.r, +el.dataset.c);
});

// A large, scrollable copy of the grid for small screens.
function openBigGrid() {
  const size = Math.max(30, Math.min(64, Math.floor((window.innerWidth - 44) / game.model.cols)));
  openSheet('The grid', `<p style="margin-top:0">Tap a square to choose it.</p>
    <div class="big-grid-wrap"><div class="grid" id="big-grid" style="--cell-size:${size}px;grid-template-columns:repeat(${game.model.cols}, var(--cell-size))">${$('#grid').innerHTML}</div></div>`, 'grid');
  const big = $('#big-grid');
  big.addEventListener('click', ev => {
    const el = ev.target.closest('.cell[data-r]');
    if (!el) return;
    closeSheet();
    tapCell(+el.dataset.r, +el.dataset.c);
  });
  big.querySelector('.cell.cur')?.scrollIntoView({ block: 'center', inline: 'center' });
}

function tapCell(r, c) {
  const cell = cellAt(r, c);
  const w = word();
  const inCurrent = cell.words[w.dir]?.index === game.wi;
  const curCell = w.cells[game.pos];
  if (inCurrent && curCell[0] === r && curCell[1] === c) {
    // Tapping the selected square again switches between Across and Down.
    const other = cell.words[w.dir === 'a' ? 'd' : 'a'];
    if (other) select(other.index, other.pos);
    return;
  }
  const pick = cell.words[w.dir] || cell.words.a || cell.words.d;
  select(pick.index, pick.pos);
}

/* ================= Selection & navigation ================= */
function firstEmpty(wi) {
  const w = game.model.words[wi];
  const i = w.cells.findIndex(([r, c]) => !game.entries[r][c]);
  return i < 0 ? 0 : i;
}
function select(wi, pos, anim) {
  const changed = wi !== game.wi;
  game.wi = wi;
  game.pos = pos ?? firstEmpty(wi);
  persist();
  render(anim);
  if (changed) speakClue();
}
function step(delta) {
  const n = game.model.words.length;
  select((game.wi + delta + n) % n, undefined, delta > 0 ? 'slide-left' : 'slide-right');
  if (!settings.tipSeen) { settings.tipSeen = true; save(STORE_SETTINGS, settings); }
}
$('#btn-next').addEventListener('click', () => step(1));
$('#btn-prev').addEventListener('click', () => step(-1));

// Swipe on the clue card or the answer squares
function addSwipe(el) {
  let sx = 0, sy = 0, active = false;
  el.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; active = true; });
  el.addEventListener('pointercancel', () => { active = false; });
  el.addEventListener('pointerup', e => {
    if (!active) return;
    active = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      el.dataset.swiped = '1';
      setTimeout(() => delete el.dataset.swiped, 50);
      step(dx < 0 ? 1 : -1);
    }
  });
}
addSwipe($('#clue-card'));
addSwipe($('#strip'));

/* ================= Typing ================= */
function typeLetter(ch) {
  if (!game) return;
  const w = word();
  const [r, c] = w.cells[game.pos];
  game.entries[r][c] = ch;
  game.revealed[r][c] = false;
  if (game.pos < w.cells.length - 1) game.pos++;
  afterEdit();
}
function backspace() {
  if (!game) return;
  const w = word();
  let [r, c] = w.cells[game.pos];
  if (!game.entries[r][c] && game.pos > 0) {
    game.pos--;
    [r, c] = w.cells[game.pos];
  }
  game.entries[r][c] = '';
  game.revealed[r][c] = false;
  afterEdit();
}
function afterEdit() {
  persist();
  render();
  checkFinished();
}

document.addEventListener('keydown', e => {
  if (current !== 'play' || !$('#sheet').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[a-z]$/i.test(e.key)) { typeLetter(e.key.toUpperCase()); e.preventDefault(); }
  else if (e.key === 'Backspace' || e.key === 'Delete') { backspace(); e.preventDefault(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { game.pos = Math.max(0, game.pos - 1); render(); e.preventDefault(); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { game.pos = Math.min(word().cells.length - 1, game.pos + 1); render(); e.preventDefault(); }
  else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) { step(1); e.preventDefault(); }
  else if (e.key === 'Tab' && e.shiftKey) { step(-1); e.preventDefault(); }
});

/* ================= Keyboard ================= */
const LAYOUTS = {
  qwerty: ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'],
  abc: ['ABCDEFGHIJ', 'KLMNOPQRS', 'TUVWXYZ'],
};
function buildKeyboard() {
  const kb = $('#keyboard');
  kb.innerHTML = '';
  const rows = LAYOUTS[settings.keyboard] || LAYOUTS.qwerty;
  rows.forEach((letters, i) => {
    const row = document.createElement('div');
    row.className = 'krow';
    if (i === 1 && letters.length === 9) row.insertAdjacentHTML('beforeend', '<span class="key-spacer"></span>');
    for (const ch of letters) row.insertAdjacentHTML('beforeend', `<button class="key" data-key="${ch}">${ch}</button>`);
    if (i === 1 && letters.length === 9) row.insertAdjacentHTML('beforeend', '<span class="key-spacer"></span>');
    if (i === 2) row.insertAdjacentHTML('beforeend', '<button class="key key-wide" data-key="DEL" aria-label="Delete">⌫ Delete</button>');
    kb.appendChild(row);
  });
}
$('#keyboard').addEventListener('click', e => {
  const k = e.target.closest('.key');
  if (!k) return;
  if (navigator.vibrate) navigator.vibrate(10);
  if (k.dataset.key === 'DEL') backspace(); else typeLetter(k.dataset.key);
});

/* ================= Rendering ================= */
function render(anim) {
  if (!game) return;
  const { model, entries, revealed } = game;
  const w = word();
  const cur = w.cells[game.pos];
  const inWord = new Set(w.cells.map(([r, c]) => r + ',' + c));
  const showWrong = settings.mistakes && model.hasSolution;

  for (let r = 0; r < model.rows; r++) {
    for (let c = 0; c < model.cols; c++) {
      if (model.cells[r][c].block) continue;
      const el = gridEls[r][c];
      el.querySelector('.letter').textContent = entries[r][c];
      el.classList.toggle('word', inWord.has(r + ',' + c));
      el.classList.toggle('cur', cur[0] === r && cur[1] === c);
      el.classList.toggle('wrong', showWrong && isWrong(r, c));
      el.classList.toggle('revealed', revealed[r][c]);
    }
  }

  // Clue card
  const card = $('#clue-card');
  $('#clue-label').textContent = w.label;
  $('#clue-len').textContent = `· ${w.cells.length} letters`;
  $('#clue-text').textContent = w.clue;
  if (anim) {
    card.classList.remove('slide-left', 'slide-right');
    void card.offsetWidth;
    card.classList.add(anim);
  }

  // Answer squares
  const strip = $('#strip');
  strip.innerHTML = '';
  const avail = strip.clientWidth || window.innerWidth - 16;
  const maxSq = parseFloat(getComputedStyle(document.documentElement).fontSize) * (window.innerWidth >= 760 ? 3.8 : 3.1);
  const n = w.cells.length;
  const sqSize = Math.min(maxSq, Math.max(40, Math.floor((avail - 5 * (n - 1)) / n)));
  w.cells.forEach(([r, c], i) => {
    const b = document.createElement('button');
    b.className = 'sq';
    b.style.setProperty('--sq', sqSize + 'px');
    b.textContent = entries[r][c];
    b.setAttribute('aria-label', `Square ${i + 1}${entries[r][c] ? ', ' + entries[r][c] : ', empty'}`);
    if (i === game.pos) b.classList.add('cur');
    if (showWrong && isWrong(r, c)) b.classList.add('wrong');
    if (revealed[r][c]) b.classList.add('revealed');
    b.addEventListener('click', () => {
      if (strip.dataset.swiped) return;
      game.pos = i; persist(); render();
    });
    strip.appendChild(b);
  });

  // Status line
  const full = w.cells.every(([r, c]) => entries[r][c]);
  const status = $('#status');
  status.className = 'status';
  if (full) {
    status.textContent = '✓ Filled in. Tap Next ▶';
    status.classList.add('good');
  } else if (!settings.tipSeen) {
    status.textContent = '👆 Tip: swipe the clue sideways to change it';
    status.classList.add('tip');
  } else status.textContent = '';
  $('#btn-next').classList.toggle('pulse', full && !game.finished);
}
window.addEventListener('resize', () => { if (game && current === 'play') render(); });

/* ================= Finishing ================= */
function checkFinished() {
  const { model, entries } = game;
  const white = model.cells.flat().filter(c => !c.block);
  if (!white.every(c => entries[c.r][c.c])) return;
  if (model.hasSolution) {
    const wrong = white.filter(c => entries[c.r][c.c] !== c.sol).length;
    if (wrong) {
      if (!game.warnedFull) {
        game.warnedFull = true;
        openSheet('Nearly there!', `
          <p>Every square is filled in, but <strong>${wrong} ${wrong === 1 ? 'letter is' : 'letters are'}</strong> not quite right yet.</p>
          <div class="stack">
            <button class="btn btn-primary" data-act="show-mistakes">🔍 Show me the wrong letters</button>
            <button class="btn" data-act="close">Keep trying on my own</button>
          </div>`);
      }
      return;
    }
  }
  if (game.finished) return;
  game.finished = true;
  persist();
  render();
  openSheet('Well done!', `
    <p class="celebrate" aria-hidden="true">🎉</p>
    <p style="text-align:center"><strong>You finished the puzzle!</strong></p>
    <div class="stack">
      ${game.data.source === 'practice' ? '<button class="btn btn-primary" data-act="new-practice">✏️ Another practice puzzle</button>' : ''}
      <button class="btn" data-act="home">🏠 Back to the start</button>
      <button class="btn" data-act="close">Look at my finished puzzle</button>
    </div>`);
}

/* ================= Speech ================= */
function speakClue(force) {
  if (!game || !('speechSynthesis' in window)) return;
  if (!force && !settings.speak) return;
  const w = word();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(`${w.label}. ${w.cells.length} letters. ${w.clue}`);
  u.rate = 0.9;
  speechSynthesis.speak(u);
}
$('#btn-speak').addEventListener('click', () => speakClue(true));
if (!('speechSynthesis' in window)) $('#btn-speak').hidden = true;

/* ================= Sheets (menus/dialogs) ================= */
let sheetKind = null;
function openSheet(title, html, kind = null) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  sheetKind = kind;
  $('#sheet-close').focus();
}
function closeSheet() { $('#sheet').hidden = true; sheetKind = null; }
$('#sheet-close').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

function confirmSheet(title, message, yes, no = 'No, go back') {
  return new Promise(resolve => {
    openSheet(title, `<p>${message}</p>
      <div class="stack">
        <button class="btn btn-primary" data-confirm="yes">${yes}</button>
        <button class="btn" data-confirm="no">${no}</button>
      </div>`, 'confirm');
    const body = $('#sheet-body');
    const handler = e => {
      const b = e.target.closest('[data-confirm]');
      if (!b) return;
      body.removeEventListener('click', handler);
      closeSheet();
      resolve(b.dataset.confirm === 'yes');
    };
    body.addEventListener('click', handler);
  });
}

function renderMenu() {
  openSheet('Menu', `
    <div class="stack">
      <button class="btn" data-act="clues">📋 See all the clues</button>
      ${game.model.hasSolution ? '<button class="btn" data-act="hint">💡 Help with this clue</button>' : ''}
      <button class="btn" data-act="settings">⚙️ Settings (text size, colors)</button>
      <button class="btn" data-act="clear">🧽 Clear all my answers</button>
      ${game.data.source === 'practice' ? '<button class="btn" data-act="new-practice">✏️ New practice puzzle</button>' : ''}
      <button class="btn" data-act="home">🏠 Back to the start</button>
    </div>`, 'menu');
}

function renderHint() {
  const w = word();
  openSheet(`Help with ${w.label}`, `
    <p>“${escapeHtml(w.clue)}”</p>
    <div class="stack">
      <button class="btn" data-act="reveal-letter">🔤 Show me one letter</button>
      <button class="btn" data-act="check-word">🔍 Check this word</button>
      <button class="btn" data-act="reveal-word">📖 Show me the whole word</button>
      <button class="btn" data-act="show-mistakes">✅ Check the whole puzzle</button>
    </div>`, 'hint');
}

function renderClues() {
  const { words } = game.model;
  const row = w => {
    const pattern = w.cells.map(([r, c]) => game.entries[r][c] || '_').join('');
    const done = !pattern.includes('_');
    return `<button class="clue-row${w.index === game.wi ? ' current' : ''}${done ? ' done' : ''}" data-word="${w.index}">
      <span class="cn">${w.num}</span>
      <span class="ct">${escapeHtml(w.clue)}<span class="cp" aria-label="${done ? 'Filled in' : ''}">${pattern}</span></span>
    </button>`;
  };
  openSheet('All clues', `<div class="clue-list">
    <h3>Across</h3>${words.filter(w => w.dir === 'a').map(row).join('')}
    <h3>Down</h3>${words.filter(w => w.dir === 'd').map(row).join('')}
  </div>`, 'clues');
  $('.clue-row.current')?.scrollIntoView({ block: 'center' });
}

function renderSettings() {
  const choice = (key, val, label) =>
    `<button class="btn btn-choice" data-set="${key}" data-val="${val}" aria-pressed="${settings[key] === val}">${label}</button>`;
  const canSpeak = 'speechSynthesis' in window;
  openSheet('Settings', `
    <div class="setting">
      <h3>Text size</h3>
      <div class="size-control">
        <button class="btn btn-square" data-size="-1" aria-label="Make text smaller">A−</button>
        <span class="size-sample">Aa</span>
        <button class="btn btn-square" data-size="1" aria-label="Make text bigger">A+</button>
      </div>
    </div>
    <div class="setting">
      <h3>Colors</h3>
      <div class="row">
        ${choice('theme', 'light', 'Light')}
        ${choice('theme', 'dark', 'Dark')}
        ${choice('theme', 'contrast', 'Yellow on black')}
      </div>
    </div>
    <div class="setting">
      <h3>Letter keys</h3>
      <div class="row">
        ${choice('keyboard', 'qwerty', 'QWERTY (like a typewriter)')}
        ${choice('keyboard', 'abc', 'A B C order')}
      </div>
    </div>
    ${canSpeak ? `<div class="setting">
      <h3>Read each clue out loud</h3>
      <div class="row">${choice('speak', true, 'On')}${choice('speak', false, 'Off')}</div>
    </div>` : ''}
    <div class="setting">
      <h3>Show wrong letters in red as I go</h3>
      <div class="row">${choice('mistakes', true, 'On')}${choice('mistakes', false, 'Off')}</div>
      <p class="setting-note">Only works for practice puzzles, where the answers are known.</p>
    </div>`, 'settings');
}

// One handler for every button inside sheets
$('#sheet-body').addEventListener('click', async e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.set) {
    const raw = t.dataset.val;
    settings[t.dataset.set] = raw === 'true' ? true : raw === 'false' ? false : raw;
    applySettings();
    if (game) render();
    renderSettings();
    return;
  }
  if (t.dataset.word) { closeSheet(); select(+t.dataset.word); return; }
  const act = t.dataset.act;
  if (!act) return;
  switch (act) {
    case 'close': closeSheet(); break;
    case 'clues': renderClues(); break;
    case 'hint': renderHint(); break;
    case 'settings': renderSettings(); break;
    case 'home': closeSheet(); show('home'); break;
    case 'new-practice': {
      const size = game.data.size || 'small';
      closeSheet();
      startGame(generatePuzzle(size));
      break;
    }
    case 'clear': {
      if (await confirmSheet('Clear all answers?', 'This rubs out every letter you have written. The clues stay.', 'Yes, clear everything')) {
        game.entries = game.model.cells.map(row => row.map(() => ''));
        game.revealed = game.model.cells.map(row => row.map(() => false));
        game.finished = false; game.warnedFull = false;
        select(0, 0);
      }
      break;
    }
    case 'reveal-letter': {
      const w = word();
      let i = w.cells.findIndex(([r, c]) => game.entries[r][c] !== cellAt(r, c).sol);
      if (i < 0) { closeSheet(); flash('This word is already correct!'); break; }
      const [r, c] = w.cells[i];
      game.entries[r][c] = cellAt(r, c).sol;
      game.revealed[r][c] = true;
      game.pos = Math.min(i + 1, w.cells.length - 1);
      closeSheet(); afterEdit();
      break;
    }
    case 'reveal-word': {
      word().cells.forEach(([r, c]) => {
        if (game.entries[r][c] !== cellAt(r, c).sol) { game.entries[r][c] = cellAt(r, c).sol; game.revealed[r][c] = true; }
      });
      closeSheet(); afterEdit();
      break;
    }
    case 'check-word': {
      const w = word();
      const wrong = w.cells.filter(([r, c]) => isWrong(r, c)).length;
      const empty = w.cells.filter(([r, c]) => !game.entries[r][c]).length;
      closeSheet();
      markWrongTemporarily(w.cells);
      flash(wrong ? `${wrong} ${wrong === 1 ? 'letter is' : 'letters are'} wrong (shown in red)` :
        empty ? 'So far so good — no mistakes' : 'Correct! Well done');
      break;
    }
    case 'show-mistakes': {
      closeSheet();
      const all = game.model.cells.flat().filter(c => !c.block).map(c => [c.r, c.c]);
      const wrong = all.filter(([r, c]) => isWrong(r, c)).length;
      markWrongTemporarily(all);
      flash(wrong ? `${wrong} wrong ${wrong === 1 ? 'letter' : 'letters'} shown in red` : 'No mistakes so far!');
      break;
    }
  }
});

function markWrongTemporarily(cells) {
  cells.forEach(([r, c]) => { if (isWrong(r, c)) gridEls[r][c].classList.add('wrong'); });
  $$('#strip .sq').forEach((el, i) => {
    const [r, c] = word().cells[i];
    if (isWrong(r, c)) el.classList.add('wrong');
  });
}
let flashTimer;
function flash(msg) {
  const s = $('#status');
  s.textContent = msg;
  s.className = 'status good';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { if (game) render(); }, 6000);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* ================= Global button wiring ================= */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-back],[data-size],[data-open]');
  if (!t) return;
  if (t.dataset.go) show(t.dataset.go);
  else if ('back' in t.dataset) history.back();
  else if (t.dataset.size) changeSize(+t.dataset.size);
  else if (t.dataset.open === 'menu') renderMenu();
  else if (t.dataset.open === 'hint') renderHint();
  else if (t.dataset.open === 'clues') renderClues();
  else if (t.dataset.open === 'settings') renderSettings();
});

$$('[data-practice]').forEach(b => b.addEventListener('click', async () => {
  const saved = load(STORE_GAME, null);
  if (saved?.data && !saved.finished && saved.entries.flat().some(Boolean)) {
    const ok = await confirmSheet('Start a new puzzle?', 'You have a puzzle in progress. Starting a new one will replace it.', 'Yes, start a new one');
    if (!ok) return;
  }
  startGame(generatePuzzle(b.dataset.practice));
}));

$('#btn-continue').addEventListener('click', () => {
  const saved = load(STORE_GAME, null);
  if (saved?.data) startGame(saved.data, saved);
});

/* ================= Photo flow ================= */
const photos = [];
function renderPhotos() {
  const list = $('#photo-list');
  list.innerHTML = '';
  photos.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'photo-item';
    item.innerHTML = `<img src="${p.url}" alt="Photo ${i + 1}"><button class="btn btn-small" data-remove="${i}">✕ Remove</button>`;
    list.appendChild(item);
  });
  $('#btn-read').hidden = photos.length === 0;
  $('#camera-label').textContent = photos.length ? 'Take another photo' : 'Take a photo';
  $('#read-detail').textContent = photos.length === 1 ? 'Using 1 photo' : `Using ${photos.length} photos`;
}
$('#photo-list').addEventListener('click', e => {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  const [p] = photos.splice(+b.dataset.remove, 1);
  URL.revokeObjectURL(p.url);
  renderPhotos();
});
for (const id of ['#input-camera', '#input-library']) {
  $(id).addEventListener('change', e => {
    for (const file of e.target.files) photos.push({ file, url: URL.createObjectURL(file) });
    e.target.value = '';
    renderPhotos();
    if (photos.length) $('#btn-read').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}
$('#btn-read').addEventListener('click', async () => {
  show('loading');
  try {
    const data = await parsePuzzlePhotos(photos.map(p => p.file));
    history.replaceState({ screen: 'photo' }, '', '#photo');
    startGame(data);
    if (data.demo) {
      openSheet('Photo reading is not switched on yet', `
        <p>Reading crosswords from photos is still being set up.</p>
        <p>For now, here is a <strong>practice puzzle</strong> so you can try everything out.</p>
        <div class="stack"><button class="btn btn-primary" data-act="close">OK, let's play</button></div>`);
    }
  } catch (err) {
    show('photo', { push: false });
    openSheet('Sorry, that didn’t work', `
      <p>We couldn't read the puzzle from that photo.</p>
      <p>Try again with the page flat, in good light, and the whole puzzle in view.</p>
      <div class="stack"><button class="btn btn-primary" data-act="close">OK</button></div>`);
    console.error(err);
  }
});

/* ================= Start ================= */
applySettings();
history.replaceState({ screen: 'home' }, '', '#home');
show('home', { push: false });
