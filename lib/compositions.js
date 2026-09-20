import { createNoise2D } from 'simplex-noise';
import Delaunator from 'delaunator';
import { TAU, point, circle, line, polygon, layer, pickColor, spacedPoints, quietAt, gridSize } from './geometry.js';

export function composeMinimal(viewport, composition, palette, stream) {
  const { width: w, height: h } = viewport;
  const rng = stream('minimal', 'structure'), colors = stream('minimal', 'colors');
  const variant = rng.pick(['cutouts', 'facets', 'arcs']);
  const primary = [], detail = [];
  const landscape = w >= h, long = Math.max(w, h);
  const [fx, fy] = composition.focal;

  if (variant === 'facets') {
    const sites = spacedPoints(rng, 26, 105, [0, 0, w, h]);
    sites.push([-100, -100], [w + 100, -100], [w + 100, h + 100], [-100, h + 100]);
    const { triangles } = Delaunator.from(sites);
    for (let i = 0; i < triangles.length; i += 3) {
      const pts = [sites[triangles[i]], sites[triangles[i + 1]], sites[triangles[i + 2]]];
      const cx = pts.reduce((s, p) => s + p[0], 0) / 3;
      const cy = pts.reduce((s, p) => s + p[1], 0) / 3;
      const inset = rng.range(0.96, 0.995);
      primary.push(polygon(pts.map(([x, y]) => [cx + (x - cx) * inset, cy + (y - cy) * inset]), pickColor(colors, palette)));
    }
  } else if (variant === 'arcs') {
    const clusters = Math.min(8, Math.max(2, Math.ceil(long / 800)));
    for (let j = 0; j < clusters; j++) {
      const x = landscape ? (j + 0.5) * w / clusters : fx;
      const y = landscape ? fy : (j + 0.5) * h / clusters;
      const rings = rng.int(4, 7);
      const start = composition.direction + j * 1.3;
      const sweep = rng.range(Math.PI * 1.1, Math.PI * 1.8);
      for (let i = 0; i < rings; i++) {
        const radius = 150 + i * 65;
        const pts = Array.from({ length: 120 }, (_, k) => {
          const a = start + sweep * k / 119;
          return [x + Math.cos(a) * radius, y + Math.sin(a) * radius];
        });
        primary.push(line(pts, pickColor(colors, palette), rng.range(20, 44)));
      }
      primary.push(circle(x, y, rng.range(35, 70), palette.accent));
    }
  } else {
    // A broad edge-to-edge plane anchors scattered, overlapping cutouts.
    primary.push(polygon([[0, h * 0.08], [w, h * 0.65], [w, h], [0, h * 0.65]], palette.support, { opacity: 0.32 }));
    const count = Math.min(14, Math.ceil(5 + long / 650));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.25) / count;
      const x = landscape ? t * w : rng.range(0.08, 0.92) * w;
      const y = landscape ? rng.range(0.08, 0.92) * h : t * h;
      const radius = rng.range(160, 320);
      const fill = pickColor(colors, palette);
      if (rng.chance(0.45)) primary.push(circle(x, y, radius, fill));
      else {
        const sides = rng.pick([3, 4, 6]);
        const pts = Array.from({ length: sides }, (_, k) => {
          const a = composition.direction + k * TAU / sides;
          return [x + Math.cos(a) * radius, y + Math.sin(a) * radius];
        });
        primary.push(polygon(pts, fill));
      }
    }
  }
  const accents = stream('minimal', 'accents');
  for (const [x, y] of spacedPoints(accents, 18, 85, [0, 0, w, h])) {
    if (!quietAt(x, y, composition)) detail.push(circle(x, y, accents.range(3, 9), palette.ink));
  }
  return { variant, layers: [layer('structure', 'primary', primary), layer('accents', 'detail', detail)] };
}

export function composeOrganic(viewport, composition, palette, stream) {
  const { width: w, height: h } = viewport;
  const rng = stream('organic', 'structure'), colors = stream('organic', 'colors');
  const noise = createNoise2D(stream('organic', 'field'));
  const variant = rng.pick(['currents', 'ribbons', 'eddy']);
  const frequency = rng.range(0.0013, 0.003), warp = rng.range(70, 180);
  const [fx, fy] = composition.focal;
  const angleAt = (x, y) => {
    const nx = x + noise(x * frequency, y * frequency) * warp;
    const ny = y + noise(x * frequency + 13, y * frequency - 9) * warp;
    const bend = noise(nx * frequency, ny * frequency) * 2.4;
    const base = variant === 'eddy' ? Math.atan2(y - fy, x - fx) + Math.PI / 2 : composition.direction;
    return base + bend * (variant === 'eddy' ? 0.35 : 1);
  };
  const primary = [], detail = [];
  const density = Math.min(3, w * h / 1e6) * composition.density;
  const count = Math.round((variant === 'ribbons' ? 95 : 390) * density);
  const starts = spacedPoints(rng, count, variant === 'ribbons' ? 23 : 10, [-90, -90, w + 90, h + 90]);
  for (const start of starts) {
    let [x, y] = start;
    if (quietAt(x, y, composition)) continue;
    const pts = [[x, y]], steps = rng.int(60, 170);
    for (let s = 0; s < steps; s++) {
      const angle = angleAt(x, y);
      x += Math.cos(angle) * 5;
      y += Math.sin(angle) * 5;
      if (x < -140 || x > w + 140 || y < -140 || y > h + 140 || quietAt(x, y, composition)) break;
      pts.push([x, y]);
    }
    if (pts.length < 8) continue;
    const color = pickColor(colors, palette);
    primary.push(line(pts, color, variant === 'ribbons' ? rng.range(10, 28) : rng.range(1, 4), { opacity: 0.75 }));
    if (variant === 'ribbons') detail.push(line(pts, palette.accent, 1, { opacity: 0.5 }));
  }
  const accents = stream('organic', 'accents');
  for (const [x, y] of spacedPoints(accents, 120, 25, [0, 0, w, h])) {
    if (quietAt(x, y, composition)) continue;
    const angle = angleAt(x, y), length = accents.range(4, 15);
    detail.push(line([[x, y], [x + Math.cos(angle) * length, y + Math.sin(angle) * length]], palette.accent, accents.range(1, 3), { opacity: 0.7 }));
  }
  return { variant, layers: [layer('flow', 'primary', primary), layer('landmarks', 'detail', detail)] };
}

export function composeOrnamental(viewport, composition, palette, stream) {
  const { width: w, height: h } = viewport;
  const rng = stream('ornamental', 'structure'), colors = stream('ornamental', 'colors');
  const variant = rng.pick(['rosette', 'tiles', 'orbits']);
  const primary = [];
  if (variant === 'tiles') {
    const { columns, rows, dx, dy } = gridSize(viewport, rng.int(45, 110));
    const motif = rng.pick(['arcs', 'petals', 'diagonals']);
    const cell = Math.min(dx, dy);
    for (let gy = 0; gy <= rows; gy++) {
      for (let gx = 0; gx <= columns; gx++) {
        const tile = stream('ornamental', 'cell', gx, gy);
        const color = pickColor(tile, palette), children = [];
        if (motif === 'arcs') {
          for (const [cx, cy, start] of [[-cell / 2, -cell / 2, 0], [cell / 2, cell / 2, Math.PI]]) {
            for (const r of [cell * 0.26, cell * 0.5, cell * 0.74]) {
              const pts = Array.from({ length: 30 }, (_, k) => {
                const a = start + k / 29 * Math.PI / 2;
                return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
              });
              children.push(line(pts, color, cell * 0.05));
            }
          }
        } else if (motif === 'petals') {
          const r = cell * 0.48;
          children.push({ type: 'path', path: `M${point(-r, -r)} Q${point(r, -r)} ${point(r, r)} Q${point(-r, r)} ${point(-r, -r)} Z`, fill: color });
          children.push(line([[-r * 0.7, -r * 0.7], [r * 0.7, r * 0.7]], palette.background, 2));
        } else {
          for (let i = -1; i <= 1; i++) children.push(line([[-cell * 0.4, cell * (0.25 + i * 0.16)], [cell * 0.4, cell * (-0.25 + i * 0.16)]], color, cell * 0.08));
        }
        primary.push({ type: 'group', x: gx * dx, y: gy * dy, rotation: tile.int(0, 3) * Math.PI / 2, children });
      }
    }
  } else {
    const landscape = w >= h;
    const repeats = Math.min(10, Math.max(1, Math.round(Math.max(w, h) / 900)));
    const centers = Array.from({ length: repeats }, (_, i) => landscape ? [(i + 0.5) * w / repeats, h / 2] : [w / 2, (i + 0.5) * h / repeats]);
    const rings = rng.int(5, 9), lobes = rng.int(5, 10), sectors = rng.pick([8, 10, 12, 16]);
    const twist = rng.range(0.05, 0.16);
    for (const [cx, cy] of centers) {
      const children = [];
      for (let ring = 0; ring < rings; ring++) {
        const fill = pickColor(colors, palette);
        if (variant === 'rosette') {
          const radius = 75 + ring * 64, length = 90 + ring * 10, halfWidth = 12 + ring * 3;
          const petal = { type: 'path', path: `M${point(radius - length / 2, 0)} Q${point(radius, -halfWidth)} ${point(radius + length / 2, 0)} Q${point(radius, halfWidth)} ${point(radius - length / 2, 0)} Z`, fill, opacity: 0.85 };
          for (let k = 0; k < sectors; k++) children.push({ type: 'group', x: 0, y: 0, rotation: composition.direction + (k + (ring % 2) / 2) * TAU / sectors, children: [petal] });
        } else {
          const pts = Array.from({ length: 721 }, (_, k) => {
            const a = k * TAU / 720, radius = 175 + ring * 43 + Math.sin(a * lobes) * (55 + ring * 5);
            return [Math.cos(a + ring * twist) * radius, Math.sin(a + ring * twist) * radius];
          });
          children.push(line(pts, fill, rng.range(2, 5)));
        }
      }
      primary.push({ type: 'group', x: cx, y: cy, rotation: 0, children });
    }
    // Corner echoes distribute the pattern into the full rectangle.
    const echo = primary[0].children;
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) primary.push({ type: 'group', x, y, rotation: 0, opacity: 0.25, children: echo });
  }
  return { variant, layers: [layer('motifs', 'primary', primary)] };
}
