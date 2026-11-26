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
const DEFAULTS = { scale: 1.2, theme: 'light', keyboard: 'qwerty', speak: false, swiped: false };
const settings = { ...DEFAULTS, ...load(STORE_SETTINGS, {}) };
const SCALE_MIN = 0.8, SCALE_MAX = 2.4, SCALE_STEP = 0.15;

function applySettings() {
  document.documentElement.style.setProperty('--scale', settings.scale);
  document.documentElement.dataset.theme = settings.theme;
  save(STORE_SETTINGS, settings);
  if (game) { buildKeyboard(); render(); }
}
function changeSize(delta) {
  const next = Math.round((settings.scale + delta * SCALE_STEP) * 100) / 100;
  settings.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, next));
  applySettings();
}

/* ================= Screens & history ================= */
let current = 'home';
function show(name, { push = true } = {}) {
  $$('.screen').forEach(s => { s.hidden = s.dataset.screen !== name; });
  current = name;
  if (push) history.pushState({ screen: name }, '', '#' + name);
  window.scrollTo(0, 0);
  if (name === 'home') refreshHome();
  if (name === 'play') render();
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
  if (saved?.data && !saved.finished) {
    const filled = saved.entries.flat().filter(Boolean).length;
    const total = saved.data.grid.join('').replace(/#/g, '').length;
    $('#continue-detail').textContent = `${filled} of ${total} letters done`;
    btn.hidden = false;
  } else btn.hidden = true;
}

/* ================= Game state ================= */
let game = null; // { data, model, entries, revealed, wi, pos, finished }
let advanceTimer = null;

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
const word = (i = game.wi) => game.model.words[i];
const wordFull = w => w.cells.every(([r, c]) => game.entries[r][c]);

/* ================= Navigation ================= */
function firstEmpty(wi) {
  const i = word(wi).cells.findIndex(([r, c]) => !game.entries[r][c]);
  return i < 0 ? 0 : i;
}
function select(wi, anim) {
  clearTimeout(advanceTimer); advanceTimer = null;
  game.wi = wi;
  game.pos = firstEmpty(wi);
  persist();
  render(anim);
  speakClue();
}
function step(delta) {
  const n = game.model.words.length;
  select((game.wi + delta + n) % n, delta > 0 ? 'slide-left' : 'slide-right');
  if (!settings.swiped) { settings.swiped = true; save(STORE_SETTINGS, settings); }
}
// Next clue that still has empty squares (or -1 if none).
function nextUnfinished() {
  const n = game.model.words.length;
  for (let k = 1; k <= n; k++) {
    const i = (game.wi + k) % n;
    if (!wordFull(word(i))) return i;
  }
  return -1;
}

// Swipe anywhere on the clue page
(() => {
  const el = $('#clue-page');
  let sx = 0, sy = 0, active = false;
  el.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; active = true; });
  el.addEventListener('pointercancel', () => { active = false; });
  el.addEventListener('pointerup', e => {
    if (!active || !game) return;
    active = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      el.dataset.swiped = '1';
      setTimeout(() => delete el.dataset.swiped, 50);
      step(dx < 0 ? 1 : -1);
    }
  });
})();

/* ================= Typing ================= */
function typeLetter(ch) {
  if (!game || advanceTimer) return;
  const w = word();
  const [r, c] = w.cells[game.pos];
  game.entries[r][c] = ch;
  game.revealed[r][c] = false;
  if (game.pos < w.cells.length - 1) game.pos++;
  afterEdit(true);
}
function backspace() {
  if (!game) return;
  if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
  const w = word();
  let [r, c] = w.cells[game.pos];
  if (!game.entries[r][c] && game.pos > 0) {
    game.pos--;
    [r, c] = w.cells[game.pos];
  }
  game.entries[r][c] = '';
  game.revealed[r][c] = false;
  afterEdit(false);
}
function afterEdit(typed) {
  persist();
  render();
  if (!typed || !wordFull(word())) return;
  if (checkFinished()) return;
  // Word complete: show it in green for a moment, then move on by itself.
  $('#strip').classList.add('solved');
  advanceTimer = setTimeout(() => {
    advanceTimer = null;
    const next = nextUnfinished();
    if (next >= 0) select(next, 'slide-left'); else render();
  }, 900);
}

document.addEventListener('keydown', e => {
  if (current !== 'play' || !$('#sheet').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[a-z]$/i.test(e.key)) { typeLetter(e.key.toUpperCase()); e.preventDefault(); }
  else if (e.key === 'Backspace' || e.key === 'Delete') { backspace(); e.preventDefault(); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter') { step(1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
});

/* ================= Keyboard ================= */
const LAYOUTS = {
  qwerty: ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'],
  abc: ['ABCDEFGHIJ', 'KLMNOPQRS', 'TUVWXYZ'],
};
function buildKeyboard() {
  const kb = $('#keyboard');
  kb.innerHTML = '';
  (LAYOUTS[settings.keyboard] || LAYOUTS.qwerty).forEach((letters, i) => {
    const row = document.createElement('div');
    row.className = 'krow';
    const pad = i === 1 && letters.length === 9 ? '<span class="key-spacer"></span>' : '';
    row.innerHTML = pad + [...letters].map(ch => `<button class="key" data-key="${ch}">${ch}</button>`).join('') + pad +
      (i === 2 ? '<button class="key key-wide" data-key="DEL" aria-label="Delete">⌫</button>' : '');
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
  if (!game || current !== 'play') return;
  const w = word();
  $('#clue-label').textContent = `${w.label} · ${w.cells.length} letters`;
  $('#clue-text').textContent = w.clue;
  const block = $('#clue-block');
  if (anim) {
    block.classList.remove('slide-left', 'slide-right');
    void block.offsetWidth;
    block.classList.add(anim);
  }

  const strip = $('#strip');
  strip.classList.remove('solved');
  strip.innerHTML = '';
  const n = w.cells.length;
  const avail = strip.clientWidth || window.innerWidth - 40;
  const maxSq = parseFloat(getComputedStyle(document.documentElement).fontSize) * (window.innerWidth >= 760 ? 4 : 3.2);
  const sqSize = Math.min(maxSq, Math.max(42, Math.floor((avail - 6 * (n - 1)) / n)));
  w.cells.forEach(([r, c], i) => {
    const b = document.createElement('button');
    b.className = 'sq' + (i === game.pos ? ' cur' : '') + (game.revealed[r][c] ? ' revealed' : '');
    b.style.setProperty('--sq', sqSize + 'px');
    b.textContent = game.entries[r][c];
    b.setAttribute('aria-label', `Square ${i + 1}, ${game.entries[r][c] || 'empty'}`);
    b.addEventListener('click', () => {
      if ($('#clue-page').dataset.swiped) return;
      game.pos = i; persist(); render();
    });
    strip.appendChild(b);
  });

  $('#clue-count').textContent = settings.swiped
    ? `Clue ${game.wi + 1} of ${game.model.words.length}`
    : '👆 Swipe sideways for other clues';
}
window.addEventListener('resize', () => render());

/* ================= Finishing ================= */
function checkFinished() {
  const { model, entries } = game;
  const white = model.cells.flat().filter(c => !c.block);
  if (!white.every(c => entries[c.r][c.c])) return false;
  if (model.hasSolution) {
    const wrong = white.filter(c => entries[c.r][c.c] !== c.sol);
    if (wrong.length) {
      // Take them to the first clue with a mistake.
      const bad = wrong[0];
      const wi = (bad.words.a || bad.words.d).index;
      openSheet('Nearly there', `
        <p>Every square is filled, but <strong>${wrong.length} ${wrong.length === 1 ? 'letter is' : 'letters are'}</strong> not right yet.</p>
        <div class="stack"><button class="btn btn-primary" data-act="goto" data-word="${wi}">Show me where</button></div>`);
      return true;
    }
  }
  game.finished = true;
  persist();
  openSheet('Well done!', `
    <p class="celebrate" aria-hidden="true">🎉</p>
    <p style="text-align:center"><strong>You finished the puzzle!</strong></p>
    <div class="stack">
      ${game.data.source === 'practice' ? '<button class="btn btn-primary" data-act="new-practice">Another puzzle</button>' : ''}
      <button class="btn" data-act="home">Back to the start</button>
    </div>`);
  return true;
}

/* ================= Speech ================= */
function speakClue() {
  if (!game || !settings.speak || !('speechSynthesis' in window)) return;
  const w = word();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(`${w.label}. ${w.cells.length} letters. ${w.clue}`);
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

/* ================= Sheets ================= */
function openSheet(title, html) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }
$('#sheet-close').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

function confirmSheet(title, message, yes) {
  return new Promise(resolve => {
    openSheet(title, `<p>${message}</p>
      <div class="stack">
        <button class="btn btn-primary" data-confirm="yes">${yes}</button>
        <button class="btn" data-confirm="no">No, go back</button>
      </div>`);
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
      ${game.model.hasSolution ? '<button class="btn" data-act="reveal-letter">Show me a letter</button>' : ''}
      <button class="btn" data-act="home">Back to the start</button>
    </div>`);
}

function renderSettings() {
  const choice = (key, val, label) =>
    `<button class="btn btn-choice" data-set="${key}" data-val="${val}" aria-pressed="${settings[key] === val}">${label}</button>`;
  openSheet('Settings', `
    <div class="setting">
      <h3>Colors</h3>
      <div class="row">${choice('theme', 'light', 'Light')}${choice('theme', 'dark', 'Dark')}${choice('theme', 'contrast', 'Yellow on black')}</div>
    </div>
    <div class="setting">
      <h3>Letter keys</h3>
      <div class="row">${choice('keyboard', 'qwerty', 'QWERTY')}${choice('keyboard', 'abc', 'A B C')}</div>
    </div>
    ${'speechSynthesis' in window ? `<div class="setting">
      <h3>Read clues out loud</h3>
      <div class="row">${choice('speak', true, 'On')}${choice('speak', false, 'Off')}</div>
    </div>` : ''}`);
}

$('#sheet-body').addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.set) {
    const raw = t.dataset.val;
    settings[t.dataset.set] = raw === 'true' ? true : raw === 'false' ? false : raw;
    applySettings();
    renderSettings();
    return;
  }
  switch (t.dataset.act) {
    case 'home': closeSheet(); show('home'); break;
    case 'goto': closeSheet(); select(+t.dataset.word); break;
    case 'new-practice': closeSheet(); startGame(generatePuzzle(game.data.size || 'small')); break;
    case 'reveal-letter': {
      closeSheet();
      const w = word();
      const i = w.cells.findIndex(([r, c]) => game.entries[r][c] !== game.model.cells[r][c].sol);
      if (i < 0) break;
      const [r, c] = w.cells[i];
      game.entries[r][c] = game.model.cells[r][c].sol;
      game.revealed[r][c] = true;
      game.pos = Math.min(i + 1, w.cells.length - 1);
      afterEdit(true);
      break;
    }
  }
});

/* ================= Global buttons ================= */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-back],[data-size],[data-open]');
  if (!t) return;
  if (t.dataset.go) show(t.dataset.go);
  else if ('back' in t.dataset) history.back();
  else if (t.dataset.size) changeSize(+t.dataset.size);
  else if (t.dataset.open === 'menu') renderMenu();
  else if (t.dataset.open === 'settings') renderSettings();
});

$$('[data-practice]').forEach(b => b.addEventListener('click', async () => {
  const saved = load(STORE_GAME, null);
  if (saved?.data && !saved.finished && saved.entries.flat().some(Boolean)) {
    if (!await confirmSheet('Start a new puzzle?', 'This will replace the puzzle you have started.', 'Yes, start a new one')) return;
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
      openSheet('Not ready yet', `
        <p>Reading puzzles from photos is still being set up. Here is a practice puzzle instead.</p>
        <div class="stack"><button class="btn btn-primary" data-act="close-sheet">OK</button></div>`);
      $('[data-act="close-sheet"]').addEventListener('click', closeSheet);
    }
  } catch (err) {
    show('photo', { push: false });
    openSheet('Sorry, that didn’t work', `
      <p>Try again with the page flat, in good light, and the whole puzzle in view.</p>`);
    console.error(err);
  }
});

/* ================= Start ================= */
applySettings();
history.replaceState({ screen: 'home' }, '', '#home');
show('home', { push: false });
