# Big Puzzle

A large-print crossword helper for people with poor eyesight. Designed for
phones and tablets.

1. Photograph a crossword (grid and clues) from a newspaper or book.
2. The photo is read by AI and turned into an interactive puzzle.
3. Swipe left/right through the clues (or tap **Back** / **Next**) and type
   answers on big on-screen keys.

**Status:** photo reading is not connected yet. Taking a photo currently
loads a generated practice puzzle so the whole flow can be tried. The
**Practice puzzle** option generates crosswords from a built-in word list.

## Features

- Big clue card, one clue at a time; the current answer is shown as large squares
- Text size buttons (A− / A+) always on screen
- Light, dark and yellow-on-black color schemes
- QWERTY or A-B-C key layout
- Read clues out loud (uses the device's speech)
- Help: show a letter, show a word, check a word or the whole puzzle (practice puzzles)
- Progress saved automatically on the device
- Can be added to the home screen

## Running locally

It is a static site with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploying to GitHub Pages

`.github/workflows/pages.yml` publishes the site on every push to `main`.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Connecting the AI parser

See `js/ai.js`. Set `AI_ENDPOINT` to a server you control (don't put an API key in
this public site). The server receives `{ images: [dataURL, ...] }` and must
return PuzzleData:

```json
{
  "title": "Daily Mail Quick Crossword",
  "grid": ["...#.....", ".#.#.#.#.", "..."],
  "clues": {
    "across": [{ "number": 1, "clue": "Feline pet" }],
    "down":   [{ "number": 2, "clue": "Opposite of up" }]
  }
}
```

`#` is a black square, `.` a white square (letters A–Z may be given if the answers are
known). Clue numbers are recomputed from the grid using standard crossword numbering.

## Files

- `index.html`, `css/styles.css` – layout and themes
- `js/app.js` – screens, input, swiping, settings
- `js/puzzle.js` – turns PuzzleData into a playable model
- `js/generator.js`, `js/words.js` – practice puzzle generator and word list
- `js/ai.js` – photo upload / AI parsing stub
