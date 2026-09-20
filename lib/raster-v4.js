// Frozen v4 fitted rendering, retained for reproducing existing artwork.
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { createNoise2D } from 'simplex-noise';
import { makeStream } from './rng.js';
import { parseDim, MIN_DIM } from './dims.js';

const EFFECT_SIZE = 512;
const cssColor = (rgb) => `rgb(${rgb.join(',')})`;

export function fittedViewport(width, height, logicalSize) {
  const side = Math.min(width, height);
  // Integer placement avoids resampling the artwork when the margin is odd.
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side, scale: side / logicalSize };
}

function drawMark(ctx, mark) {
  ctx.save();
  ctx.globalAlpha *= mark.opacity ?? 1;
  ctx.globalCompositeOperation = mark.blend ?? 'source-over';
  if (mark.type === 'group') {
    ctx.translate(mark.x, mark.y);
    ctx.rotate(mark.rotation);
    for (const child of mark.children) drawMark(ctx, child);
  } else {
    let shape;
    if (mark.type === 'circle') {
      shape = new Path2D();
      shape.arc(mark.x, mark.y, mark.radius, 0, Math.PI * 2);
    } else {
      shape = new Path2D(mark.path);
    }
    if (mark.fill) {
      ctx.fillStyle = cssColor(mark.fill);
      ctx.fill(shape);
    }
    if (mark.stroke) {
      ctx.strokeStyle = cssColor(mark.stroke);
      ctx.lineWidth = mark.width;
      ctx.stroke(shape);
    }
  }
  ctx.restore();
}

function drawGeometry(artwork, side) {
  const canvas = createCanvas(side, side);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = cssColor(artwork.palette.background);
  ctx.fillRect(0, 0, side, side);
  ctx.scale(side / artwork.size, side / artwork.size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const layer of artwork.layers) {
    for (const mark of layer.marks) drawMark(ctx, mark);
  }
  return canvas;
}

function makeTexture(artwork) {
  const canvas = createCanvas(EFFECT_SIZE, EFFECT_SIZE);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(EFFECT_SIZE, EFFECT_SIZE);
  const rng = makeStream(artwork.effects.textureSeed, artwork.version, 'grain');
  const noise = createNoise2D(makeStream(artwork.effects.textureSeed, artwork.version, 'fibers'));
  const dark = artwork.palette.theme === 'dark';
  for (let y = 0; y < EFFECT_SIZE; y++) {
    for (let x = 0; x < EFFECT_SIZE; x++) {
      const i = (y * EFFECT_SIZE + x) * 4;
      const grain = rng();
      const fiber = (noise(x * 0.045, y * 0.18) + 1) / 2;
      const value = dark ? 255 : 0;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = artwork.effects.material === 'ink'
        ? (grain > 0.88 ? 210 : 0)
        : (grain * 0.6 + fiber * 0.4) * 180;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function makeGlow(artwork) {
  const source = drawGeometry(artwork, EFFECT_SIZE);
  const ctx = source.getContext('2d');
  const image = ctx.getImageData(0, 0, EFFECT_SIZE, EFFECT_SIZE);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const luminance = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const highlight = Math.max(0, (luminance - 145) / 110);
    d[i] *= highlight;
    d[i + 1] *= highlight;
    d[i + 2] *= highlight;
  }
  ctx.putImageData(image, 0, 0);
  const blurred = createCanvas(EFFECT_SIZE, EFFECT_SIZE);
  const blurCtx = blurred.getContext('2d');
  blurCtx.filter = 'blur(6px)';
  blurCtx.drawImage(source, 0, 0);
  return blurred;
}

export function rasterizeArtwork(artwork, width, height) {
  const w = parseDim(width) ?? MIN_DIM;
  const h = parseDim(height) ?? MIN_DIM;
  const { x, y, side } = fittedViewport(w, h, artwork.size);
  // Geometry rasterizes at export resolution; only materials use a fixed
  // logical buffer, keeping their pattern/decisions independent of pixel count.
  const artboard = drawGeometry(artwork, side);
  const artCtx = artboard.getContext('2d');
  artCtx.resetTransform();
  artCtx.imageSmoothingEnabled = true;
  artCtx.imageSmoothingQuality = 'high';
  if (artwork.effects.glow) {
    artCtx.save();
    artCtx.globalCompositeOperation = 'screen';
    artCtx.globalAlpha = artwork.effects.glowStrength;
    artCtx.drawImage(makeGlow(artwork), 0, 0, side, side);
    artCtx.restore();
  }
  if (artwork.effects.material !== 'clean') {
    artCtx.save();
    artCtx.globalAlpha = artwork.effects.textureOpacity;
    artCtx.drawImage(makeTexture(artwork), 0, 0, side, side);
    artCtx.restore();
  }
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = cssColor(artwork.palette.background);
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(artboard, x, y);
  return canvas;
}
