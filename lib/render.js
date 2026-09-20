import { createArtwork } from './artwork.js';
import { rasterizeArtwork } from './raster.js';

// PNG encoding runs on the libuv thread pool; planning and drawing are synchronous.
export async function render(seed, width, height) {
  const artwork = createArtwork(seed);
  const canvas = rasterizeArtwork(artwork, width, height);
  return await canvas.encode('png');
}
