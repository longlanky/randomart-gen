import { createCanvas } from '@napi-rs/canvas';
import { scanlines, duotone, bloom, pixelSort } from './filters.js';

// Apply kaleidoscope / mirror symmetry or tiling by reflecting the canvas.
// All geometry uses integer rects: fractional w/2 and h/2 used to resample the
// halves (blur) and, at odd dimensions, leave an uncovered black seam column.
export function applySymmetry(ctx, w, h, rng) {
  const mode = rng.pick(['none', 'mirrorX', 'mirrorY', 'quad', 'kaleido', 'tile', 'pinwheel']);
  if (mode === 'none') return;

  const snapshot = ctx.canvas;
  const tmp = createCanvas(w, h);              // was: require('canvas').createCanvas(w, h)
  tmp.getContext('2d').drawImage(snapshot, 0, 0);

  ctx.clearRect(0, 0, w, h);

  // Integer halves: [0, hw] / [hw, w] and [0, hh] / [hh, h] tile the canvas.
  const hw = Math.ceil(w / 2);
  const hh = Math.ceil(h / 2);

  if (mode === 'mirrorX' || mode === 'quad') {
    ctx.drawImage(tmp, 0, 0, hw, h, 0, 0, hw, h);
    ctx.save();
    ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.drawImage(tmp, 0, 0, w - hw, h, 0, 0, w - hw, h);
    ctx.restore();
  }
  if (mode === 'mirrorY') {
    // Draw the top half back, then mirror it into the bottom half.
    // (In the flipped space, dest [0, h - hh] lands on the device bottom half.)
    ctx.drawImage(tmp, 0, 0, w, hh, 0, 0, w, hh);
    ctx.save();
    ctx.translate(0, h); ctx.scale(1, -1);
    ctx.drawImage(tmp, 0, 0, w, h - hh, 0, 0, w, h - hh);
    ctx.restore();
  }
  if (mode === 'quad') {
    // Reflect the top half down, so the reflected copy keeps the composition's
    // upper half instead of discarding it.
    const half = ctx.canvas;
    const tmp2 = createCanvas(w, h);           // was: require('canvas').createCanvas(w, h)
    tmp2.getContext('2d').drawImage(half, 0, 0);
    ctx.save();
    ctx.translate(0, h); ctx.scale(1, -1);
    ctx.drawImage(tmp2, 0, 0, w, h - hh, 0, 0, w, h - hh);
    ctx.restore();
  }
  if (mode === 'kaleido') {
    // True kaleidoscope: the same wedge repeated rotationally, every second
    // copy mirrored (previously kaleido was an alias of quad). The wedge is a
    // clip on the destination, so no oversized scratch canvas is needed.
    const sectors = rng.int(6, 12);
    const step = (Math.PI * 2) / sectors;
    const radius = Math.hypot(w, h);
    // A rotated w×h image only guarantees coverage out to min(w,h)/2 from the
    // centre, so scale it up enough to reach the corners at any rotation.
    const cover = radius / Math.min(w, h);
    const cw = w * cover, ch = h * cover;
    for (let k = 0; k < sectors; k++) {
      const flip = k % 2 === 1;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      // mirrored copies are rotated one step further so they land in their own slot
      ctx.rotate((k + (flip ? 1 : 0)) * step);
      if (flip) ctx.scale(1, -1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, 0, step);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(tmp, -cw / 2, -ch / 2, cw, ch);
      ctx.restore();
    }
  }
  if (mode === 'tile') {
    const tiles = rng.int(2, 4);
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        // Integer tile rects: the remainder is spread, so tiles never straddle
        // a fractional boundary and never resample the destination.
        const x0 = Math.floor((tx * w) / tiles), x1 = Math.floor(((tx + 1) * w) / tiles);
        const y0 = Math.floor((ty * h) / tiles), y1 = Math.floor(((ty + 1) * h) / tiles);
        ctx.drawImage(tmp, 0, 0, w, h, x0, y0, x1 - x0, y1 - y0);
      }
    }
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
  // squared corner distance: dist^2 = (dx^2 + dy^2) / maxDistSq, so the
  // per-pixel Math.hypot (and its sqrt) disappears entirely
  const maxDistSq = cx * cx + cy * cy;
  const vignetteStrength = rng.range(0.2, 0.6);

  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    const dy2 = dy * dy;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dx = x - cx;

      // Vignette
      const vig = 1 - ((dx * dx + dy2) / maxDistSq) * vignetteStrength;
      d[i] *= vig; d[i + 1] *= vig; d[i + 2] *= vig;

      // Film grain (seeded — renders are byte-for-byte deterministic)
      if (grain > 0.001) {
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
