import { createCanvas } from '@napi-rs/canvas';
import { scanlines, duotone, bloom, pixelSort } from './filters.js';

// Apply kaleidoscope / mirror symmetry or tiling by reflecting the canvas
export function applySymmetry(ctx, w, h, rng) {
  const mode = rng.pick(['none', 'mirrorX', 'mirrorY', 'quad', 'kaleido', 'tile', 'pinwheel']);
  if (mode === 'none') return;

  const snapshot = ctx.canvas;
  const tmp = createCanvas(w, h);              // was: require('canvas').createCanvas(w, h)
  tmp.getContext('2d').drawImage(snapshot, 0, 0);

  ctx.clearRect(0, 0, w, h);

  if (mode === 'mirrorX' || mode === 'quad' || mode === 'kaleido') {
    ctx.drawImage(tmp, 0, 0, w / 2, h, 0, 0, w / 2, h);
    ctx.save();
    ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.drawImage(tmp, 0, 0, w / 2, h, 0, 0, w / 2, h);
    ctx.restore();
  }
  if (mode === 'mirrorY') {
    // Draw the top half back, then mirror it into the bottom half.
    // (tmp2 below would copy the just-cleared canvas, blanking the image.
    // In the flipped space, dest [0, h/2] lands on the device bottom half.)
    ctx.drawImage(tmp, 0, 0, w, h / 2, 0, 0, w, h / 2);
    ctx.save();
    ctx.translate(0, h); ctx.scale(1, -1);
    ctx.drawImage(tmp, 0, 0, w, h / 2, 0, 0, w, h / 2);
    ctx.restore();
  }
  if (mode === 'quad' || mode === 'kaleido') {
    const half = ctx.canvas;
    const tmp2 = createCanvas(w, h);           // was: require('canvas').createCanvas(w, h)
    tmp2.getContext('2d').drawImage(half, 0, 0);
    ctx.save();
    ctx.translate(0, h); ctx.scale(1, -1);
    ctx.drawImage(tmp2, 0, h / 2, w, h / 2, 0, h / 2, w, h / 2);
    ctx.restore();
  }
  if (mode === 'tile') {
    const tiles = rng.int(2, 4);
    const tw = w / tiles, th = h / tiles;
    for (let ty = 0; ty < tiles; ty++)
      for (let tx = 0; tx < tiles; tx++)
        ctx.drawImage(tmp, 0, 0, w, h, tx * tw, ty * th, tw, th);
  }
  if (mode === 'pinwheel') {
    // Rotational symmetry: four 90° copies around the center
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(k * Math.PI / 2);
      ctx.drawImage(tmp, -w / 2, -h / 2);
      ctx.restore();
    }
  }
}

// Post-processing on raw pixel data: vignette, grain, stylistic filters,
// chromatic aberration. All randomness comes from the seeded rng.
export function postProcess(ctx, w, h, rng, palette) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  const grain = rng.range(0, 25);
  const cx = w / 2, cy = h / 2;
  const maxDist = Math.hypot(cx, cy);
  const vignetteStrength = rng.range(0.2, 0.6);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;

      // Vignette
      const dist = Math.hypot(x - cx, y - cy) / maxDist;
      const vig = 1 - dist * dist * vignetteStrength;
      d[i] *= vig; d[i + 1] *= vig; d[i + 2] *= vig;

      // Film grain (seeded — renders are byte-for-byte deterministic)
      if (grain > 0) {
        const g = (rng() - 0.5) * grain;
        d[i] += g; d[i + 1] += g; d[i + 2] += g;
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  // Chance-gated stylistic filters
  if (rng.chance(0.35)) scanlines(ctx, w, h, rng);
  if (rng.chance(0.3)) duotone(ctx, w, h, rng, palette);
  if (rng.chance(0.35)) bloom(ctx, w, h, rng);
  if (rng.chance(0.25)) pixelSort(ctx, w, h, rng);

  // Chromatic aberration (optional)
  if (rng.chance(0.5)) {
    const shift = rng.int(1, 4);
    const src = ctx.getImageData(0, 0, w, h);
    const out = ctx.createImageData(w, h);
    const s = src.data, o = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const rx = Math.min(w - 1, x + shift);
        const bx = Math.max(0, x - shift);
        o[i]     = s[(y * w + rx) * 4];       // R shifted
        o[i + 1] = s[i + 1];                  // G
        o[i + 2] = s[(y * w + bx) * 4 + 2];   // B shifted
        o[i + 3] = s[i + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
  }
}
