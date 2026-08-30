import { createCanvas } from '@napi-rs/canvas';
import { makeRng } from './rng.js';
import { makePalette } from './palette.js';
import { drawLayers, rgbaStr } from './primitives.js';
import { applySymmetry, postProcess } from './post.js';

export function render(seed, width, height) {
  const w = Math.max(1, Math.min(4096, width | 0));
  const h = Math.max(1, Math.min(4096, height | 0));

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

  // @napi-rs/canvas uses encode() / toBuffer() — both work; encode is async-friendly
  return canvas.toBuffer('image/png');
}
