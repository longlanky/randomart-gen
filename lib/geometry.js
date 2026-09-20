export const TAU = Math.PI * 2;
export const point = (x, y) => `${x.toFixed(3)} ${y.toFixed(3)}`;
export const path = (points, closed = false) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${point(x, y)}`).join(' ') + (closed ? ' Z' : '');
export const circle = (x, y, radius, fill, extra = {}) => ({ type: 'circle', x, y, radius, fill, ...extra });
export const line = (points, stroke, width, extra = {}) => ({ type: 'path', path: path(points), stroke, width, ...extra });
export const polygon = (points, fill, extra = {}) => ({ type: 'path', path: path(points, true), fill, ...extra });
export const layer = (id, role, marks, extra = {}) => ({ id, role, marks, ...extra });

export function pickColor(rng, palette) {
  const n = rng();
  return n < 0.6 ? palette.dominant : n < 0.9 ? palette.support : palette.accent;
}

export function spacedPoints(rng, count, gap, bounds) {
  const [x0, y0, x1, y1] = bounds;
  const points = [];
  for (let i = 0; i < count * 40 && points.length < count; i++) {
    const p = [rng.range(x0, x1), rng.range(y0, y1)];
    if (points.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= gap)) points.push(p);
  }
  return points;
}

export function quietAt(x, y, composition) {
  const [qx, qy, radius] = composition.quiet;
  return Math.hypot(x - qx, y - qy) < radius;
}

// Roughly square cells for normal ratios, with a strict limit even at 4096:1.
export function gridSize(viewport, target) {
  const ratio = viewport.width / viewport.height;
  const columns = Math.max(1, Math.min(target, Math.round(Math.sqrt(target * ratio))));
  const rows = Math.max(1, Math.floor(target / columns));
  return { columns, rows, dx: viewport.width / columns, dy: viewport.height / rows };
}
