// Turns PuzzleData into a playable model.
//
// PuzzleData (what the generator makes and what the AI parser must return):
// {
//   title:  string,
//   source: 'practice' | 'photo',
//   grid:   string[]   one string per row; '#' = black square,
//                      'A'-'Z' = known answer letter, '.' = white square (answer unknown)
//   clues:  { across: [{ number, clue }], down: [{ number, clue }] }
// }
import { numberGrid } from './generator.js';

export function buildModel(data) {
  const grid = data.grid.map(r => r.toUpperCase());
  const rows = grid.length, cols = Math.max(...grid.map(r => r.length));
  const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols ? '#' : grid[r][c] || '#');
  const white = (r, c) => at(r, c) !== '#';
  const nums = numberGrid(grid.map(r => r.padEnd(cols, '#')));

  const cells = [];
  let hasSolution = true;
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const ch = at(r, c);
      const block = ch === '#';
      const sol = !block && /[A-Z]/.test(ch) ? ch : null;
      if (!block && !sol) hasSolution = false;
      row.push({ r, c, block, sol, num: nums[r][c], words: {} });
    }
    cells.push(row);
  }

  const clueText = { a: {}, d: {} };
  for (const k of data.clues?.across || []) clueText.a[k.number] = k.clue;
  for (const k of data.clues?.down || []) clueText.d[k.number] = k.clue;

  const words = [];
  for (const dir of ['a', 'd']) {
    const dr = dir === 'd' ? 1 : 0, dc = dir === 'a' ? 1 : 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!white(r, c) || white(r - dr, c - dc) || !white(r + dr, c + dc)) continue;
        const list = [];
        for (let rr = r, cc = c; white(rr, cc); rr += dr, cc += dc) list.push([rr, cc]);
        const num = nums[r][c];
        words.push({
          dir, num,
          label: `${num} ${dir === 'a' ? 'Across' : 'Down'}`,
          clue: clueText[dir][num] || '(Clue not found)',
          cells: list,
        });
      }
    }
  }
  words.sort((x, y) => (x.dir === y.dir ? x.num - y.num : x.dir === 'a' ? -1 : 1));
  words.forEach((w, i) => {
    w.index = i;
    w.cells.forEach(([r, c], pos) => { cells[r][c].words[w.dir] = { index: i, pos }; });
  });

  return { title: data.title || 'Crossword', rows, cols, cells, words, hasSolution };
}
