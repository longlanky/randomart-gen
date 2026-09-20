# seeded-art

A Node.js generative-art server and browser UI. A text seed selects an artwork's
visual identity; the aspect ratio shapes its layout and resolution controls detail.

```sh
npm install
npm start
```

Open <http://localhost:3040>. `POST /render` accepts `{seed, width, height}` and
returns a PNG. Dimensions must be integers from 1 to 4096, subject to the server's
pixel budget (12 million by default). See [AGENTS.md](AGENTS.md) for server configuration.

## Full-frame artwork: composed and chaotic

The **v5** generator deterministically selects **chaotic artwork for about 30% of
seeds**. The remaining seeds are split evenly between three structured families:

- **Minimal:** layered cutouts, spaced triangular facets, and concentric arcs.
- **Organic:** domain-warped currents, eddies, and ribbons sharing a directional field.
- **Ornamental:** tiled motifs, radial rosettes, and nested orbital curves.

Seeds also select paper, dark, or muted palettes, with perceptual OKLCH colors
assigned to dominant, supporting, accent, and ink roles. Finishes can be clean,
paper-like, or stippled; selected dark organic artwork gets highlight-only glow.

**Chaotic artwork** brings back the older layered aesthetic: 5–12 independently
chosen layers mixing shapes, curves, gradients, noise, flow fields, attractors,
contours, triangulation, tiles, and spirographs. Stronger blending and saturated
colors produce loose, layered, or turbulent compositions. Optional finishes
include mirror/kaleidoscope/tiling, vignette, scanlines, duotone, posterization,
pixel sorting, chromatic offsets, and glow. Mode and effects come from the seed,
so resizing never randomly switches styles.

Every artwork uses a **rectangular logical artboard matching its aspect ratio**,
with its shorter side set to 1000 logical units. There is no fitted square and no
inserted blank margin. Shapes, flows, tiles, and materials extend throughout the
rectangle. Minimal styles still include intentional negative space.

- `1920 × 1080` and `3840 × 2160`: identical plans, different rendering resolutions.
- `1080 × 1920`: an adapted portrait layout with the same seed's family, palette,
  variant, and effect choices.
- `2100 × 900`: an ultrawide arrangement using the entire frame.

Geometry is rendered at native resolution, with bounded supersampling for small
previews to stabilize fine-line antialiasing. Textures and pixel effects use
aspect-ratio-matched buffers with a longest side of 512 pixels, independent of
export resolution. Destructive chaotic color/chromatic finishes intentionally
use that canonical raster; pixel sorting overlays only affected runs. Increasing
resolution cannot change effect selection, grain patterns, or sorting decisions.

## Reproducibility and versions

For the same seed, generator version, dimensions, and rendering environment,
fresh renders are byte-identical. Across resolutions with the **same aspect
ratio**, the composition is stable; antialiasing and texture sampling naturally
differ. Changing aspect ratio adapts the layout. Cross-platform or dependency
upgrades are not a promise of identical PNG bytes; use the lockfile (`npm ci`)
and the same Node/native rendering environment for archival reproduction.

`lib/version.js` defines the version used by artwork generation and cache keys.
The HTTP response includes `X-Render-Version`; the UI includes it and dimensions
in downloaded filenames. Keep the original seed too: filenames sanitize and
shorten seed text. HTTP seeds are limited to `MAX_SEED_LEN` (500 by default).

V5 intentionally produces new images for existing seeds. Both earlier pipelines
are retained for programmatic reproduction at their original dimensions:

```js
import { renderV3 } from './lib/render-v3.js';
import { renderV4 } from './lib/render-v4.js';
const oldLayered = await renderV3('hello', 512, 512);
const oldFitted = await renderV4('hello', 800, 600);
```

The HTTP endpoint serves the current version. Old cache files are left on disk
but are not reused for v5. V4's planner, compositions, and rasterizer are preserved
in `*-v4.js` modules with their original versioned streams.

## Extending the renderer

```text
createArtwork(seed, w, h)         lib/artwork.js
  → reduced aspect ratio         lib/layout.js
  → named RNG streams            lib/rng.js
  → palette + composition        lib/palette.js, lib/compositions.js, lib/chaos.js
  → JSON-serializable plan
rasterizeArtwork(plan, w, h)      lib/raster.js
  → full-frame geometry
  → bounded canonical finishes   lib/finish.js
  → canvas.encode('png')          lib/render.js
```

`makeStream(seed, version, ...path)` derives independent RNG streams from stable
names rather than consuming a shared parent RNG. Keep structure, color choices,
noise fields, and textures separate. Layout can depend on the reduced aspect
ratio, but geometry counts and random draws must not depend on output resolution.
Bound counts and grids for extreme ratios as well. Plans can be serialized and
rasterized repeatedly without mutation. A plan must be rendered at its own aspect
ratio; create another plan from the same seed to change ratio. Bump the renderer
version whenever a change intentionally alters output, including mode weights.

## Checks and visual review

```sh
npm test
npm run smoke
npm run gallery -- /tmp/seeded-art-gallery.png
```

The tests cover byte determinism, stream isolation, plan serialization, mode
distribution, full-frame coverage, undistorted geometry, all chaotic layer kinds,
optional finishes, odd/extreme sizes, and tolerant downsample comparisons. The
original v4 invariance tests are retained. The smoke test uses temporary cache/log
directories and checks HTTP rendering, version reporting, adaptive layouts,
caching, and request guards.

The contact sheet uses fixed seeds to show nine structured variants and three
chaotic intensities, each with a large 16:9 export and smaller square, 21:9, and
9:16 exports. Its output directory must already exist. Inspect it when adjusting
visual composition or materials.
