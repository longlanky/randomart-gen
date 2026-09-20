function hslToRgb(h, s, l) {
  h /= 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function makePalette(rng) {
  const baseHue = rng.range(0, 360);
  const sat = rng.range(0.45, 0.85);
  const light = rng.range(0.4, 0.6);

  const schemes = {
    complementary: [0, 180],
    triadic: [0, 120, 240],
    analogous: [0, 30, 60, -30],
    splitComp: [0, 150, 210],
    tetradic: [0, 90, 180, 270],
    monochrome: [0, 0, 0, 0],
    neon: [0, 140, 200, 320],
  };

  const scheme = rng.pick(Object.keys(schemes));
  const offsets = schemes[scheme];

  const colors = offsets.map((off) => {
    const h = (baseHue + off + 360) % 360;
    const l = Math.min(0.85, Math.max(0.15, light + rng.range(-0.15, 0.15)));
    return hslToRgb(h, sat, l);
  });

  return {
    scheme,
    colors,
    pick: () => rng.pick(colors),
    background: hslToRgb(baseHue, sat * 0.3, rng.range(0.08, 0.2)),
  };
}

// Reduce chroma until the OKLCH color fits sRGB, preserving hue and lightness.
export function oklchToRgb(light, chroma, hue) {
  const angle = hue * Math.PI / 180;
  const linear = (c) => {
    const a = c * Math.cos(angle), b = c * Math.sin(angle);
    const l = (light + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (light - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (light - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
  };
  const fits = (rgb) => rgb.every((v) => v >= -1e-7 && v <= 1 + 1e-7);
  let rgb = linear(chroma);
  if (!fits(rgb)) {
    let low = 0, high = chroma;
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      if (fits(linear(mid))) low = mid;
      else high = mid;
    }
    rgb = linear(low);
  }
  return rgb.map((v) => {
    v = Math.max(0, Math.min(1, v));
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  });
}

export function makeArtPalette(rng) {
  const theme = rng.pick(['paper', 'paper', 'dark', 'muted']);
  const scheme = rng.pick(['analogous', 'complementary', 'split', 'monochrome']);
  const hue = rng.range(0, 360);
  const offset = { analogous: 35, complementary: 180, split: 150, monochrome: 0 }[scheme];
  const dark = theme === 'dark';
  const chroma = rng.range(0.08, 0.19);
  const color = (l, c, h = hue) => oklchToRgb(l, c, h);
  return {
    theme,
    scheme,
    background: color(dark ? 0.18 : theme === 'paper' ? 0.96 : 0.8, 0.018),
    dominant: color(dark ? 0.75 : 0.48, chroma),
    support: color(dark ? 0.57 : 0.66, chroma * 0.65, hue + offset),
    accent: color(dark ? 0.89 : 0.62, chroma * 1.2, hue + (scheme === 'monochrome' ? 0 : 180)),
    ink: color(dark ? 0.91 : 0.25, 0.025),
  };
}
