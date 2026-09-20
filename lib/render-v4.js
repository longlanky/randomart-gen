import { createArtwork } from './artwork-v4.js';
import { rasterizeArtwork } from './raster-v4.js';

export async function renderV4(seed, width, height) {
  return await rasterizeArtwork(createArtwork(seed), width, height).encode('png');
}
