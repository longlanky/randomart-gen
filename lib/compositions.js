import { createNoise2D } from 'simplex-noise';
import Delaunator from 'delaunator';

const TAU = Math.PI * 2;
const point = (x, y) => `${x.toFixed(3)} ${y.toFixed(3)}`;
const path = (points, closed = false) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${point(x, y)}`).join(' ') + (closed ? ' Z' : '');
const circle = (x, y, radius, fill, extra = {}) => ({ type: 'circle', x, y, radius, fill, ...extra });
const line = (points, stroke, width, extra = {}) => ({ type: 'path', path: path(points), stroke, width, ...extra });
const layer = (id, role, marks) => ({ id, role, marks });

function pickColor(rng, palette) {
  const n = rng();
  return n < 0.65 ? palette.dominant : n < 0.94 ? palette.support : palette.accent;
}

function quietAt(x, y, composition) {
  const [qx, qy, radius] = composition.quiet;
  return Math.hypot(x - qx, y - qy) < radius;
}

// Bounded rejection sampling gives landmarks breathing room. The count and
// coordinates live in logical space, never in output pixels.
function spacedPoints(rng, count, gap, bounds = [90, 90, 910, 910]) {
  const [x0, y0, x1, y1] = bounds;
  const points = [];
  for (let i = 0; i < count * 60 && points.length < count; i++) {
    const p = [rng.range(x0, x1), rng.range(y0, y1)];
    if (points.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= gap)) points.push(p);
  }
  return points;
}

export function composeMinimal(composition, palette, stream) {
  const rng = stream('minimal', 'structure');
  const colors = stream('minimal', 'colors');
  const variant = rng.pick(['cutouts', 'facets', 'arcs']);
  const primary = [], detail = [];
  const [fx, fy] = composition.focal;
  const rotation = composition.direction;

  if (variant === 'facets') {
    const sites = spacedPoints(rng, rng.int(9, 17), 95, [200, 190, 800, 810]);
    const { triangles } = Delaunator.from(sites);
    for (let i = 0; i < triangles.length; i += 3) {
      const pts = [sites[triangles[i]], sites[triangles[i + 1]], sites[triangles[i + 2]]];
      const cx = pts.reduce((s, p) => s + p[0], 0) / 3;
      const cy = pts.reduce((s, p) => s + p[1], 0) / 3;
      const inset = rng.range(0.83, 0.98);
      primary.push({ type: 'path', path: path(pts.map(([x, y]) => [cx + (x - cx) * inset, cy + (y - cy) * inset]), true), fill: pickColor(colors, palette) });
    }
  } else if (variant === 'arcs') {
    const rings = rng.int(3, 7);
    const start = rotation;
    const sweep = rng.range(Math.PI * 0.9, Math.PI * 1.7);
    for (let i = 0; i < rings; i++) {
      const radius = 75 + i * 40;
      const pts = Array.from({ length: 100 }, (_, k) => {
        const a = start + sweep * k / 99;
        return [fx + Math.cos(a) * radius, fy + Math.sin(a) * radius];
      });
      primary.push(line(pts, pickColor(colors, palette), rng.range(12, 29)));
    }
    primary.push(circle(fx, fy, rng.range(20, 42), palette.accent));
  } else {
    const n = rng.int(3, 6);
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * 105;
      const x = fx + Math.cos(rotation) * t + rng.range(-70, 70);
      const y = fy + Math.sin(rotation) * t + rng.range(-70, 70);
      const radius = rng.range(80, 165);
      const fill = pickColor(colors, palette);
      if (rng.chance(0.45)) primary.push(circle(x, y, radius, fill));
      else {
        const sides = rng.pick([3, 4, 6]);
        const pts = Array.from({ length: sides }, (_, k) => {
          const a = rotation + k * TAU / sides;
          return [x + Math.cos(a) * radius, y + Math.sin(a) * radius];
        });
        primary.push({ type: 'path', path: path(pts, true), fill });
      }
    }
  }

  const accents = stream('minimal', 'accents');
  for (const [x, y] of spacedPoints(accents, accents.int(3, 7), 90)) {
    if (!quietAt(x, y, composition)) detail.push(circle(x, y, accents.range(3, 9), palette.ink));
  }
  if (accents.chance(0.6)) {
    const x = accents.range(140, 260), y = accents.range(690, 820);
    const hatchCount = accents.int(5, 10);
    for (let i = 0; i < hatchCount; i++) {
      detail.push(line([[x, y - i * 9], [x + 160, y - i * 9]], palette.ink, 1.4, { opacity: 0.55 }));
    }
  }
  return { variant, layers: [layer('structure', 'primary', primary), layer('accents', 'detail', detail)] };
}

export function composeOrganic(composition, palette, stream) {
  const rng = stream('organic', 'structure');
  const colors = stream('organic', 'colors');
  const noise = createNoise2D(stream('organic', 'field'));
  const variant = rng.pick(['currents', 'ribbons', 'eddy']);
  const frequency = rng.range(0.0013, 0.003);
  const warp = rng.range(70, 180);
  const [fx, fy] = composition.focal;
  const angleAt = (x, y) => {
    const nx = x + noise(x * frequency, y * frequency) * warp;
    const ny = y + noise(x * frequency + 13, y * frequency - 9) * warp;
    const bend = noise(nx * frequency, ny * frequency) * 2.4;
    const base = variant === 'eddy' ? Math.atan2(y - fy, x - fx) + Math.PI / 2 : composition.direction;
    return base + bend * (variant === 'eddy' ? 0.35 : 1);
  };
  const primary = [], detail = [];
  const count = Math.round((variant === 'ribbons' ? 65 : 310) * composition.density);
  const starts = spacedPoints(rng, count, variant === 'ribbons' ? 26 : 12, [80, 80, 920, 920]);
  for (let i = 0; i < starts.length; i++) {
    let [x, y] = starts[i];
    if (quietAt(x, y, composition)) continue;
    const pts = [[x, y]];
    const steps = rng.int(40, 125);
    for (let s = 0; s < steps; s++) {
      const angle = angleAt(x, y);
      x += Math.cos(angle) * 3.5;
      y += Math.sin(angle) * 3.5;
      if (x < 65 || x > 935 || y < 65 || y > 935 || quietAt(x, y, composition)) break;
      pts.push([x, y]);
    }
    if (pts.length < 8) continue;
    const color = pickColor(colors, palette);
    const width = variant === 'ribbons' ? rng.range(8, 23) : rng.range(0.8, 3.5);
    primary.push(line(pts, color, width, { opacity: variant === 'ribbons' ? 0.65 : 0.8 }));
    if (variant === 'ribbons') detail.push(line(pts, color, 1, { opacity: 0.85 }));
  }

  // Landmarks follow the same directional field as the main paths.
  const accents = stream('organic', 'accents');
  for (const [x, y] of spacedPoints(accents, 80, 32)) {
    if (quietAt(x, y, composition)) continue;
    const angle = angleAt(x, y);
    const length = accents.range(3, 12);
    detail.push(line([[x, y], [x + Math.cos(angle) * length, y + Math.sin(angle) * length]], palette.accent, accents.range(1, 3), { opacity: 0.7 }));
  }
  return { variant, layers: [layer('flow', 'primary', primary), layer('landmarks', 'detail', detail)] };
}

export function composeOrnamental(composition, palette, stream) {
  const rng = stream('ornamental', 'structure');
  const colors = stream('ornamental', 'colors');
  const variant = rng.pick(['rosette', 'tiles', 'orbits']);
  const primary = [], detail = [];
  if (variant === 'tiles') {
    const count = rng.int(5, 9);
    const cell = 760 / count;
    const motif = rng.pick(['arcs', 'petals', 'diagonals']);
    for (let gy = 0; gy < count; gy++) {
      for (let gx = 0; gx < count; gx++) {
        const tile = stream('ornamental', 'cell', gx, gy);
        const color = pickColor(tile, palette);
        const children = [];
        if (motif === 'arcs') {
          for (const [cx, cy, start] of [[-cell / 2, -cell / 2, 0], [cell / 2, cell / 2, Math.PI]]) {
            for (const r of [cell * 0.26, cell * 0.5, cell * 0.74]) {
              const pts = Array.from({ length: 30 }, (_, k) => {
                const a = start + k / 29 * Math.PI / 2;
                return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
              });
              children.push(line(pts, color, cell * 0.045));
            }
          }
        } else if (motif === 'petals') {
          const r = cell * 0.42;
          children.push({ type: 'path', path: `M${point(-r, -r)} Q${point(r, -r)} ${point(r, r)} Q${point(-r, r)} ${point(-r, -r)} Z`, fill: color });
          children.push(line([[-r * 0.7, -r * 0.7], [r * 0.7, r * 0.7]], palette.background, 2));
        } else {
          for (let i = -1; i <= 1; i++) children.push(line([[-cell * 0.32, cell * (0.22 + i * 0.13)], [cell * 0.32, cell * (-0.22 + i * 0.13)]], color, cell * 0.075));
        }
        primary.push({ type: 'group', x: 120 + (gx + 0.5) * cell, y: 120 + (gy + 0.5) * cell, rotation: tile.int(0, 3) * Math.PI / 2, children });
      }
    }
  } else if (variant === 'rosette') {
    const sectors = rng.pick([6, 8, 10, 12, 16]);
    const rings = rng.int(2, 4);
    for (let ring = 0; ring < rings; ring++) {
      const radius = 95 + ring * 83;
      const length = rng.range(70, 125);
      const width = rng.range(14, 35);
      const fill = pickColor(colors, palette);
      const petal = { type: 'path', path: `M${point(radius - length / 2, 0)} Q${point(radius, -width)} ${point(radius + length / 2, 0)} Q${point(radius, width)} ${point(radius - length / 2, 0)} Z`, fill, opacity: 0.85 };
      for (let k = 0; k < sectors; k++) {
        primary.push({ type: 'group', x: 500, y: 500, rotation: composition.direction + (k + (ring % 2) / 2) * TAU / sectors, children: [petal] });
      }
      detail.push(circle(500, 500, radius, null, { stroke: palette.ink, width: 0.9, opacity: 0.35 }));
    }
    primary.push(circle(500, 500, 20, palette.accent));
  } else {
    const lobes = rng.int(3, 9);
    const rings = rng.int(5, 12);
    const twist = rng.range(0.05, 0.22);
    for (let ring = 0; ring < rings; ring++) {
      const pts = Array.from({ length: 721 }, (_, k) => {
        const a = k * TAU / 720;
        const radius = 110 + ring * 18 + Math.sin(a * lobes) * (35 + ring * 3);
        return [500 + Math.cos(a + ring * twist) * radius, 500 + Math.sin(a + ring * twist) * radius];
      });
      primary.push(line(pts, pickColor(colors, palette), rng.range(1.2, 3.5)));
    }
  }
  if (rng.chance(0.5)) detail.push({ type: 'path', path: path([[85, 85], [915, 85], [915, 915], [85, 915]], true), stroke: palette.ink, width: 1, opacity: 0.4 });
  return { variant, layers: [layer('motifs', 'primary', primary), layer('frame', 'detail', detail)] };
}
