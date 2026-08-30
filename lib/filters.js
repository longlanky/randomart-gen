import { createCanvas } from '@napi-rs/canvas';

// Stylistic post filters, all driven by the seeded rng (deterministic)

export function scanlines(ctx, w, h, rng) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const strength = rng.range(0.1, 0.35);
  const period = rng.int(2, 4);
  for (let y = 0; y < h; y++) {
    if (y % period !== 0) continue;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] *= 1 - strength;
      d[i + 1] *= 1 - strength;
      d[i + 2] *= 1 - strength;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Map luminance onto a dark→light ramp, optionally posterized.
// The ramp is stretched from one palette hue and normalized to the image's
// actual luminance range, so duotone can restyle but never flatten the image.
export function duotone(ctx, w, h, rng, palette) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const base = palette.pick();
  const dark = base.map((v) => v * 0.12);
  const light = base.map((v) => 255 - (255 - v) * 0.12);
  const levels = rng.chance(0.5) ? rng.int(3, 8) : 0; // 0 = smooth gradient map

  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  const span = max - min || 1;

  for (let i = 0; i < d.length; i += 4) {
    let lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] - min) / span;
    if (levels > 0) lum = Math.round(lum * (levels - 1)) / (levels - 1);
    d[i]     = dark[0] + (light[0] - dark[0]) * lum;
    d[i + 1] = dark[1] + (light[1] - dark[1]) * lum;
    d[i + 2] = dark[2] + (light[2] - dark[2]) * lum;
  }
  ctx.putImageData(img, 0, 0);
}

// Cheap glow: screen-blend an upscaled low-res copy back over the image
export function bloom(ctx, w, h, rng) {
  const factor = 1 / rng.int(4, 8);
  const sw = Math.max(1, Math.round(w * factor));
  const sh = Math.max(1, Math.round(h * factor));
  const small = createCanvas(sw, sh);
  small.getContext('2d').drawImage(ctx.canvas, 0, 0, sw, sh);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = rng.range(0.4, 0.8);
  ctx.drawImage(small, 0, 0, w, h);
  ctx.drawImage(small, 0, 0, w, h);
  ctx.restore();
}

// Glitch look: sort bright runs of pixels within each row by luminance
export function pixelSort(ctx, w, h, rng) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const threshold = rng.range(60, 200);
  const maxRun = rng.int(60, 400);
  const lumAt = (x, y) => {
    const i = (y * w + x) * 4;
    return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  };
  const buf = new Uint8ClampedArray(maxRun * 4);
  const order = new Uint32Array(maxRun);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      while (x < w && lumAt(x, y) <= threshold) x++;
      let end = x;
      while (end < w && lumAt(end, y) > threshold && end - x < maxRun) end++;
      const len = end - x;
      if (len > 1) {
        buf.set(d.subarray((y * w + x) * 4, (y * w + end) * 4));
        for (let k = 0; k < len; k++) order[k] = k;
        const lumBuf = (k) =>
          0.2126 * buf[k * 4] + 0.7152 * buf[k * 4 + 1] + 0.0722 * buf[k * 4 + 2];
        order.subarray(0, len).sort((p, q) => lumBuf(p) - lumBuf(q));
        for (let k = 0; k < len; k++) {
          const di = (y * w + x + k) * 4, o = order[k] * 4;
          d[di] = buf[o]; d[di + 1] = buf[o + 1];
          d[di + 2] = buf[o + 2]; d[di + 3] = buf[o + 3];
        }
      }
      x = end + 1;
    }
  }
  ctx.putImageData(img, 0, 0);
}
