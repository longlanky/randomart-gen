import { makeStream } from './rng.js';
import { makeArtPalette } from './palette.js';
import { composeMinimal, composeOrganic, composeOrnamental } from './compositions-v4.js';

const RENDER_VERSION = 'v4';

export const ARTBOARD_SIZE = 1000;
export const FAMILIES = ['minimal', 'organic', 'ornamental'];

// No export dimensions enter this function. This JSON-serializable plan owns
// every artistic decision; rasterization only changes the viewing transform.
export function createArtwork(seed) {
  seed = String(seed);
  const stream = (...path) => makeStream(seed, RENDER_VERSION, ...path);
  const family = stream('family').pick(FAMILIES);
  const palette = makeArtPalette(stream('palette'));
  const rng = stream('composition');
  const composition = {
    focal: [rng.range(330, 670), rng.range(330, 670)],
    direction: rng.range(-Math.PI, Math.PI),
    density: rng.range(0.45, 1),
    quiet: [rng.range(150, 850), rng.range(150, 850), rng.range(110, 200)],
  };
  const composers = { minimal: composeMinimal, organic: composeOrganic, ornamental: composeOrnamental };
  const { variant, layers } = composers[family](composition, palette, stream);
  const finish = stream('finish');
  const material = finish.pick(family === 'minimal' ? ['clean', 'clean', 'paper'] : ['clean', 'paper', 'ink']);
  const effects = {
    material,
    textureSeed: JSON.stringify([seed, RENDER_VERSION, 'texture']),
    textureOpacity: material === 'ink' ? 0.12 : 0.065,
    glow: family === 'organic' && palette.theme === 'dark' && finish.chance(0.65),
    glowStrength: finish.range(0.25, 0.5),
  };
  return { version: RENDER_VERSION, seed, size: ARTBOARD_SIZE, family, variant, palette, composition, layers, effects };
}
