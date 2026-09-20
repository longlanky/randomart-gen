import { makeStream } from './rng.js';
import { makeArtPalette, makeChaoticPalette } from './palette.js';
import { composeMinimal, composeOrganic, composeOrnamental } from './compositions.js';
import { composeChaotic } from './chaos.js';
import { logicalViewport } from './layout.js';
import { RENDER_VERSION } from './version.js';

export const FAMILIES = ['minimal', 'organic', 'ornamental', 'chaotic'];

export function artworkIdentity(seed) {
  const rng = makeStream(seed, RENDER_VERSION, 'identity');
  const family = rng.chance(0.3) ? 'chaotic' : rng.pick(FAMILIES.slice(0, 3));
  const paletteRng = makeStream(seed, RENDER_VERSION, 'palette');
  const palette = family === 'chaotic' ? makeChaoticPalette(paletteRng) : makeArtPalette(paletteRng);
  return { family, palette };
}

export function createArtwork(seed, width = 1, height = 1) {
  seed = String(seed);
  const viewport = logicalViewport(width, height);
  const stream = (...path) => makeStream(seed, RENDER_VERSION, ...path);
  const { family, palette } = artworkIdentity(seed);
  const rng = stream('composition');
  const composition = {
    focal: [rng.range(0.32, 0.68) * viewport.width, rng.range(0.32, 0.68) * viewport.height],
    direction: rng.range(-Math.PI, Math.PI),
    density: rng.range(0.55, 1),
    quiet: [rng.range(0.15, 0.85) * viewport.width, rng.range(0.15, 0.85) * viewport.height, rng.range(65, 130)],
  };
  const composers = { minimal: composeMinimal, organic: composeOrganic, ornamental: composeOrnamental, chaotic: composeChaotic };
  const { variant, layers } = composers[family](viewport, composition, palette, stream);
  const finish = stream('finish');
  const chaotic = family === 'chaotic';
  const effects = {
    material: finish.pick(chaotic ? ['paper', 'ink', 'ink'] : ['clean', 'clean', 'paper', 'ink']),
    textureSeed: JSON.stringify([seed, RENDER_VERSION, 'texture']),
    textureOpacity: chaotic ? 0.15 : 0.065,
    glow: stream('effects', 'glow').chance(chaotic ? 0.4 : family === 'organic' && palette.theme === 'dark' ? 0.5 : 0),
    glowStrength: stream('effects', 'glow-strength').range(0.2, 0.5),
    symmetry: chaotic ? stream('effects', 'symmetry').pick(['none', 'none', 'none', 'mirror', 'kaleido', 'tile']) : 'none',
    sectors: stream('effects', 'sectors').pick([6, 8, 10]),
    vignette: chaotic && stream('effects', 'vignette').chance(0.4) ? 0.3 : 0,
    scanlines: chaotic && stream('effects', 'scanlines').chance(0.25),
    duotone: chaotic && stream('effects', 'duotone').chance(0.2),
    posterize: chaotic && stream('effects', 'posterize').chance(0.2),
    pixelSort: chaotic && stream('effects', 'pixel-sort').chance(0.22),
    aberration: chaotic && stream('effects', 'aberration').chance(0.35),
  };
  return { version: RENDER_VERSION, seed, viewport, family, variant, palette, composition, layers, effects };
}
