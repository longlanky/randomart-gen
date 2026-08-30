import Delaunator from 'delaunator';
import { createNoise2D } from 'simplex-noise';
import { rgbaStr } from './primitives.js';

// Strange attractor point cloud (Clifford / Peter de Jong orbits)
export function drawAttractor(ctx, w, h, rng, pal) {
  const a = rng.range(-2, 2), b = rng.range(-2, 2);
  const c = rng.range(-2, 2), d = rng.range(-2, 2);
  const deJong = rng.chance(0.5);
  const scale = Math.min(w, h) / 5;
  const ox = w / 2, oy = h / 2;
  let x = rng.range(-1, 1), y = rng.range(-1, 1);
  const points = rng.int(15000, 50000);
  ctx.fillStyle = rgbaStr(pal.pick(), rng.range(0.05, 0.2));
  for (let i = 0; i < points; i++) {
    const nx = deJong ? Math.sin(a * y) - Math.cos(b * x)
                      : Math.sin(a * y) + c * Math.cos(a * x);
    const ny = deJong ? Math.sin(c * x) - Math.cos(d * y)
                      : Math.sin(b * x) + d * Math.cos(b * y);
    x = nx; y = ny;
    if (i < 20) continue; // let the orbit settle onto the attractor
    ctx.fillRect(ox + x * scale, oy + y * scale, 1.2, 1.2);
  }
}

// Truchet tiles: randomly oriented arcs / diagonals / triangles on a grid
export function drawTruchet(ctx, w, h, rng, pal) {
  const cell = rng.int(24, 80);
  ctx.lineWidth = Math.max(1, cell * rng.range(0.08, 0.2));
  for (let gy = 0; gy < h; gy += cell) {
    for (let gx = 0; gx < w; gx += cell) {
      const style = rng.pick(['arcs', 'diagonal', 'triangle', 'dot']);
      ctx.save();
      ctx.translate(gx + cell / 2, gy + cell / 2);
      if (rng.chance(0.5)) ctx.scale(-1, 1);
      ctx.rotate(rng.int(0, 3) * Math.PI / 2);
      ctx.translate(-cell / 2, -cell / 2);
      const c = pal.pick();
      if (style === 'arcs') {
        ctx.strokeStyle = rgbaStr(c, rng.range(0.5, 0.9));
        ctx.beginPath();
        ctx.arc(0, 0, cell / 2, 0, Math.PI / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cell, cell, cell / 2, Math.PI, Math.PI * 1.5);
        ctx.stroke();
      } else if (style === 'diagonal') {
        ctx.strokeStyle = rgbaStr(c, rng.range(0.4, 0.8));
        ctx.beginPath();
        ctx.moveTo(0, cell);
        ctx.lineTo(cell, 0);
        ctx.stroke();
      } else if (style === 'triangle') {
        ctx.fillStyle = rgbaStr(c, rng.range(0.3, 0.7));
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(cell, 0);
        ctx.lineTo(0, cell);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = rgbaStr(c, rng.range(0.4, 0.9));
        ctx.beginPath();
        ctx.arc(cell / 2, cell / 2, cell * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

// Wide noise-guided ribbon strokes with a bright core line
export function drawRibbons(ctx, w, h, rng, pal) {
  const noise = createNoise2D(rng);
  const scale = rng.range(0.002, 0.008);
  const ribbons = rng.int(2, 5);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < ribbons; i++) {
    const x0 = rng.range(0, w), y0 = rng.range(0, h);
    const width = rng.range(8, 42);
    const steps = rng.int(60, 200);
    const stepLen = rng.range(3, 9);
    const color = pal.pick();

    const trace = () => {
      let x = x0, y = y0;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < steps; s++) {
        const ang = noise(x * scale, y * scale) * Math.PI * 4;
        x += Math.cos(ang) * stepLen;
        y += Math.sin(ang) * stepLen;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    ctx.lineWidth = width;
    ctx.strokeStyle = rgbaStr(color, rng.range(0.15, 0.4));
    trace();
    ctx.lineWidth = Math.max(1, width * 0.25);
    ctx.strokeStyle = rgbaStr(color, rng.range(0.4, 0.8));
    trace(); // noise is a pure function, so this retraces the same path
  }
}

// Topographic contour lines from simplex noise (marching squares)
export function drawContours(ctx, w, h, rng, pal) {
  const noise = createNoise2D(rng);
  const cell = rng.int(6, 14);
  const scale = rng.range(0.003, 0.012);
  const levels = rng.int(4, 9);
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const stride = cols + 1;
  const field = new Float32Array(stride * (rows + 1));
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++)
      field[j * stride + i] = noise(i * cell * scale, j * cell * scale);

  ctx.lineWidth = rng.range(0.5, 1.5);
  for (let l = 0; l < levels; l++) {
    const t = -0.8 + (l / (levels - 1)) * 1.6; // thresholds across the noise range
    ctx.strokeStyle = rgbaStr(pal.colors[l % pal.colors.length], 0.6);
    ctx.beginPath();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const v0 = field[j * stride + i];
        const v1 = field[j * stride + i + 1];
        const v2 = field[(j + 1) * stride + i + 1];
        const v3 = field[(j + 1) * stride + i];
        const x = i * cell, y = j * cell;
        const pts = [];
        if ((v0 < t) !== (v1 < t)) pts.push(lerpEdge(x, y, x + cell, y, v0, v1, t));
        if ((v1 < t) !== (v2 < t)) pts.push(lerpEdge(x + cell, y, x + cell, y + cell, v1, v2, t));
        if ((v2 < t) !== (v3 < t)) pts.push(lerpEdge(x + cell, y + cell, x, y + cell, v2, v3, t));
        if ((v3 < t) !== (v0 < t)) pts.push(lerpEdge(x, y + cell, x, y, v3, v0, t));
        if (pts.length < 2) continue;
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(pts[1][0], pts[1][1]);
        if (pts.length === 4) { // ambiguous saddle: connect the other pair too
          ctx.moveTo(pts[2][0], pts[2][1]);
          ctx.lineTo(pts[3][0], pts[3][1]);
        }
      }
    }
    ctx.stroke();
  }
}

function lerpEdge(xa, ya, xb, yb, va, vb, t) {
  const f = (t - va) / (vb - va);
  return [xa + (xb - xa) * f, ya + (yb - ya) * f];
}

// Delaunay triangulation over a jittered grid, filled from the palette
export function drawDelaunay(ctx, w, h, rng, pal) {
  const gap = rng.int(40, 120);
  const pts = [];
  for (let y = 0; y <= h + gap; y += gap)
    for (let x = 0; x <= w + gap; x += gap)
      pts.push([x + rng.range(-gap, gap) * 0.45, y + rng.range(-gap, gap) * 0.45]);
  const extra = rng.int(5, 20);
  for (let i = 0; i < extra; i++) pts.push([rng.range(0, w), rng.range(0, h)]);

  const { triangles } = Delaunator.from(pts);
  for (let i = 0; i < triangles.length; i += 3) {
    const p = pts[triangles[i]], q = pts[triangles[i + 1]], r = pts[triangles[i + 2]];
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
    ctx.lineTo(r[0], r[1]);
    ctx.closePath();
    ctx.fillStyle = rgbaStr(pal.pick(), rng.range(0.3, 0.7));
    ctx.fill();
    if (rng.chance(0.3)) {
      ctx.strokeStyle = rgbaStr(pal.pick(), 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// Hypotrochoid / epitrochoid (spirograph) curves
export function drawSpirograph(ctx, w, h, rng, pal) {
  const curves = rng.int(1, 3);
  for (let i = 0; i < curves; i++) {
    const cx = rng.range(w * 0.2, w * 0.8), cy = rng.range(h * 0.2, h * 0.8);
    const R = rng.int(60, 200), r = rng.int(10, 90), d = rng.int(20, 160);
    const epi = rng.chance(0.5);
    const scale = Math.min(w, h) / (2 * (R + r + d));
    const turns = r / gcd(R, r); // turns needed for the curve to close
    const steps = Math.min(8000, 360 * turns * 4);
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * Math.PI * 2 * turns;
      const x = epi
        ? (R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t)
        : (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
      const y = epi
        ? (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t)
        : (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
      s === 0 ? ctx.moveTo(cx + x * scale, cy + y * scale)
              : ctx.lineTo(cx + x * scale, cy + y * scale);
    }
    ctx.strokeStyle = rgbaStr(pal.pick(), rng.range(0.3, 0.7));
    ctx.lineWidth = rng.range(0.5, 2);
    ctx.stroke();
  }
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}
