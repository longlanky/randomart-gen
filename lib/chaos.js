import { createNoise2D } from 'simplex-noise';
import Delaunator from 'delaunator';
import { TAU, point, path, circle, line, polygon, layer, gridSize } from './geometry.js';

export const CHAOTIC_KINDS = ['blobs', 'polygons', 'bezier', 'gradient', 'noise', 'flow', 'attractor', 'contours', 'facets', 'tiles', 'spirograph'];
const BLENDS = ['source-over', 'source-over', 'multiply', 'screen', 'overlay', 'soft-light', 'difference', 'color-dodge'];

function gradient(w, h, rng, color) {
  return [{ type: 'gradient', from: [rng() * w, rng() * h], to: [rng() * w, rng() * h], stops: [[0, color()], [0.5, color()], [1, color()]] }];
}

function marksFor(kind, viewport, rng, color, noise) {
  const { width: w, height: h } = viewport;
  const marks = [];
  if (kind === 'gradient') return gradient(w, h, rng, color);
  if (kind === 'blobs' || kind === 'polygons') {
    const count = rng.int(10, 28);
    for (let i = 0; i < count; i++) {
      const x = rng() * w, y = rng() * h, radius = rng.range(60, 360);
      const fill = color();
      if (kind === 'blobs') marks.push(circle(x, y, radius, fill, { opacity: rng.range(0.25, 0.8) }));
      else {
        const sides = rng.int(3, 7), rotation = rng() * TAU;
        marks.push(polygon(Array.from({ length: sides }, (_, k) => [x + Math.cos(rotation + k * TAU / sides) * radius, y + Math.sin(rotation + k * TAU / sides) * radius]), fill, { opacity: rng.range(0.3, 0.85) }));
      }
    }
  } else if (kind === 'bezier') {
    const count = rng.int(15, 40);
    for (let i = 0; i < count; i++) {
      const p = () => point(rng.range(-0.1, 1.1) * w, rng.range(-0.1, 1.1) * h);
      marks.push({ type: 'path', path: `M${p()} C${p()} ${p()} ${p()}`, stroke: color(), width: rng.range(1, 15) });
    }
  } else if (kind === 'noise') {
    const { columns, rows, dx, dy } = gridSize(viewport, 2000);
    const colors = [color(), color(), color(), color()];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const v = (noise(col * 0.08, row * 0.08) + 1) / 2;
        marks.push({ type: 'rect', x: col * dx, y: row * dy, width: dx + 0.1, height: dy + 0.1, fill: colors[Math.min(3, Math.floor(v * 4))], opacity: 0.2 + v * 0.6 });
      }
    }
  } else if (kind === 'flow') {
    const count = rng.int(100, 260), frequency = rng.range(0.001, 0.005);
    const ribbons = rng.chance(0.3), direction = rng() * TAU;
    for (let i = 0; i < count; i++) {
      let x = rng() * w, y = rng() * h;
      const pts = [[x, y]], steps = rng.int(30, 100);
      for (let s = 0; s < steps; s++) {
        const a = direction + noise(x * frequency, y * frequency) * TAU;
        x += Math.cos(a) * 6;
        y += Math.sin(a) * 6;
        pts.push([x, y]);
      }
      marks.push(line(pts, color(), rng.range(ribbons ? 6 : 1, ribbons ? 20 : 4)));
    }
  } else if (kind === 'attractor') {
    const a = rng.range(-2, 2), b = rng.range(-2, 2), c = rng.range(-2, 2), d = rng.range(-2, 2);
    const deJong = rng.chance(0.5), points = [];
    const cx = rng.range(0.2, 0.8) * w, cy = rng.range(0.2, 0.8) * h;
    const scale = rng.range(180, 320);
    let x = rng.range(-1, 1), y = rng.range(-1, 1);
    for (let i = 0; i < 16000; i++) {
      const nx = deJong ? Math.sin(a * y) - Math.cos(b * x) : Math.sin(a * y) + c * Math.cos(a * x);
      const ny = deJong ? Math.sin(c * x) - Math.cos(d * y) : Math.sin(b * x) + d * Math.cos(b * y);
      x = nx; y = ny;
      if (i > 30) points.push([cx + x * scale, cy + y * scale]);
    }
    marks.push({ type: 'points', points, size: 1.8, fill: color(), opacity: 0.3 });
  } else if (kind === 'contours') {
    const { columns, rows, dx, dy } = gridSize(viewport, 2600);
    const frequency = rng.range(0.0015, 0.004), levels = rng.int(4, 8);
    const field = Array.from({ length: (columns + 1) * (rows + 1) }, (_, i) => noise((i % (columns + 1)) * dx * frequency, Math.floor(i / (columns + 1)) * dy * frequency));
    for (let level = 0; level < levels; level++) {
      const threshold = -0.75 + level / (levels - 1) * 1.5;
      let outline = '';
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const coords = [[col * dx, row * dy], [(col + 1) * dx, row * dy], [(col + 1) * dx, (row + 1) * dy], [col * dx, (row + 1) * dy]];
          const values = [field[row * (columns + 1) + col], field[row * (columns + 1) + col + 1], field[(row + 1) * (columns + 1) + col + 1], field[(row + 1) * (columns + 1) + col]];
          const crossings = [];
          for (let k = 0; k < 4; k++) {
            const next = (k + 1) % 4;
            if ((values[k] < threshold) === (values[next] < threshold)) continue;
            const t = (threshold - values[k]) / (values[next] - values[k]);
            crossings.push(coords[k].map((v, axis) => v + (coords[next][axis] - v) * t));
          }
          for (let i = 0; i + 1 < crossings.length; i += 2) outline += `${path(crossings.slice(i, i + 2))} `;
        }
      }
      if (outline) marks.push({ type: 'path', path: outline, stroke: color(), width: rng.range(1.5, 4) });
    }
  } else if (kind === 'facets') {
    const points = Array.from({ length: rng.int(30, 70) }, () => [rng() * w, rng() * h]);
    points.push([-100, -100], [w + 100, -100], [w + 100, h + 100], [-100, h + 100]);
    const { triangles } = Delaunator.from(points);
    for (let i = 0; i < triangles.length; i += 3) marks.push(polygon([points[triangles[i]], points[triangles[i + 1]], points[triangles[i + 2]]], color(), { opacity: rng.range(0.2, 0.65) }));
  } else if (kind === 'tiles') {
    const { columns, rows, dx, dy } = gridSize(viewport, rng.int(60, 160));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const x = col * dx, y = row * dy;
        if (rng.chance(0.5)) marks.push(line([[x, y], [x + dx, y + dy]], color(), Math.min(dx, dy) * 0.1));
        else marks.push(polygon([[x, y], [x + dx, y], [x, y + dy]], color(), { opacity: 0.55 }));
      }
    }
  } else if (kind === 'spirograph') {
    const count = rng.int(2, 5);
    for (let i = 0; i < count; i++) {
      const cx = rng() * w, cy = rng() * h, lobes = rng.int(3, 11), turns = rng.int(2, 6);
      const radius = rng.range(120, 360), inner = rng.range(0.2, 0.7);
      const pts = Array.from({ length: 1601 }, (_, k) => {
        const a = k / 1600 * TAU * turns;
        return [cx + radius * (Math.cos(a) + inner * Math.cos(a * lobes / turns)), cy + radius * (Math.sin(a) - inner * Math.sin(a * lobes / turns))];
      });
      marks.push(line(pts, color(), rng.range(1, 3)));
    }
  }
  return marks;
}

export function composeChaotic(viewport, composition, palette, stream) {
  const intensity = stream('chaos', 'intensity')();
  const variant = intensity < 0.33 ? 'loose' : intensity < 0.66 ? 'layered' : 'turbulent';
  const count = Math.round(5 + intensity * 7), layers = [];
  for (let i = 0; i < count; i++) {
    const selection = stream('chaos', 'layer', i, 'selection');
    const kind = i === 0 ? 'gradient' : selection.pick(CHAOTIC_KINDS);
    const rng = stream('chaos', 'layer', i, 'geometry');
    const colors = stream('chaos', 'layer', i, 'colors');
    const field = createNoise2D(stream('chaos', 'layer', i, 'field'));
    const marks = marksFor(kind, viewport, rng, () => colors.pick(palette.colors), field);
    const solid = ['gradient', 'noise', 'facets', 'blobs', 'polygons'].includes(kind);
    layers.push(layer(`chaos-${i}`, i === 0 ? 'background' : 'primary', marks, {
      kind,
      blend: i === 0 ? 'source-over' : selection.pick(BLENDS),
      opacity: i === 0 ? 0.5 : selection.range(solid ? 0.18 : 0.45, solid ? 0.48 : 0.9),
    }));
  }
  return { variant, layers };
}
