import { createNoise2D, createNoise3D } from 'simplex-noise';
import {
  drawAttractor, drawTruchet, drawRibbons,
  drawContours, drawDelaunay, drawSpirograph,
} from './shapes.js';

const BLEND_MODES = [
  'multiply', 'screen', 'overlay', 'soft-light',
  'hard-light', 'color-dodge', 'lighten', 'darken', 'difference',
];

export function rgbaStr([r, g, b], a = 1) {
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

export function drawLayers(ctx, w, h, rng, palette) {
  const layerCount = rng.int(5, 12);
  const kinds = Object.keys(KINDS);

  for (let i = 0; i < layerCount; i++) {
    ctx.save();
    ctx.globalCompositeOperation = rng.pick(BLEND_MODES); // layered blend modes
    ctx.globalAlpha = rng.range(0.3, 0.9);

    KINDS[rng.pick(kinds)](ctx, w, h, rng, palette);

    ctx.restore();
  }
}

function drawBlobs(ctx, w, h, rng, pal) {
  const n = rng.int(8, 30);
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, w), y = rng.range(0, h);
    const r = rng.range(10, Math.min(w, h) * 0.3);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = rgbaStr(pal.pick(), rng.range(0.4, 1));
    ctx.fill();
  }
}

function drawPolygons(ctx, w, h, rng, pal) {
  const n = rng.int(5, 20);
  for (let i = 0; i < n; i++) {
    const sides = rng.int(3, 8);
    const cx = rng.range(0, w), cy = rng.range(0, h);
    const rad = rng.range(20, Math.min(w, h) * 0.25);
    const rot = rng.range(0, Math.PI * 2);
    ctx.beginPath();
    for (let s = 0; s <= sides; s++) {
      const a = rot + (s / sides) * Math.PI * 2;
      const px = cx + Math.cos(a) * rad;
      const py = cy + Math.sin(a) * rad;
      s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = rgbaStr(pal.pick(), rng.range(0.4, 0.9));
    ctx.fill();
  }
}

function drawBezier(ctx, w, h, rng, pal) {
  const n = rng.int(10, 40);
  ctx.lineWidth = rng.range(1, 6);
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(rng.range(0, w), rng.range(0, h));
    ctx.bezierCurveTo(
      rng.range(0, w), rng.range(0, h),
      rng.range(0, w), rng.range(0, h),
      rng.range(0, w), rng.range(0, h)
    );
    ctx.strokeStyle = rgbaStr(pal.pick(), rng.range(0.3, 0.8));
    ctx.stroke();
  }
}

function drawGradient(ctx, w, h, rng, pal) {
  const g = ctx.createLinearGradient(
    rng.range(0, w), rng.range(0, h),
    rng.range(0, w), rng.range(0, h)
  );
  const stops = rng.int(2, 4);
  for (let i = 0; i <= stops; i++) {
    g.addColorStop(i / stops, rgbaStr(pal.pick(), rng.range(0.3, 0.8)));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawVoronoi(ctx, w, h, rng, pal) {
  // Cheap Voronoi-cell look via overlapping radial gradients
  const sites = rng.int(8, 25);
  for (let i = 0; i < sites; i++) {
    const x = rng.range(0, w), y = rng.range(0, h);
    const r = rng.range(40, Math.min(w, h) * 0.4);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = pal.pick();
    g.addColorStop(0, rgbaStr(c, 0.9));
    g.addColorStop(1, rgbaStr(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFlowField(ctx, w, h, rng, pal) {
  const noise = createNoise2D(rng);
  const scale = rng.range(0.002, 0.01);
  const lines = rng.int(200, 600);
  ctx.lineWidth = rng.range(0.5, 2);
  for (let i = 0; i < lines; i++) {
    let x = rng.range(0, w), y = rng.range(0, h);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = rng.int(10, 40);
    for (let s = 0; s < steps; s++) {
      const ang = noise(x * scale, y * scale) * Math.PI * 2;
      x += Math.cos(ang) * 4;
      y += Math.sin(ang) * 4;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgbaStr(pal.pick(), rng.range(0.2, 0.5));
    ctx.stroke();
  }
}

function drawNoiseField(ctx, w, h, rng, pal) {
  // Perlin/Simplex-based organic texture, drawn at low-res then scaled
  const noise = createNoise3D(rng);
  const cell = rng.int(4, 12);
  const z = rng.range(0, 100);
  const scale = rng.range(0.005, 0.02);
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const v = (noise(x * scale, y * scale, z) + 1) / 2;
      const c = pal.colors[Math.floor(v * pal.colors.length) % pal.colors.length];
      ctx.fillStyle = rgbaStr(c, v * 0.6);
      ctx.fillRect(x, y, cell, cell);
    }
  }
}

export { BLEND_MODES };

// Layer kinds: local primitives above + complex generators from shapes.js
const KINDS = {
  blobs: drawBlobs,
  polygons: drawPolygons,
  bezier: drawBezier,
  gradientField: drawGradient,
  voronoi: drawVoronoi,
  flowField: drawFlowField,
  noiseField: drawNoiseField,
  attractor: drawAttractor,
  truchet: drawTruchet,
  ribbons: drawRibbons,
  contours: drawContours,
  delaunay: drawDelaunay,
  spirograph: drawSpirograph,
};
