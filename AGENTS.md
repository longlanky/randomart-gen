# AGENTS.md — seeded-art

Guidance for AI coding agents working in this repository. Assumes no prior knowledge of the project.

## Project overview

**seeded-art** is a seeded generative-art server: given a text `seed` plus a `width`/`height`, it renders a deterministic abstract PNG. The same seed and dimensions always produce the same composition (see the determinism caveat below). It consists of:

- An **Express HTTP server** (`server.js`) exposing a single `POST /render` endpoint with a two-tier PNG cache (in-memory LRU + on-disk files) and an append-only JSONL request log (`logs/requests.jsonl`).
- A **rendering pipeline** (`lib/`) that turns a seed into an image using a seeded PRNG, a procedural color palette, layered canvas drawing primitives, symmetry transforms, and pixel-level post-processing.
- A **self-contained web UI** (`public/index.html`, inline CSS/JS, no build step) with seed/size inputs, Paint / Random seed / Save / Stop buttons, and cache-status display.

There is no framework, bundler, transpiler, or frontend toolchain — plain ES modules and a static HTML file.

## Technology stack

- **Runtime:** Node.js (developed on v26), ES modules (`"type": "module"` in `package.json`). Use `import`/`export`, not `require`.
- **Server:** `express` 4 — JSON body parsing and static file serving.
- **Rasterization:** `@napi-rs/canvas` (native, prebuilt binaries; no node-gyp). API notes: `createCanvas(w, h)`, `canvas.toBuffer('image/png')`. Comments in `lib/post.js` reference a past migration from `node-canvas` — keep using `@napi-rs/canvas`.
- **Noise:** `simplex-noise` v4 (`createNoise2D` / `createNoise3D`, seeded with the project RNG).
- **Triangulation:** `delaunator` v5 (pure JS) for the Delaunay layer kind.
- **Cache:** `lru-cache` v10 for the in-memory hot cache.

Install with `npm install` (lockfile present: `package-lock.json`).

## Build, run, and test commands

- **Run:** `npm start` (alias for `node server.js`). No build step exists.
- **Port:** `3040` by default; override with the `PORT` environment variable (`PORT=0` picks a free port).
- **Tests:** `npm test` runs `node --test test/` (rng, dimension parsing, render determinism). `npm run smoke` boots the server in a temp sandbox and checks the whole request path.
- **Lint/format/CI:** none configured. The project is a git repository (no `.github`/CI setup); `.gitignore` excludes `node_modules/`, `cache/`, and `logs/`.

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3040` | Listen port; `0` picks a free port |
| `HOST` | `0.0.0.0` | Bind address |
| `MAX_PIXELS` | `12000000` | Rejects renders above this pixel count with 400 (real traffic peaks at 9.2 MP; 4096² = 16.7 MP is rejected) |
| `MAX_CONCURRENT_RENDERS` | `2` | Extra concurrent fresh renders get `429` |
| `MAX_SEED_LEN` | `500` | Seeds are truncated before hashing |
| `CACHE_DIR` | `cache/` | Disk cache location |
| `LOG_DIR` | `logs/` | Request-log location |
| `CACHE_MAX_MB` | `0` (off) | Oldest-first cache sweep at boot and hourly |
| `TRUST_PROXY` | unset | Set (e.g. `1`) **only** when behind a reverse proxy; otherwise `req.ip` is the proxy and every logged `ip` is wrong |

### Manual smoke test

```sh
node server.js &
curl -X POST http://localhost:3040/render \
  -H 'Content-Type: application/json' \
  -d '{"seed":"hello","width":256,"height":256}' -o out.png -D -
```

Expect HTTP 200, `Content-Type: image/png`, and an `X-Cache` header of `fresh` on first request, then `memory` or `disk` on repeats. The UI is at `http://localhost:3040/`, and `GET /health` returns `{"ok":true,"version":"<RENDER_VERSION>"}`.

## Code layout and request flow

```
server.js            Express app: POST /render, caching, request logging, static hosting
lib/
  render.js          render(seed, w, h) -> PNG Buffer; orchestrates the pipeline
  rng.js             xmur3 hash -> mulberry32 PRNG; makeRng(seed) with helpers
  palette.js         makePalette(rng): HSL harmony schemes -> RGB colors + background
  primitives.js      drawLayers() + KINDS map of layer kinds; rgbaStr(), BLEND_MODES
  shapes.js          Complex layer kinds: attractor, truchet, ribbons, contours, delaunay, spirograph
  filters.js         Post filters: scanlines, duotone, bloom, pixelSort (all rng-seeded)
  post.js            applySymmetry() (mirror/quad/kaleido/tile/pinwheel), postProcess() (vignette, grain, filters, chromatic aberration)
  request-log.js     logRequest(): appends one JSON line per request to logs/requests.jsonl
  dims.js            parseDim(): strict integer dimension parsing (shared by server + tests)
public/
  index.html         Single-page UI (inline CSS/JS), calls POST /render via fetch
scripts/
  smoke.js           End-to-end smoke test (boots the server in a temp sandbox)
test/                node --test unit tests (rng, dims, render determinism)
index.html.bak_original_simple   Old backup of the UI; kept at the repo root so it is not served
cache/               Generated PNG cache files (sha256-named); runtime data, safe to delete
logs/                requests.jsonl request log; runtime data, safe to delete
```

Pipeline order in `lib/render.js`: `makeRng(seed)` → `makePalette(rng)` → fill background → `drawLayers()` (each layer picks a blend mode from `BLEND_MODES`, an alpha, and one of 13 kinds from the `KINDS` map in `lib/primitives.js`: `blobs`, `polygons`, `bezier`, `gradientField`, `voronoi`, `flowField`, `noiseField`, `attractor`, `truchet`, `ribbons`, `contours`, `delaunay`, `spirograph`) → `applySymmetry()` → `postProcess()` (vignette + seeded grain, then chance-gated `scanlines`/`duotone`/`bloom`/`pixelSort`, then chromatic aberration) → `await canvas.encode('png')`.

`render()` is **async**: PNG encoding is the single largest slice of a render (≈60 % at 2048²) and `canvas.encode()` runs it on the libuv thread pool, so the event loop stays responsive. The bytes are identical to the old `canvas.toBuffer('image/png')`. Everything else in the pipeline is still synchronous.

Server caching in `server.js`: cache key is `sha256("<version>::<seed>::<w>x<h>")` where `<version>` is the `RENDER_VERSION` constant (currently `v3`) — bump it whenever the render pipeline changes so stale cached PNGs stop being served (old files are left on disk, not deleted). Lookup order: (1) in-memory LRU (max 200 entries / 256 MB), (2) disk file `cache/<key>.png`, (3) fresh render. Fresh renders populate both; disk writes are fire-and-forget and **atomic** (write to `<key>.png.<pid>.tmp`, then `rename`) so a crash can never leave a truncated PNG behind. A cache file whose first 8 bytes are not the PNG signature is treated as a miss and re-rendered. The `X-Cache` response header reports `memory` | `disk` | `fresh`.

Requests are guarded before rendering: `width`/`height` must be integers in 1–4096 (`parseDim()` in `lib/dims.js`, strict — non-integers get `400`, they are never silently clamped), `w*h` must not exceed `MAX_PIXELS`, and at most `MAX_CONCURRENT_RENDERS` fresh renders run at once (`429`). Concurrent requests for the same key share one render via an in-flight map.

Request logging: every `POST /render` appends one JSON line to `logs/requests.jsonl` via `res.on('finish', ...)` (fire-and-forget, never blocks the response). Fields: `ts`, `method`, `path`, `status`, `durationMs`, `seed` (truncated to 200 chars), `width`, `height`, `cache` (`memory`/`disk`/`fresh`/`error`), `ip`, `ips` (raw `x-forwarded-for`), `userAgent`, `referer`, `origin`, `acceptLanguage`. There is intentionally no HTTP endpoint to read the log — inspect the file directly (`tail`, `jq`).

## Project-specific conventions and gotchas

- **Determinism is the core feature** — the UI promises "Same seed = same image." All randomness must come from the seeded `rng` object (helpers: `rng()`, `rng.range(min,max)`, `rng.int(min,max)`, `rng.pick(arr)`, `rng.chance(p)`). Never call `Math.random()` in the render path. Film grain in `lib/post.js` used to be the one `Math.random()` exception; it is now seeded, so fresh renders of the same seed/size are byte-for-byte identical.
- **RNG consumption order matters.** Any change that adds/removes/reorders `rng` calls changes the output for every existing seed. Treat rendered-output changes as breaking changes: when you intentionally change output, bump `RENDER_VERSION` in `server.js` so the cache key changes with it.
- `makeRng` combines two `xmur3` hash outputs and discards the first 15 PRNG values as warm-up — keep this when touching `lib/rng.js`.
- **Drawing is synchronous and CPU-bound.** The per-pixel loops in `lib/post.js` are O(w·h) in plain JS, so large canvases take noticeable time. PNG encoding (≈60 % of a 2048² render) is the one part that runs off-thread via `canvas.encode()`; there is no worker-thread offload for the rest.
- Colors are plain `[r, g, b]` arrays (0–255 floats); convert with `rgbaStr([r,g,b], alpha)` from `lib/primitives.js`.
- Code style: 2-space indent, semicolons, single quotes, sparse comments, small single-purpose functions per file. Match this when editing.
- The frontend talks to the backend only via `POST /render` with JSON `{seed, width, height}` and reads the `X-Cache` header; keep that contract stable.

## Testing instructions

There is no linter or CI, but there is a test suite and a smoke test:

- `npm test` — `node --test test/` (rng behaviour, `parseDim()` strictness, render determinism).
- `npm run smoke` — boots the server in a temp sandbox (`PORT=0`, temp `CACHE_DIR`/`LOG_DIR`) and asserts the whole path: `fresh` → `memory`, `disk` after restart, byte-identical bytes, 400 on bad dimensions / oversized / malformed JSON, 429 under the concurrency cap, and re-render of a corrupt cache entry. It cleans up after itself and never touches the real `cache/` or `logs/`.

Manual checks still worth doing after visual changes:

1. Start the server and smoke-test `POST /render` with curl (see above); confirm a valid PNG (`file out.png`) and correct `X-Cache` transitions (`fresh` → `memory`; `disk` after restarting the server).
2. Check determinism: two fresh renders with the same seed/size should be byte-identical (`sha256sum`; grain is seeded now). The cache must be cleared/bypassed to force fresh renders — delete the matching file in `cache/`.
3. Exercise the UI at `/` (Paint, Random seed, Save, Stop buttons — Stop uses `AbortController`), and confirm the status line shows the server's own error message for a rejected request.
4. New cache files appear in `cache/` named `<sha256>.png`; clean up any entries created by ad-hoc tests. Requests also append lines to `logs/requests.jsonl` — remove test lines afterwards.

## Security and operational considerations

- **No authentication.** A 4096×4096 render is expensive (synchronous CPU + ~64 MB pixel buffers), so the endpoint is an easy DoS vector if exposed beyond localhost. The built-in guards are a pixel budget (`MAX_PIXELS`) and a concurrent-render cap (`MAX_CONCURRENT_RENDERS`, 429); add reverse-proxy rate limiting (`limit_req`) too if made public.
- **The disk cache and request log grow unbounded** — only the in-memory LRU has eviction. `cache/` accumulates one PNG per unique seed/size combination forever, and `logs/requests.jsonl` grows by one line per request. Set `CACHE_MAX_MB` to sweep the oldest cache files at boot and hourly, and rotate the log externally (`logrotate`); otherwise prune both by hand. Both directories are created at boot (`fs.mkdirSync(..., {recursive: true})`) and must be writable.
- `seed` is arbitrary user text but is only fed into a hash — no injection risk in the current code. `width`/`height` must be integers in 1–4096 (`parseDim()`); keep validation equivalent if the endpoint changes.
- `express.static` serves everything in `public/` — don't put anything sensitive there (the old UI backup now lives at the repo root so it is not served).
- **`req.ip` is only meaningful behind a proxy if `TRUST_PROXY` is set.** The live deploy sits behind a reverse proxy; with `TRUST_PROXY` unset every logged `ip` is the proxy (`::1`) and the real client survives only in the `ips` field. Never enable it unless a proxy you control strips incoming `X-Forwarded-For`.
- **The request log contains personal data** — `logs/requests.jsonl` records client IPs and user agents. Treat it accordingly (access, retention, GDPR-style obligations); it is only readable from the filesystem, not over HTTP.
- Do not commit or treat `cache/` contents as source; they are reproducible runtime artifacts. The same applies to `logs/`.

## Deployment

No Docker, CI, or process-manager config exists. Deployment is simply: `npm install`, then `npm start` (optionally with `PORT=<port>`). Requires network access for the initial `npm install` (`@napi-rs/canvas` downloads a prebuilt native binary). Stateful only through the `cache/` and `logs/` directories.
