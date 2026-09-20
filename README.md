# seeded-art

A Node.js generative-art server and browser UI. A text seed selects an artwork;
export dimensions select its resolution and framing.

```sh
npm install
npm start
```

Open <http://localhost:3040>. `POST /render` accepts `{seed, width, height}` and
returns a PNG. Dimensions must be integers from 1 to 4096, subject to the server's
pixel budget (12 million by default). See [AGENTS.md](AGENTS.md) for server configuration.

## Artwork and fitted exports

The **v4** generator has three composition families, each with three variants:

- **Minimal:** layered cutouts, spaced triangular facets, and concentric arcs.
- **Organic:** domain-warped currents, eddies, and ribbons sharing a directional field.
- **Ornamental:** tiled motifs, radial rosettes, and nested orbital curves.

Seeds also select paper, dark, or muted palettes, with perceptual OKLCH colors
assigned to dominant, supporting, accent, and ink roles. Finishes can be clean,
paper-like, or stippled; selected dark organic artwork gets highlight-only glow.

Every artwork is planned on a **1000 × 1000 logical artboard** before any export
dimensions are considered. The full square is fitted into the requested image:

- `512 × 512`: square artwork fills the image.
- `1024 × 512`: the same 512-pixel artwork, with 256-pixel background margins left and right.
- `512 × 1024`: the same artwork, with margins above and below.
- `1024 × 1024`: the same geometry rasterized at twice the resolution.

Margins use the artwork's background color. An odd remaining pixel goes on the
right or bottom, avoiding half-pixel resampling. Geometry, paths, tile counts,
line widths, colors, and effect choices stay fixed in logical coordinates.
Texture and glow are sampled from fixed 512 × 512 buffers, so increasing the
export size cannot change their patterns or random choices. Geometric edges
remain native-resolution rather than upscaled from a fixed master image.

## Reproducibility and versions

For the same seed, generator version, dimensions, and rendering environment,
fresh renders are byte-identical. Across dimensions the composition is stable;
antialiasing and texture sampling naturally differ. Cross-platform or dependency
upgrades are not a promise of identical PNG bytes; use the lockfile (`npm ci`)
and the same Node/native rendering environment for archival reproduction.

`lib/version.js` defines the version used by artwork generation and cache keys.
The HTTP response includes `X-Render-Version`; the UI includes it and dimensions
in downloaded filenames. Keep the original seed too: filenames sanitize and
shorten seed text. HTTP seeds are limited to `MAX_SEED_LEN` (500 by default).

V4 intentionally produces new images for existing seeds. V3's pipeline is retained
for programmatic reproduction at its original dimensions:

```js
import { renderV3 } from './lib/render-v3.js';
const png = await renderV3('hello', 512, 512);
```

The HTTP endpoint serves the current version. Old cache files are left on disk
but are not reused for v4.

## Extending the renderer

```text
createArtwork(seed)              lib/artwork.js
  → named RNG streams           lib/rng.js
  → palette + composition       lib/palette.js, lib/compositions.js
  → JSON-serializable plan
rasterizeArtwork(plan, w, h)     lib/raster.js
  → fitted vector geometry + fixed-resolution materials
  → canvas.encode('png')        lib/render.js
```

`makeStream(seed, version, ...path)` derives independent RNG streams from stable
names rather than consuming a shared parent RNG. Keep structure, color choices,
noise fields, and textures separate. New motifs should use logical coordinates;
never base geometry counts or random draws on export dimensions. Plans can be
serialized and rasterized repeatedly without mutation. Bump the renderer version
whenever a change intentionally alters output.

## Checks and visual review

```sh
npm test
npm run smoke
npm run gallery -- /tmp/seeded-art-gallery.png
```

The tests cover byte determinism, stream isolation, plan serialization, fitted
pixel identity, odd and extreme sizes, and tolerant downsample comparisons across
all nine variants. The smoke test uses temporary cache/log directories and checks
HTTP rendering, version reporting, fitted framing, caching, and request guards.

The contact sheet uses fixed seeds to show all nine variants, each with a larger
square and small square, landscape, and portrait exports. Its output directory
must already exist. Inspect it when adjusting visual composition or materials.
