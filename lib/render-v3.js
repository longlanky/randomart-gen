// Retained for reproducing v3 artwork with the original pipeline.
import { createCanvas } from '@napi-rs/canvas';
import { makeRng } from './rng.js';
import { makePalette } from './palette.js';
import { drawLayers, rgbaStr } from './primitives.js';
import { applySymmetry, postProcess } from './post.js';
import { parseDim, MIN_DIM } from './dims.js';

export async function renderV3(seed, width, height) {
  const w = parseDim(width) ?? MIN_DIM;
  const h = parseDim(height) ?? MIN_DIM;
  const rng = makeRng(seed);
  const palette = makePalette(rng);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = rgbaStr(palette.background, 1);
  ctx.fillRect(0, 0, w, h);
  drawLayers(ctx, w, h, rng, palette);
  applySymmetry(ctx, w, h, rng);
  postProcess(ctx, w, h, rng, palette);
  return await canvas.encode('png');
}
