// Photo -> puzzle parsing.
//
// For now this is a stand-in: it pretends to read the photo and returns a
// generated practice puzzle, so the whole flow can be tried end to end.
// To connect a real AI service later, set AI_ENDPOINT and make that endpoint
// return PuzzleData (see puzzle.js) for the photos sent to it.
import { generatePuzzle } from './generator.js';

export const AI_ENDPOINT = null; // e.g. 'https://your-worker.example.com/parse'

export const aiConnected = () => Boolean(AI_ENDPOINT);

// Shrink photos before upload: phone photos are huge, and ~2000px is plenty
// for reading a newspaper grid.
export async function preparePhoto(file, maxSide = 2000) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export async function parsePuzzlePhotos(files) {
  if (!aiConnected()) {
    await new Promise(res => setTimeout(res, 2500));
    return { ...generatePuzzle('medium'), title: 'Practice puzzle (photo demo)', demo: true };
  }
  const images = await Promise.all(files.map(f => preparePhoto(f)));
  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images }),
  });
  if (!res.ok) throw new Error(`Server said ${res.status}`);
  const data = await res.json();
  return { ...data, source: 'photo' };
}
