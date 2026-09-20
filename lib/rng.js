// xmur3 hash → mulberry32 PRNG (fast, deterministic)
export function xmur3(str) {
  // Encode to UTF-8 bytes so non-ASCII / special chars hash consistently
  const bytes = new TextEncoder().encode(String(str));
  let h = 1779033703 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seedText) {
  const seedFn = xmur3(String(seedText));
  // Combine several hash outputs for a stronger initial state
  let a = seedFn();
  a ^= seedFn();
  const rng = mulberry32(a);

  // Warm-up: discard the first few values to avoid degenerate openings
  for (let i = 0; i < 15; i++) rng();

  rng.range = (min, max) => min + rng() * (max - min);
  rng.int = (min, max) => Math.floor(rng.range(min, max + 1));
  rng.pick = (arr) => arr[rng.int(0, arr.length - 1)];
  rng.chance = (p) => rng() < p;
  return rng;
}

// Named streams never consume a parent RNG. JSON preserves tuple boundaries,
// including seeds containing punctuation or names that resemble stream paths.
export function makeStream(seed, version, ...path) {
  return makeRng(JSON.stringify([String(seed), version, ...path]));
}
