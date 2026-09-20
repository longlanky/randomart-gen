import { parseDim, MIN_DIM } from './dims.js';

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

// Reduced integer ratios make 1920x1080 and 3840x2160 exactly the same plan.
export function logicalViewport(width = 1, height = 1) {
  const w = parseDim(width) ?? MIN_DIM, h = parseDim(height) ?? MIN_DIM;
  const divisor = gcd(w, h);
  const aspect = [w / divisor, h / divisor];
  const short = Math.min(...aspect);
  return { aspect, width: 1000 * aspect[0] / short, height: 1000 * aspect[1] / short };
}

// All pixel effects have a bounded work budget independent of export pixels.
export function effectViewport(viewport, longest = 512) {
  const scale = longest / Math.max(viewport.width, viewport.height);
  return { width: Math.max(1, Math.round(viewport.width * scale)), height: Math.max(1, Math.round(viewport.height * scale)) };
}
