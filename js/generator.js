// Generates a free-form crossword from the word bank.
// Output uses the same PuzzleData format the photo/AI parser will return.
import { WORDS } from './words.js';

export const SIZES = {
  small:  { label: 'Small',  maxSize: 9,  target: 10, maxLen: 6 },
  medium: { label: 'Medium', maxSize: 11, target: 15, maxLen: 7 },
  large:  { label: 'Large',  maxSize: 13, target: 22, maxLen: 9 },
};

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function attempt(words, maxSize, target) {
  const N = maxSize * 3;
  const letters = Array.from({ length: N }, () => Array(N).fill(null));
  const used = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ a: false, d: false })));
  const placed = [];
  const bbox = { r0: Infinity, r1: -Infinity, c0: Infinity, c1: -Infinity };
  const get = (r, c) => (r < 0 || c < 0 || r >= N || c >= N ? null : letters[r][c]);

  function check(word, r, c, dir) {
    const dr = dir === 'd' ? 1 : 0, dc = dir === 'a' ? 1 : 0;
    const len = word.length;
    const er = r + dr * (len - 1), ec = c + dc * (len - 1);
    if (r < 0 || c < 0 || er >= N || ec >= N) return -1;
    const nr0 = Math.min(bbox.r0, r), nr1 = Math.max(bbox.r1, er);
    const nc0 = Math.min(bbox.c0, c), nc1 = Math.max(bbox.c1, ec);
    if (nr1 - nr0 + 1 > maxSize || nc1 - nc0 + 1 > maxSize) return -1;
    if (get(r - dr, c - dc) || get(er + dr, ec + dc)) return -1;
    let crosses = 0;
    for (let i = 0; i < len; i++) {
      const rr = r + dr * i, cc = c + dc * i;
      const cur = letters[rr][cc];
      if (cur) {
        if (cur !== word[i] || used[rr][cc][dir]) return -1;
        crosses++;
      } else if (get(rr + dc, cc + dr) || get(rr - dc, cc - dr)) {
        return -1; // would touch a parallel neighbour
      }
    }
    if (placed.length && (crosses === 0 || crosses === len)) return -1;
    return crosses;
  }

  function place(word, r, c, dir) {
    const dr = dir === 'd' ? 1 : 0, dc = dir === 'a' ? 1 : 0;
    for (let i = 0; i < word.length; i++) {
      const rr = r + dr * i, cc = c + dc * i;
      letters[rr][cc] = word[i];
      used[rr][cc][dir] = true;
      bbox.r0 = Math.min(bbox.r0, rr); bbox.r1 = Math.max(bbox.r1, rr);
      bbox.c0 = Math.min(bbox.c0, cc); bbox.c1 = Math.max(bbox.c1, cc);
    }
    placed.push({ word, r, c, dir });
  }

  const pool = shuffle(words.slice());
  const firstIdx = pool.findIndex(w => w.length >= 5);
  const first = pool.splice(firstIdx < 0 ? 0 : firstIdx, 1)[0];
  const mid = Math.floor(N / 2);
  place(first, mid, mid - Math.floor(first.length / 2), Math.random() < 0.5 ? 'a' : 'd');

  // Several passes so words skipped early get another chance.
  for (let pass = 0; pass < 3 && placed.length < target; pass++) {
    for (let k = 0; k < pool.length && placed.length < target; k++) {
      const word = pool[k];
      if (!word) continue;
      let best = null;
      for (const p of placed) {
        const dir = p.dir === 'a' ? 'd' : 'a';
        for (let i = 0; i < p.word.length; i++) {
          const pr = p.r + (p.dir === 'd' ? i : 0), pc = p.c + (p.dir === 'a' ? i : 0);
          for (let j = 0; j < word.length; j++) {
            if (word[j] !== p.word[i]) continue;
            const r = dir === 'd' ? pr - j : pr, c = dir === 'a' ? pc - j : pc;
            const score = check(word, r, c, dir);
            if (score > 0) {
              const s = score + Math.random() * 0.5;
              if (!best || s > best.s) best = { s, r, c, dir };
            }
          }
        }
      }
      if (best) { place(word, best.r, best.c, best.dir); pool[k] = null; }
    }
  }

  const rows = bbox.r1 - bbox.r0 + 1, cols = bbox.c1 - bbox.c0 + 1;
  const grid = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) line += letters[r + bbox.r0][c + bbox.c0] || '#';
    grid.push(line);
  }
  return {
    grid, rows, cols,
    placed: placed.map(p => ({ ...p, r: p.r - bbox.r0, c: p.c - bbox.c0 })),
    score: placed.length * 100 - Math.abs(rows - cols) * 5,
  };
}

export function generatePuzzle(sizeKey = 'small') {
  const size = SIZES[sizeKey] || SIZES.small;
  const words = Object.keys(WORDS).filter(w => w.length <= size.maxLen);
  let best = null;
  for (let i = 0; i < 30; i++) {
    const a = attempt(words, size.maxSize, size.target);
    if (!best || a.score > best.score) best = a;
    if (a.placed.length >= size.target && a.rows === a.cols) break;
  }
  // Clue numbers are worked out from the grid by puzzle.js; here we just
  // label each clue with its start square so numbers can be matched.
  const numbers = numberGrid(best.grid);
  const clues = { across: [], down: [] };
  for (const p of best.placed) {
    const num = numbers[p.r][p.c];
    (p.dir === 'a' ? clues.across : clues.down).push({ number: num, clue: WORDS[p.word] });
  }
  clues.across.sort((a, b) => a.number - b.number);
  clues.down.sort((a, b) => a.number - b.number);
  return {
    title: `${size.label} practice puzzle`,
    source: 'practice',
    size: sizeKey,
    grid: best.grid,
    clues,
  };
}

// Standard crossword numbering: a white square gets a number when it starts
// an across or down answer of two or more letters.
export function numberGrid(grid) {
  const rows = grid.length, cols = grid[0].length;
  const white = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols && grid[r][c] !== '#';
  const nums = Array.from({ length: rows }, () => Array(cols).fill(0));
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!white(r, c)) continue;
      const a = !white(r, c - 1) && white(r, c + 1);
      const d = !white(r - 1, c) && white(r + 1, c);
      if (a || d) nums[r][c] = ++n;
    }
  }
  return nums;
}
