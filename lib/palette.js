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
