import { createCanvas } from '@napi-rs/canvas';
import { makeRng } from './rng.js';
import { makePalette } from './palette.js';
import { drawLayers, rgbaStr } from './primitives.js';
import { applySymmetry, postProcess } from './post.js';
import { parseDim, MIN_DIM } from './dims.js';

// Async: PNG encoding is the largest single slice of a render and `encode()`
// runs it on the libuv thread pool instead of blocking the event loop.
// Byte-identical to the previous `canvas.toBuffer('image/png')`.
export async function render(seed, width, height) {
  const w = parseDim(width) ?? MIN_DIM;
  const h = parseDim(height) ?? MIN_DIM;

  const rng = makeRng(seed);
  const palette = makePalette(rng);

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = rgbaStr(palette.background, 1);
  ctx.fillRect(0, 0, w, h);

  // Composition of layers / shapes / blend modes [1]
  drawLayers(ctx, w, h, rng, palette);

  // Symmetry & tiling
  applySymmetry(ctx, w, h, rng);

  // Post-processing
  postProcess(ctx, w, h, rng, palette);

  return await canvas.encode('png');
}
