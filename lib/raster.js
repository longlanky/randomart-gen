import { createCanvas, Path2D } from '@napi-rs/canvas';
import { parseDim, MIN_DIM } from './dims.js';
import { logicalViewport, effectViewport } from './layout.js';
import { applyFinish } from './finish.js';

const cssColor = (rgb) => `rgb(${rgb.join(',')})`;

function drawMark(ctx, mark, viewport) {
  ctx.save();
  ctx.globalAlpha *= mark.opacity ?? 1;
  if (mark.blend) ctx.globalCompositeOperation = mark.blend;
  if (mark.type === 'group') {
    ctx.translate(mark.x, mark.y);
    ctx.rotate(mark.rotation);
    for (const child of mark.children) drawMark(ctx, child, viewport);
  } else if (mark.type === 'gradient') {
    const gradient = ctx.createLinearGradient(...mark.from, ...mark.to);
    for (const [offset, color] of mark.stops) gradient.addColorStop(offset, cssColor(color));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
  } else if (mark.type === 'points') {
    ctx.fillStyle = cssColor(mark.fill);
    for (const [x, y] of mark.points) ctx.fillRect(x, y, mark.size, mark.size);
  } else if (mark.type === 'rect') {
    ctx.fillStyle = cssColor(mark.fill);
    ctx.fillRect(mark.x, mark.y, mark.width, mark.height);
  } else {
    let shape;
    if (mark.type === 'circle') {
      shape = new Path2D();
      shape.arc(mark.x, mark.y, mark.radius, 0, Math.PI * 2);
    } else shape = new Path2D(mark.path);
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

function drawGeometry(artwork, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = cssColor(artwork.palette.background);
  ctx.fillRect(0, 0, width, height);
  ctx.scale(width / artwork.viewport.width, height / artwork.viewport.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const layer of artwork.layers) {
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.globalCompositeOperation = layer.blend ?? 'source-over';
    for (const mark of layer.marks) drawMark(ctx, mark, artwork.viewport);
    ctx.restore();
  }
  ctx.resetTransform();
  return canvas;
}

function drawScene(artwork, width, height) {
  const source = drawGeometry(artwork, width, height);
  const mode = artwork.effects.symmetry;
  if (mode === 'none') return source;
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  // Opaque underpainting also covers subpixel wedge boundaries.
  ctx.drawImage(source, 0, 0);
  if (mode === 'mirror') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(width / 2, 0, width / 2, height);
    ctx.clip();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  } else if (mode === 'tile') {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const x = Math.floor(col * width / 2), y = Math.floor(row * height / 2);
        ctx.drawImage(source, x, y, Math.floor((col + 1) * width / 2) - x, Math.floor((row + 1) * height / 2) - y);
      }
    }
  } else if (mode === 'kaleido') {
    const step = Math.PI * 2 / artwork.effects.sectors;
    const radius = Math.hypot(width, height) / 2;
    const cover = 2 * radius / Math.min(width, height);
    for (let k = 0; k < artwork.effects.sectors; k++) {
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate((k + (k % 2)) * step);
      if (k % 2) ctx.scale(1, -1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius + 1, 0, step);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(source, -width * cover / 2, -height * cover / 2, width * cover, height * cover);
      ctx.restore();
    }
  }
  return canvas;
}

export function rasterizeArtwork(artwork, width, height) {
  const w = parseDim(width) ?? MIN_DIM, h = parseDim(height) ?? MIN_DIM;
  const { aspect } = logicalViewport(w, h);
  if (aspect[0] !== artwork.viewport.aspect[0] || aspect[1] !== artwork.viewport.aspect[1]) {
    throw new RangeError('Export aspect ratio must match the artwork plan; create a new plan for a different ratio');
  }
  // Supersample previews so dense subpixel paths do not change brightness when
  // compared with a larger export. Geometry counts and logical widths stay fixed.
  const sampling = Math.min(4, Math.max(1, Math.ceil(768 / Math.max(w, h))));
  const canvas = drawScene(artwork, w * sampling, h * sampling);
  const ctx = canvas.getContext('2d');
  ctx.resetTransform();
  const effectSize = effectViewport(artwork.viewport);
  applyFinish(artwork, canvas, () => drawScene(artwork, effectSize.width, effectSize.height));
  if (sampling === 1) return canvas;
  const output = createCanvas(w, h), outputCtx = output.getContext('2d');
  outputCtx.imageSmoothingQuality = 'high';
  outputCtx.drawImage(canvas, 0, 0, w, h);
  return output;
}
