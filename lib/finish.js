import { createCanvas } from '@napi-rs/canvas';
import { createNoise2D } from 'simplex-noise';
import { makeStream } from './rng.js';
import { effectViewport } from './layout.js';

const luminance = (data, i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];

function texture(artwork) {
  const { width, height } = effectViewport(artwork.viewport);
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const rng = makeStream(artwork.effects.textureSeed, artwork.version, 'grain');
  const noise = createNoise2D(makeStream(artwork.effects.textureSeed, artwork.version, 'fibers'));
  const light = artwork.palette.theme === 'dark' ? 255 : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, grain = rng();
      const fiber = (noise(x / width * artwork.viewport.width * 0.02, y / height * artwork.viewport.height * 0.08) + 1) / 2;
      image.data[i] = light;
      image.data[i + 1] = light;
      image.data[i + 2] = light;
      image.data[i + 3] = artwork.effects.material === 'ink' ? (grain > 0.88 ? 210 : 0) : (grain * 0.6 + fiber * 0.4) * 180;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function glow(source) {
  const canvas = createCanvas(source.width, source.height), ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, source.width, source.height), d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const highlight = Math.max(0, (luminance(d, i) - 145) / 110);
    d[i] *= highlight; d[i + 1] *= highlight; d[i + 2] *= highlight;
  }
  ctx.putImageData(image, 0, 0);
  const blurred = createCanvas(source.width, source.height), blurCtx = blurred.getContext('2d');
  blurCtx.filter = 'blur(6px)';
  blurCtx.drawImage(canvas, 0, 0);
  return blurred;
}

function sortedPatch(source, artwork) {
  const { width, height } = source;
  const input = source.getContext('2d').getImageData(0, 0, width, height).data;
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  const output = ctx.createImageData(width, height);
  const rng = makeStream(artwork.seed, artwork.version, 'effects', 'sort-parameters');
  const threshold = rng.range(60, 145), maxRun = rng.int(20, 95);
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (luminance(input, (y * width + x) * 4) <= threshold) { x++; continue; }
      const start = x, order = [];
      while (x < width && x - start < maxRun && luminance(input, (y * width + x) * 4) > threshold) order.push((y * width + x++) * 4);
      if (order.length < 3) continue;
      order.sort((a, b) => luminance(input, a) - luminance(input, b));
      for (let k = 0; k < order.length; k++) output.data.set(input.subarray(order[k], order[k] + 4), (y * width + start + k) * 4);
    }
  }
  ctx.putImageData(output, 0, 0);
  return canvas;
}

function tint(source, artwork) {
  const canvas = createCanvas(source.width, source.height), ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, source.width, source.height), d = image.data;
  const dark = artwork.palette.dominant.map((v) => v * 0.1);
  const light = artwork.palette.accent.map((v) => 255 - (255 - v) * 0.15);
  for (let i = 0; i < d.length; i += 4) {
    let lum = luminance(d, i) / 255;
    if (artwork.effects.posterize) lum = Math.round(lum * 5) / 5;
    for (let c = 0; c < 3; c++) d[i + c] = artwork.effects.duotone ? dark[c] + (light[c] - dark[c]) * lum : Math.round(d[i + c] / 51) * 51;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function aberration(source) {
  const { width, height } = source;
  const input = source.getContext('2d').getImageData(0, 0, width, height).data;
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  const output = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      output.data[i] = input[(y * width + Math.min(width - 1, x + 2)) * 4];
      output.data[i + 1] = input[i + 1];
      output.data[i + 2] = input[(y * width + Math.max(0, x - 2)) * 4 + 2];
      output.data[i + 3] = 255;
    }
  }
  ctx.putImageData(output, 0, 0);
  return canvas;
}

export function applyFinish(artwork, canvas, makeSource) {
  const ctx = canvas.getContext('2d'), { width, height } = canvas;
  const effects = artwork.effects;
  ctx.imageSmoothingQuality = 'high';
  let source;
  const canonical = () => source ??= makeSource();
  // Destructive color/glitch finishes intentionally use a canonical raster.
  // Unaffected geometry and pixel-sort's untouched regions remain native-res.
  if (effects.duotone || effects.posterize) {
    source = tint(canonical(), artwork);
    ctx.drawImage(source, 0, 0, width, height);
  }
  if (effects.aberration) {
    source = aberration(canonical());
    ctx.drawImage(source, 0, 0, width, height);
  }
  if (effects.pixelSort) {
    const patch = sortedPatch(canonical(), artwork);
    ctx.drawImage(patch, 0, 0, width, height);
    source.getContext('2d').drawImage(patch, 0, 0);
  }
  if (effects.glow) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = effects.glowStrength;
    ctx.drawImage(glow(canonical()), 0, 0, width, height);
    ctx.restore();
  }
  if (effects.material !== 'clean') {
    ctx.save();
    ctx.globalAlpha = effects.textureOpacity;
    ctx.drawImage(texture(artwork), 0, 0, width, height);
    ctx.restore();
  }
  if (effects.vignette || effects.scanlines) {
    const size = effectViewport(artwork.viewport), mask = createCanvas(size.width, size.height);
    const maskCtx = mask.getContext('2d'), image = maskCtx.createImageData(size.width, size.height);
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const radius = ((x / size.width - 0.5) ** 2 + (y / size.height - 0.5) ** 2) * 2;
        image.data[(y * size.width + x) * 4 + 3] = 255 * Math.min(0.65, radius * effects.vignette + (effects.scanlines && y % 3 === 0 ? 0.13 : 0));
      }
    }
    maskCtx.putImageData(image, 0, 0);
    ctx.drawImage(mask, 0, 0, width, height);
  }
}
