// Dimension parsing/validation shared by the HTTP layer and its tests.
// Kept side-effect free so it can be unit-tested without booting the server.
export const MIN_DIM = 1;
export const MAX_DIM = 4096;

// Returns an integer in [MIN_DIM, MAX_DIM], or null if the value is not one.
// Deliberately uses Number() + Number.isInteger: parseInt() accepts '800abc'
// and mis-parses '1e3' as 1, both of which used to reach the cache key.
export function parseDim(v) {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < MIN_DIM || n > MAX_DIM) return null;
  return n;
}
