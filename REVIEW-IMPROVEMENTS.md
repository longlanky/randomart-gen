# seeded-art — Code Improvement Review Document

**For review before implementation. No code has been changed.**

- Date (UTC): 2026-09-20
- Scope: `server.js`, `lib/{render,rng,palette,primitives,shapes,filters,post,request-log}.js`, `public/index.html`, `package.json`
- Method: read-only inspection + static analysis + a second verification pass and an independent third verification pass with in-process measurements (no server started, no file written). See "Second pass" and "Third pass" below.
- How to review: each finding is self-contained with `Category / Location / Problem / Evidence / Impact / Recommendation (minimal diff) / Verification`. Approve / reject / amend per finding. Findings are ordered by impact × confidence ÷ risk.
- Convention: `RENDER_VERSION` in `server.js` (currently `v2`) must be bumped (`v2 → v3`) for any change that alters rendered pixels for the same seed/size. Batch plan at the end separates output-preserving vs. output-changing fixes.

---

## Second pass — verification results (read-only, 2026-09-20)

A second agent pass re-checked every finding against the code, the installed dependencies, `logs/requests.jsonl`, `cache/`, and in-process measurements. No server was started, no file was written or modified. Results:

| Check | Result |
|---|---|
| `render('hello', 2048²)` stage timing | layers 118 ms · symmetry 0 ms · **postProcess 801 ms · PNG encode 1278 ms (60 %)** · total 2134 ms |
| `render('hello', 4096²)` | **9975 ms**, peak RSS **435 MB**, 16.8 MB PNG |
| `canvas.toBuffer('image/png')` vs `await canvas.encode('png')` @4096² | 834 ms with **0** timer ticks vs 832 ms with **17** ticks; `Buffer.compare(...) === 0` → byte-identical |
| Vignette `Math.hypot` vs `Math.sqrt` @16.7 M px | 586 ms vs 307 ms |
| NaN dimensions | `parseInt(null / '' / 'abc')` → `NaN`; cache key `…::NaNxNaN`, `render()` clamps `NaN │ 0 → 0 → 1` → **1×1 PNG returned with HTTP 200** |
| `req.body` undefined? | **No.** `node_modules/body-parser/lib/types/json.js:108` runs `req.body = req.body ││ {}` (body-parser 1.20.5) |
| Express ETag | Already emitted: `express/lib/response.js:179-210` sets a weak ETag and returns 304 for `res.send(Buffer)` |
| Live traffic (`logs/requests.jsonl`, 83 lines) | Public traffic (XFF `68.233.224.176`, referer `randomart.n-5.cc`); `ip` logged as `::1` in **83/83**; durationMs median 1 551 / p95 6 918 / max 8 280; cache: **82 `fresh` · 1 `memory` · 0 `disk`** |
| Observed sizes | 512×512 … 3840×2400; max **9.22 MP**, median 2.3 MP. A **12 MP** cap rejects **0 of 83** real requests |
| `cache/` on disk | **816 MB / 213 files** |
| Symmetry, forced modes @256×256 and 255×257 | odd dims → **1-px black seam** on the mirror axis (`mirrorX` seam sum 48 896 @255 px; `quad`/`kaleido` 32 640; `mirrorY` 16 129); **`kaleido` output == `quad` output** |
| Attractor divergence (200 000 simulated orbits) | max &vert;coord&vert; = **2.999**, **0** non-finite → bounded by construction |

Outcome: **#1, #3, #4, #5, #9, #11, #12, #13, #14 stand as written**; **#2 is refuted in part and rewritten**; **#7 upgraded**; **#8 promoted from unconfirmed to confirmed**; **#10 trimmed**; **A1 refuted / A2 no action**; **eight new findings N1–N8 added**.

---

## Third pass — independent verification (read-only, 2026-09-20)

A third agent pass independently re-measured the second pass's key claims in-process (Node v26.8.2, `@napi-rs/canvas` 1.0.0; no server started, no file written or modified). All critical findings were confirmed; one piece of new evidence strengthens #1, and three new findings (**N9–N11**) are added.

| Check | Result |
|---|---|
| `canvas.encode('png')` vs `toBuffer('image/png')` | `Buffer.compare(...) === 0` → byte-identical; `encode()` returns a Promise → **N1 confirmed, output-preserving** |
| Determinism | `render('hello', 64, 64)` twice → byte-identical |
| NaN dimensions | server clamp `parseInt('abc')` → `NaN` (key `…::NaNxNaN`); render clamp `NaN │ 0 → 1` → 1×1 PNG with HTTP 200. **New evidence: `parseInt('1e3') === 1`** (silently mis-parsed) and `parseInt('800abc') === 800` — the `Number()` + `Number.isInteger` recommendation in #1 is necessary, not stylistic |
| Log re-analysis (83 lines) | `ip` = `::1` in 83/83; XFF holds 2 real clients (N4); cache: **82 fresh · 1 memory · 0 disk** (N5); durationMs med 1 551 / p95 6 918 / max 8 280; max size 9.22 MP → a 12 MP cap rejects **0** observed requests (N3) |
| `cache/` on disk | 816 MB / 213 files; largest single entry **22.4 MB** — widens the non-atomic-write truncation window of #7 |
| Forced symmetry modes (in-process pixel tests) | `kaleido === quad` **byte-identical**; `quad` derives all four quadrants from bottom-left; odd dims (255×257) darken/jump on the centre axis (`mirrorY` centre-row mean 149.5 vs ≈ 191 expected; `quad` centre column 152.0 vs 64.2 adjacent) → **#8 / N6 confirmed** |
| `req.body` undefined? | Re-confirmed: `body-parser/lib/types/json.js` sets `req.body` to `{}` before all skip paths → **#2 amendment holds** |
| Attractor / lerpEdge | Static re-analysis agrees with A1/A2: coordinates bounded by 3; `lerpEdge` denominator non-zero by its guard condition |

Outcome: **all second-pass findings stand**; #1 evidence strengthened; **N9–N11 added**; review decisions 4–8 recorded in the rollout section.

---

## Summary table

| # | Pri | Cat | Location | Title | Output change? | Risk |
|---|-----|-----|----------|-------|----------------|------|
| N1 | P0 | perf | `lib/render.js:31`, `server.js:69` | Sync PNG encode is 60 % of render time; async `encode()` is byte-identical | **No** | Low |
| N2 | P0 | bug | `server.js:56-72` | In-flight dedupe (required once N1 lands) | No | Low |
| N3 | P0 | hardening | `server.js:30` | No pixel budget, no concurrency cap on a public endpoint | No | Low |
| 1 | P0 | bug | `server.js:33-34` | NaN width/height → cache-key / render-size divergence | No (fixes to 400 or consistent clamp) | Low |
| 2 | P0 | hardening | `server.js:12` + json middleware | No JSON-error handler (malformed JSON → **HTML** 400) — *partly refuted, rewritten* | No | Low |
| 3 | P0 | perf/hardening | `server.js:61-69`, `lib/post.js`, `lib/primitives.js` | Sync blocking render + blocking disk I/O → DoS | No (caps/guards only) | Low |
| 4 | P0 | perf | `lib/post.js:71-86` | Per-pixel `Math.hypot` + per-pixel `rng()` grain hotspot | **Yes** if RNG stream touched | Med |
| 5 | P0 | hardening | `server.js:71`, `lib/request-log.js:12` | Silent disk/log failures + unbounded growth | No | Low |
| N4 | P1 | bug | `server.js`, `lib/request-log.js` | `trust proxy` unset → every logged `ip` is `::1` | No | Low |
| N5 | P1 | perf/ops | `server.js:71`, `cache/`, `logs/` | Disk cache 816 MB with **0** disk hits; no eviction or rotation | No | Low |
| 6 | P1 | bug/perf | `server.js:56-72` | Thundering-herd duplicate renders (superseded by N2) | No | Low |
| 7 | P1 | bug | `server.js:61-71` | Non-atomic cache write + unguarded disk read → corrupt PNG served forever | No | Low |
| 8 | P1 | bug | `lib/post.js:15-40` | Odd-dimension seam **confirmed**; `kaleido` == `quad` | **Yes** if fixed | Med |
| 9 | P1 | bug | `public/index.html:261,196` | Object-URL leak + misleading subtitle | No | Low |
| 10 | P1 | hardening | `server.js` whole | Missing caps/headers/health; backup served; unbounded seed (ETag item removed) | No | Low |
| 11 | P2 | perf/enh | `lib/primitives.js:130-144` | noiseField per-cell fillRect | **Yes** | Med |
| 12 | P2 | perf | `lib/filters.js:67-101` | pixelSort comparator + repeated full-buffer copies | **Yes** if fused | Med |
| N6 | P2 | bug | `lib/post.js:6,32` | `kaleido` is functionally identical to `quad` (dead mode) | **Yes** | Low |
| N7 | P2 | hardening | `server.js:87` | Implicit `0.0.0.0` bind; no `EADDRINUSE` / SIGTERM handling | No | Low |
| N8 | P2 | perf | `lib/post.js:9-40,96-113` | 435 MB peak RSS at 4096²: 2 spare canvases + 2 spare ImageData | **Yes** if fused | Med |
| N9 | P2 | bug | `lib/filters.js:97` | pixelSort skips one bright pixel at maxRun truncation (`x = end + 1`) | **Yes** if fixed | Low |
| N10 | P2 | bug | `lib/post.js:41-47` | `tile` symmetry resamples fractionally at odd dims (merge into #8) | **Yes** | Low |
| N11 | P2 | enh | `public/index.html:255` | UI discards server JSON error body (merge into #13) | No | Low |
| 13 | P2 | hardening | `public/index.html:238-284` | Frontend validation + unsafe download filename | No | Low |
| 14 | P2 | enh | `package.json`, repo root | No tests/engines/smoke script | No | Low |
| A1 | Appx | — | `lib/shapes.js:6-24` | Attractor divergence — **refuted**, no action | — | — |
| A2 | Appx | — | `lib/shapes.js:151-154` | lerpEdge divide-by-zero — **no action**, safe by construction | — | — |

> A1/A2 are closed by measurement, not deferred: see the appendix for the evidence.

---

## P0 — Fix first

### N1. Synchronous PNG encoding is ~60 % of every render (async, byte-identical)

- **Category:** performance
- **Location:** `lib/render.js:31` (`canvas.toBuffer('image/png')`), `server.js:69`
- **Problem:** `toBuffer()` is synchronous and runs entirely on the main thread, so the event loop is blocked for the whole encode. `canvas.encode('png')` returns a Promise and runs on the libuv thread pool, leaving the loop free.
- **Evidence (measured, not inferred):**

```js
// 4096×4096 canvas, a 50 ms interval timer counting ticks during the call:
//   toBuffer('image/png')  834 ms   0 ticks     <-- loop fully blocked
//   await encode('png')    832 ms  17 ticks     <-- loop stays responsive
//   Buffer.compare(toBuffer(...), await encode('png')) === 0
```

Stage timing for `render('hello', 2048²)` (total 2134 ms):

```
layers 118 ms · symmetry 0 ms · postProcess 801 ms · PNG encode 1278 ms (60 %)
```

`render('hello', 4096²)` = **9975 ms**, peak RSS 435 MB.

- **Impact:** High. This is the single largest slice of request latency, and it is the slice that is cheapest to move off-thread. Every other request (including the UI's own `GET /`) stalls for the full encode.
- **Recommendation (output-identical — no `RENDER_VERSION` bump):**

```js
// lib/render.js — recommended
export async function render(seed, width, height) {
  // ... unchanged: rng, palette, canvas, background, drawLayers, applySymmetry, postProcess
  return await canvas.encode('png'); // was: canvas.toBuffer('image/png')
}
```

```js
// server.js — handler becomes async; fresh-render branch
app.post('/render', async (req, res) => {
  // ...
  const buf = await render(seedStr, w, h); // was: render(seedStr, w, h)
```

Must land together with **N2** — once encoding awaits, two concurrent identical requests can each start a full render (previously impossible because the whole handler was synchronous).

- **Verification:**
  - `Buffer.compare(await canvas.encode('png'), canvas.toBuffer('image/png')) === 0` → asserts output is unchanged, so no version bump.
  - During a 4096² render, `curl` a second endpoint and confirm it responds instead of stalling.
  - `sha256sum` a fixed seed/size before and after → identical.

---

### N2. In-flight request dedupe (required by N1)

- **Category:** bug / performance
- **Location:** `server.js:56-72`
- **Problem:** Lookup-then-render is check-then-act. Today the handler is fully synchronous, so identical concurrent requests serialise harmlessly (this is why #6 was rated "moot"). After N1 introduces an `await`, that guarantee disappears: N identical misses will each run `drawLayers` + `postProcess`, multiplying CPU cost by N.
- **Evidence:** no in-flight map exists; measured render cost is 1.5 s median / 8.3 s max.
- **Impact:** Medium-high once N1 lands; trivial to prevent.
- **Recommendation (no output change):**

```js
// top-level
const inflight = new Map(); // key -> Promise<Buffer>

// in the fresh-render path:
let p = inflight.get(key);
if (!p) {
  p = render(seedStr, w, h);
  inflight.set(key, p);
  p.finally(() => inflight.delete(key)).catch(() => {});
}
const buf = await p;
memCache.set(key, buf);
// ... write cache, sendPng(res, buf, 'fresh')
```

Supersedes #6 (keep #6's note for history; implement N2).

- **Verification:** 5 concurrent identical POSTs during a cold cache → exactly one render (single `[render]` log line / one `fresh`, four deduped), no duplicate `cache/<key>.png` writes (check mtime), all 5 return 200 with identical bytes.

---

### N3. No pixel budget, no concurrency cap on a publicly reachable endpoint

- **Category:** hardening
- **Location:** `server.js:30` (handler), `server.js:87` (listen)
- **Problem:** `POST /render` is unauthenticated, unthrottled, and each call blocks the event loop for seconds. AGENTS.md already flags the DoS exposure; the request log confirms the service **is** reachable from the public internet.

- **Evidence (from `logs/requests.jsonl`, 83 requests):**
  - `x-forwarded-for`: `68.233.224.176`, `2603:7081:…` (public clients); `referer`: `https://randomart.n-5.cc/`
  - `durationMs`: median **1 551**, p95 **6 918**, max **8 280** — 32 of 83 requests blocked the loop for > 2 s
  - observed sizes up to **3840×2400 (9.22 MP)**; median 2.3 MP
  - a **12 MP** cap rejects **0 of 83** observed requests (16 MP would also reject 0; 4 MP would reject 30)
- **Impact:** High if exposed (it is); Medium locally (UI freezes during big renders).
- **Recommendation (decided: env-configurable budget + in-process concurrency cap, no per-IP limiter, no new dependency):**

```js
// top-level
const MAX_PIXELS = Number(process.env.MAX_PIXELS ?? 12_000_000); // 3840×2400 = 9.2 MP still allowed
const MAX_CONCURRENT_RENDERS = Number(process.env.MAX_CONCURRENT_RENDERS ?? 2);
let activeRenders = 0;

// in handler, after parsing w/h:
if (w * h > MAX_PIXELS) {
  res.locals.cacheSource = 'error';
  return res.status(400).json({ error: `image too large: ${w}x${h} exceeds ${MAX_PIXELS} pixels` });
}

// around the fresh-render branch only:
if (activeRenders >= MAX_CONCURRENT_RENDERS) {
  res.locals.cacheSource = 'error';
  return res.status(429).json({ error: 'server busy, try again' });
}
activeRenders++;
try { /* render + cache + send */ } finally { activeRenders--; }
```

Set `trust proxy` first (**N4**) if `req.ip` is ever used for limiting. Defer worker-thread offload; document reverse-proxy limits (`limit_req`, `client_max_body_size`) for the public deploy.

- **Verification:**
  - `MAX_PIXELS=12000000 curl -d '{"seed":"x","width":4096,"height":4096}'` → 400 JSON, no render, no cache file.
  - 4 parallel large renders → at least 2 get 429; process stays responsive and does not OOM.
  - Replay the 83 logged sizes against the new cap → 0 rejections.

---

### 1. NaN width/height → cache-key / render-size divergence

- **Category:** bug
- **Location:** `server.js:33-34`, related `lib/render.js:8-9`
- **Problem:** `parseInt(width)` returns `NaN` for `"abc"`, `null`, `{}`, etc. `Math.max(1, Math.min(4096, NaN))` evaluates to `NaN` (any comparison with `NaN` is false). `w/h = NaN` is then used in `cacheKey(seed, w, h)` producing keys like `"v2::x::NaNxNaN"`, while `render(seed, NaN, NaN)` coerces via `NaN | 0 → 0 → clamp → 1`. Key says `NaN`, image is `1×1`. Also `parseInt("10abc") → 10` silently accepted; floats truncated inconsistently.
- **Evidence:**

```js
// server.js (current)
const w = Math.max(1, Math.min(4096, parseInt(width)));
const h = Math.max(1, Math.min(4096, parseInt(height)));
```

```js
// lib/render.js (current) — separate clamp, integer coercion via |0
const w = Math.max(1, Math.min(4096, width | 0));
const h = Math.max(1, Math.min(4096, height | 0));
```

Measured in Node (second pass):

```
parseInt(null)      → NaN   parseInt('')  → NaN   parseInt('abc') → NaN
parseInt('800abc')  → 800   (silently accepted)
parseInt('1e3')     → 1     (silently mis-parsed — third pass)
Math.max(1, Math.min(4096, NaN)) → NaN     NaN | 0 → 0 → clamped → 1
JSON.stringify({ width: NaN })   → {"width":null}   (log records null)
```

So `{"seed":"x","width":"abc"}` returns **HTTP 200 with a 1×1 PNG** while the cache key says `NaNxNaN`.

- **Impact:** Medium. Cache pollution (one junk PNG per distinct bad input), confusing 1×1 renders instead of explicit 400, inconsistent validation between layers.
- **Recommendation (minimal, output-preserving):** centralize parsing; reject non-integers with 400. Pick one policy and apply in both places. Suggested:

```js
// server.js — recommended replacement
function parseDim(v, fallback) {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  if (!Number.isInteger(n)) return fallback; // or: return null to trigger 400
  return Math.max(1, Math.min(4096, n));
}

// in handler:
const w = parseDim(width, null);
const h = parseDim(height, null);
if (w === null || h === null) {
  res.locals.cacheSource = 'error';
  return res.status(400).json({ error: 'width and height must be integers 1..4096' });
}
```

Alternative if you prefer never-400: `parseDim(v, 512)` fallback. Either is fine as long as `NaN` never reaches `cacheKey`. Also change `parseInt` (no radix, prefix parsing) to `Number()` + `Number.isInteger`.

For `lib/render.js`, keep defensive clamp but make it consistent:

```js
// lib/render.js — recommended
const w = Math.max(1, Math.min(4096, Number.isInteger(width) ? width : 1));
const h = Math.max(1, Math.min(4096, Number.isInteger(height) ? height : 1));
```

- **Verification:**
  - `curl -X POST localhost:3040/render -H 'Content-Type: application/json' -d '{"seed":"x","width":"abc","height":null}' -i` → expect `400` JSON, no new file in `cache/`.
  - `curl -d '{"seed":"x","width":"10abc","height":3.7}'` → expect `400` (strict) or documented truncation (lenient). Decide and lock in.
  - Existing valid sizes unchanged: `{"seed":"hello","width":256,"height":256}` → `200 image/png`.

---

### 2. No JSON-error handler (malformed JSON → HTML error page)

> **Amended in the second pass.** The original claim that `const { seed, width, height } = req.body` throws `TypeError: Cannot destructure undefined` is **refuted**: `body-parser` always initialises the body before any skip path. The remaining (real) problem is the unhandled JSON parse error and the missing error middleware.

- **Category:** hardening
- **Location:** `server.js:12,30-32`
- **Problem:** Malformed JSON (or a non-object literal) makes `express.json()` raise a `SyntaxError`. With no error middleware, Express' default handler answers with an **HTML** page, breaking the JSON contract that `public/index.html` relies on (`if (!res.ok) throw new Error('Render failed')` then displays `err.message`, which would be unhelpful).
- **Evidence:**

```js
// node_modules/body-parser/lib/types/json.js:108  (body-parser 1.20.5)
req.body = req.body || {}   // runs before the hasBody / shouldParse skip paths
```

```js
// server.js (current)
app.use(express.json());
app.post('/render', (req, res) => {
  const { seed = '', width = 512, height = 512 } = req.body; // safe: req.body is always an object
```

`req.body` cannot be `undefined`, so the destructure cannot throw. What is unhandled is the error path in `body-parser/lib/read.js:132` (`type: 'entity.parse.failed'`, status 400) — nothing converts it to JSON.

- **Impact:** Medium-low. Cosmetic/contract issue, not a hang or crash (the original "hung socket" severity is withdrawn).
- **Recommendation:**

```js
// recommended: explicit limit + safe destructure
app.use(express.json({ limit: '50kb' }));

app.post('/render', (req, res) => {
  const { seed = '', width = 512, height = 512 } = req.body ?? {}; // belt-and-braces; body-parser already guarantees {}
  // ...
});

// recommended: JSON syntax-error handler (must be after routes)
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    return res.status(400).json({ error: err.type === 'entity.too.large' ? 'body too large' : 'invalid json' });
  }
  console.error(err);
  return res.status(500).json({ error: 'internal error' });
});
```

Also consider `seed` coercion early (see #10): `const seedStr = String(seed ?? '').slice(0, 500);` and use `seedStr` for both `cacheKey` and `render`.

- **Verification:**
  - `curl -X POST localhost:3040/render -H 'Content-Type: application/json' -d 'not-json' -i` → `400 {"error":"invalid json"}`, server stays up.
  - `curl -X POST localhost:3040/render -H 'Content-Type: text/plain' -d 'hi' -i` → `200` with defaults (body skipped, `req.body === {}`), never a crash.
  - Body > 50 kb → `400 {"error":"body too large"}`.

---

### 3. Synchronous blocking render + blocking disk I/O (DoS vector)

- **Category:** performance / hardening
- **Location:** `server.js:61-69`; hot paths `lib/post.js:71-112`, `lib/primitives.js:130-144`, `lib/shapes.js`
- **Problem:** `render()` is synchronous and CPU-bound. `fs.existsSync` + `fs.readFileSync` also block the single Node event loop. One 4096×4096 render does ~16.7M-pixel JS loops (vignette+grain+chromatic ≈ 3 passes) plus up to ~1M `fillRect` calls in `noiseField`. Concurrent large renders stall all other requests. There is no auth, rate limit, timeout, or pixel-budget check. AGENTS.md already flags this as an easy DoS vector.
- **Evidence:**

```js
// server.js (current) — all sync, no concurrency guard
if (fs.existsSync(file)) {
  const buf = fs.readFileSync(file);
  memCache.set(key, buf);
  return sendPng(res, buf, 'disk');
}
try {
  const buf = render(seed, w, h); // blocks event loop for seconds at 4096²
```

- **Impact:** High if exposed beyond localhost; Medium locally (UI freezes during big renders).
- **Recommendation (small, safe, no output change — do NOT move to workers in this batch):**
  1. Switch disk cache to async with error handling (see #7 snippet).
  2. Add total-pixel budget, e.g.:

```js
// recommended guard at top of handler (after parsing w/h)
const MAX_PIXELS = 16 * 1024 * 1024; // 16 MP ≈ 2048×8192, 4096×4096=16.7MP → rejected; tune as desired
if (w * h > MAX_PIXELS) {
  res.locals.cacheSource = 'error';
  return res.status(400).json({ error: `image too large: ${w}x${h} exceeds ${MAX_PIXELS} pixels` });
}
```

  3. Add minimal in-process render guard:

```js
// recommended (top-level)
let activeRenders = 0;
const MAX_CONCURRENT_RENDERS = 2;
// in handler, only around fresh-render branch:
if (activeRenders >= MAX_CONCURRENT_RENDERS) {
  res.locals.cacheSource = 'error';
  return res.status(429).json({ error: 'server busy, try again' });
}
activeRenders++;
try {
  const buf = render(seedStr, w, h);
  // ... cache + send
} finally {
  activeRenders--;
}
```

  4. Document reverse-proxy limits (nginx `client_max_body_size`, `limit_req`) for any public deploy. Defer worker-thread offload to a later architectural change.

- **Verification:**
  - `time curl -d '{"seed":"big","width":4096,"height":4096}'` → expect `400` (if over budget) or `200` but bounded; server remains responsive to concurrent `GET /` during render.
  - Fire 4 parallel large renders → at least 2 get `429`, process does not OOM; check `logs/requests.jsonl` `durationMs`.

---

### 4. Per-pixel `Math.hypot` + per-pixel `rng()` grain hotspot

- **Category:** performance (output-sensitive)
- **Location:** `lib/post.js:62-87`
- **Problem:** Vignette computes `Math.hypot(x-cx, y-cy)` per pixel. `Math.hypot` is far slower than manual `sqrt(dx*dx+dy*dy)` or, better, avoiding sqrt entirely via squared-distance ratio. Grain calls `rng()` per pixel per channel-group (16.7M PRNG steps at 4096²), dominating CPU and preventing early-out when `grain ≈ 0`.
- **Evidence:**

```js
// lib/post.js (current)
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const dist = Math.hypot(x - cx, y - cy) / maxDist; // slow
    const vig = 1 - dist * dist * vignetteStrength;
    d[i] *= vig; d[i + 1] *= vig; d[i + 2] *= vig;
    if (grain > 0) {
      const g = (rng() - 0.5) * grain; // 1 RNG call per pixel
      d[i] += g; d[i + 1] += g; d[i + 2] += g;
    }
  }
}
```

- **Impact:** High for large images; Medium at 800×600. Any change to RNG consumption order changes every existing seed's output.
- **Recommendation:** two options for review — pick one:
  - **Option A (fast, output-changing):** squared distance + early skip. Requires `RENDER_VERSION v2 → v3`.

```js
// recommended Option A (changes pixels slightly due to float path + grain LUT)
const maxDistSq = (w / 2) * (w / 2) + (h / 2) * (h / 2);
for (let y = 0; y < h; y++) {
  const dy = y - cy;
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const dx = x - cx;
    const t = (dx * dx + dy * dy) / maxDistSq; // == dist*dist, no hypot/sqrt
    const vig = 1 - t * vignetteStrength;
    d[i] *= vig; d[i + 1] *= vig; d[i + 2] *= vig;
    if (grain > 0.001) {
      const g = (rng() - 0.5) * grain;
      d[i] += g; d[i + 1] += g; d[i + 2] += g;
    }
  }
}
```

Note: `1 - t*vig` with `t = dist²` is algebraically identical to current `1 - dist*dist*vig`, but float rounding may differ in last bit → still bump version to be safe.

  - **Option B (no output change, smaller win):** keep exact math but hoist `dx` loop invariant and replace `Math.hypot` with `Math.sqrt(dx*dx+dy*dy)`; precompute per-row `dy*dy`. Keeps RNG stream identical. ~2-5× faster in this loop, still RNG-bound.

```js
// recommended Option B (bit-identical intent, faster)
const invMax = 1 / maxDist;
for (let y = 0; y < h; y++) {
  const dy = y - cy;
  const dy2 = dy * dy;
  for (let x = 0; x < w; x++) {
    const dx = x - cx;
    const dist = Math.sqrt(dx * dx + dy2) * invMax;
    // ... identical remainder
  }
}
```

- **Verification:**
  - Benchmark fixed seed (e.g. `"hello" 1024×1024`) before/after with `time node -e "import('./lib/render.js').then(m=>m.render('hello',1024,1024))"`.
  - Determinism: render twice, `sha256sum`; if Option A, confirm hash changes exactly once after version bump, then stable.

---

### 5. Silent disk/log failures + unbounded growth

- **Category:** hardening
- **Location:** `server.js:71`, `lib/request-log.js:11-13`
- **Problem:** `fs.writeFile(file, buf, () => {})` swallows all errors (disk full, permissions). `logRequest` similarly ignores `appendFile` errors. `cache/` grows one PNG per unique seed/size forever; `logs/requests.jsonl` grows one line per request forever and contains IPs + user agents (personal data). Only in-memory LRU has eviction.
- **Evidence:**

```js
// server.js (current)
fs.writeFile(file, buf, () => {}); // async write, don't block response
```

```js
// lib/request-log.js (current)
export function logRequest(entry) {
  fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', () => {});
}
```

- **Impact:** Medium. Disk exhaustion; silent data loss; privacy retention obligation.
- **Recommendation:**

```js
// server.js — recommended
import fs from 'fs'; // keep
fs.writeFile(file, buf, (err) => {
  if (err) console.error(`[cache] write failed ${key}:`, err.message);
});
```

```js
// lib/request-log.js — recommended
export function logRequest(entry) {
  fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', (err) => {
    if (err) console.error('[request-log] append failed:', err.message);
  });
}
```

Ops (no code): add to README/ops notes: `find cache -type f | wc -l`, `du -sh cache logs`, prune example `find cache -type f -mtime +30 -delete`, logrotate snippet for `requests.jsonl`. Do not auto-delete in this batch (risk of deleting hot cache).

- **Verification:**
  - `chmod 555 cache && POST /render` → response still `200 fresh`, server log shows `[cache] write failed`; restore `chmod 755 cache`.
  - Confirm `logs/requests.jsonl` appends one JSON line per POST (`tail -n1 logs/requests.jsonl | jq .`).

---

## P1 — Should do next

### 6. Thundering-herd duplicate renders

- **Category:** bug / performance
- **Location:** `server.js:56-72`
- **Problem:** Concurrent identical requests all miss mem+disk and each runs full `render()`. With sync render this serializes anyway but wastes CPU N×.
- **Evidence:** no in-flight map; lookup-then-render is check-then-act with no lock.
- **Impact:** Medium under concurrent UI use (double-click Paint, multiple users same seed).
- **Recommendation (no output change):**

```js
// top-level
const inflight = new Map(); // key -> Buffer (sync render completes before yielding, so map is brief but still dedups sync re-entry via disk path)
// Simpler correct approach for sync render: memoize within tick.
// Around fresh-render branch:
try {
  const buf = render(seedStr, w, h);
  memCache.set(key, buf);
  fs.writeFile(file, buf, (err) => { if (err) console.error(`[cache] write failed ${key}:`, err.message); });
  return sendPng(res, buf, 'fresh');
} catch (err) {
  console.error(err);
  res.locals.cacheSource = 'error';
  return res.status(500).json({ error: 'render failed' });
}
```

Note: because `render()` is synchronous, true async dedup requires workers. The minimal win today is: after `render()` completes but before `sendPng`, later same-tick requests hit `memCache`. For genuine concurrency, combine with #3's `activeRenders` guard (second identical request gets `429` or waits). If workers are adopted later, upgrade to `Map<key, Promise<Buffer>>` with `await`.

- **Verification:** `for i in 1 2 3 4 5; do curl ... & done; wait` with identical seed → all succeed, server `durationMs` shows serialization; no duplicate disk writes (check `ls -l cache/<key>.png` mtime).

---

### 7. Non-atomic cache write + unguarded disk read (corrupt PNG served forever)

> **Amended in the second pass:** the read side is only half the problem. The write side is worse, because a corrupt file is **re-served indefinitely** for that seed/size.

- **Category:** bug
- **Location:** `server.js:61-71`
- **Problem:**
  1. **Write:** `fs.writeFile(file, buf, () => {})` writes in place with no temp file and ignores its error. A crash, `SIGKILL`, container restart, or `ENOSPC` mid-write leaves a **truncated** file at `cache/<key>.png`. The next request finds `existsSync === true`, reads it, and serves it as `image/png` — permanently, since the key never changes.
  2. **Read:** `fs.readFileSync(file)` throws on a corrupt/truncated file, a permissions change, or a delete between `existsSync` and the read — outside any `try`.
  3. `existsSync` + `readFileSync` is TOCTOU **and** blocks the event loop.
- **Evidence:**

```js
// server.js (current)
fs.writeFile(file, buf, () => {}); // async write, don't block response — errors swallowed, non-atomic
if (fs.existsSync(file)) {
  const buf = fs.readFileSync(file); // throws → uncaught
```

- **Impact:** Medium. One bad file poisons a seed/size permanently (or 500s on every hit) until manually deleted.
- **Recommendation (no output change):** atomic write via temp + rename, async read, and a PNG magic-byte check so a bad file degrades to a fresh render:

```js
// top-level
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// recommended write (fire-and-forget, but atomic + logged)
const tmp = `${file}.${process.pid}.tmp`;
fs.writeFile(tmp, buf, (err) => {
  if (err) return console.error(`[cache] write failed ${key}:`, err.message);
  fs.rename(tmp, file, (e2) => { if (e2) console.error(`[cache] rename failed ${key}:`, e2.message); });
});

// recommended read (handler is async after N1)
try {
  const buf = await fs.promises.readFile(file);
  if (buf.length > 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) { // 89 50 4E 47 0D 0A 1A 0A
    memCache.set(key, buf);
    return sendPng(res, buf, 'disk');
  }
  console.error(`[cache] corrupt entry ${key}, re-rendering`);
} catch (err) {
  if (err.code !== 'ENOENT') console.error(`[cache] read failed ${key}:`, err.message);
}
// fall through to fresh render
```

- **Verification:**
  - `printf '\x89PNG' > cache/<key>.png` (compute the key with the same `cacheKey`) then POST that seed/size → expect `200 fresh`, a fresh valid PNG, and the bad file overwritten.
  - `chmod 555 cache && POST /render` → still `200 fresh`, log shows `[cache] write failed`; restore `chmod 755 cache`.
  - `kill -9` the server mid-write at 4096², restart, re-request → valid PNG (not truncated).

---

### 8. Odd-dimension seam (confirmed) + `kaleido` == `quad`

> **Amended in the second pass:** the seam is **confirmed by measurement**, so fixtures are no longer a prerequisite. The separate `kaleido` finding is tracked as **N6**.

- **Category:** bug (visual, confirmed)
- **Location:** `lib/post.js:5-58`
- **Problem:** Odd `w`/`h` make `w/2` / `h/2` fractional. The two mirrored halves then each cover only `w/2` device pixels and **neither covers the centre column/row**, leaving a 1-px black seam down the mirror axis; the fractional rects also resample (blur) the whole half.
- **Evidence (measured):** `applySymmetry` forced per-mode on a canvas with a white top-left and grey bottom-left quadrant, summing `|px(a) − px(b)|` across the seam line:

| mode | 256×256 seam | 255×257 seam | centre pixel (odd) |
|---|---|---|---|
| `mirrorX` | 0 | **48 896** (vertical) | `0` (black gap) |
| `mirrorY` | 0 | **16 129** (horizontal) | — |
| `quad` / `kaleido` | 0 | **32 640** (vertical) | `0` (black gap) |

Even sizes are clean; every mirror mode degrades at odd sizes. `tile` shares the same fractional-destination root cause (tracked as **N10**). Separately, `quad` and `kaleido` produce **identical** output (see N6).

- **Impact:** Low-medium. Visible dark seam for a subset of seeds/sizes (any odd dimension × ~3 of 7 modes).
- **Recommendation (output-changing → bump `RENDER_VERSION`):** use integer halves that tile the canvas exactly:

```js
// candidate fix
const hwl = Math.ceil(w / 2);  // left half
const hhr = Math.ceil(h / 2);  // top half
// mirrorX:  dest [0, hwl] and mirrored dest [w - hwl, w]
// mirrorY:  dest [0, hhr] and mirrored dest [h - hhr, h]
// quad/kaleido: apply both, then flip the top half into the bottom half
```

Also note the current `quad`/`kaleido` pass derives the whole image from the **bottom** half of the mirrorX result, discarding the original top half (measured: all four quadrants take the bottom-left colour). Symmetric, so not "broken", but worth confirming it is the intended look while fixtures are open.

- **Verification:** fixture matrix `sym-{mode}-{even,odd}.png` reviewed; post-fix seams gone at odd sizes; even-size output documented (changed → version bump).

---

### 9. Frontend Object-URL leak + misleading subtitle

- **Category:** bug (leak) / docs
- **Location:** `public/index.html:196,259-261`
- **Problem:** Each Paint does `$('art').src = URL.createObjectURL(blob)` without revoking the previous URL → renderer memory grows with each Paint. Subtitle `Same seed = same image, even with different resolutions.` overpromises: geometry/noise scale with `w/h`, so different sizes are not pixel-identical (nor expected to be).
- **Evidence:**

```js
// public/index.html (current)
$('art').src = URL.createObjectURL(blob);
```

```html
<!-- current -->
<p class="subtitle">Same seed = same image, even with different resolutions.</p>
```

- **Impact:** Low.
- **Recommendation:**

```js
// recommended in paint(), before assigning new URL:
if ($('art').dataset.objectUrl) URL.revokeObjectURL($('art').dataset.objectUrl);
// ... after fetch:
const objectUrl = URL.createObjectURL(blob);
$('art').dataset.objectUrl = objectUrl;
$('art').src = objectUrl;
```

```html
<!-- recommended copy -->
<p class="subtitle">Same seed + size = same image.</p>
```

- **Verification:** Paint 20×, confirm `performance.memory` / devtools blob URLs stable; copy review.

---

### 10. Missing caps/headers/health; backup file served; unbounded seed

- **Category:** hardening / enhancement
- **Location:** `server.js`, `public/`
- **Problem:**
  - No explicit JSON body limit (defaults to 100 kb — acceptable but implicit).
  - `seed` unbounded: full string hashed into cache key; 1 MB seed → slow hash + key churn. Only log truncates to 200 chars.
  - No `Cache-Control` on the PNG response.
  - `express.static` serves `public/index.html.bak_original_simple` (unlinked backup) publicly.
  - No `GET /health`, no `trust proxy` decision documented (see N4 — it is currently unset and wrong), no security headers.
- **Evidence:** `server.js:12-13,35,79-84`; `public/` contains `index.html.bak_original_simple`.

> **Amended in the second pass:** the original "add `ETag` / `Content-Length`" item is **dropped** — Express already does both. `express/lib/response.js:179-210` generates a weak `ETag` for `res.send(Buffer)` and downgrades to `304` when `req.fresh`; `Content-Length` is set by `res.send`. Only `Cache-Control` is actually missing.
- **Impact:** Low-medium.
- **Recommendation (all output-preserving):**

```js
// seed coercion (in handler, before cacheKey):
const seedStr = String(seed ?? '').slice(0, 500);
const key = cacheKey(seedStr, w, h);
// ... use seedStr for render() and logging
```

```js
// sendPng headers — do NOT add ETag/Content-Length, Express already sets them (response.js:179-210)
function sendPng(res, buf, source) {
  res.locals.cacheSource = source;
  res.set('Content-Type', 'image/png');
  res.set('X-Cache', source);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(buf); // sets Content-Length + weak ETag, honours If-None-Match → 304
}
```

```js
// health:
app.get('/health', (req, res) => res.json({ ok: true, version: RENDER_VERSION }));
```

Ops: move `public/index.html.bak_original_simple` out of `public/` (e.g. to `docs/` or delete if git history covers it); optionally `app.disable('x-powered-by')`; document `trust proxy` only if behind proxy.

- **Verification:** long seed (10k chars) → key stable/truncated; `curl -I /health` → 200; `curl /index.html.bak_original_simple` → 404 after move; response headers include `Cache-Control`.

---

### N4. `trust proxy` unset → every logged client IP is the proxy

- **Category:** bug (observability) / hardening
- **Location:** `server.js` (app setup), `lib/request-log.js` (recorded `ip` / `ips`)
- **Problem:** The service runs behind a reverse proxy (confirmed by `x-forwarded-for` in the log), but `app.set('trust proxy', …)` is never called. Express therefore reports `req.ip` as the proxy address, so `logs/requests.jsonl` records the proxy for every request and the real client survives only in the raw `ips` field. Any future per-IP logic (rate limits, blocklists, abuse triage) would key on the wrong value.
- **Evidence (measured, 83 log lines):**

```
unique req.ip  → ['::1']                                        (1 value, 83/83 requests)
unique xff     → ['68.233.224.176', '2603:7081:5000:1020:…']    (2 real clients)
```

- **Impact:** Medium. Request-log forensics are wrong today; silently breaks any IP-based control added later.
- **Recommendation (no output change):** make it explicit and opt-in, since trusting XFF blindly is itself a spoofing risk:

```js
// server.js — recommended (trust only when the deploy is behind a proxy)
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY); // e.g. '1' or 'loopback'
```

Also record the decision in the ops notes, and re-annotate the existing log lines (their `ip` values are `::1` and must not be used for analysis).

- **Verification:** with `TRUST_PROXY=1` and `-H 'X-Forwarded-For: 203.0.113.9'`, the new log line has `ip: "203.0.113.9"`; with the env unset, `ip` is unchanged (`::1`) and no client-controlled header is honoured.

---

### N5. Disk cache is 816 MB with zero measured hits; no eviction or log rotation

- **Category:** performance / ops
- **Location:** `server.js:71` (cache write), `lib/request-log.js:11-13`, `cache/`, `logs/`
- **Problem:** The disk cache grows without bound (only the in-memory LRU evicts) and, on the observed workload, never pays for itself: every logged request was a miss. Meanwhile `logs/requests.jsonl` grows one line per request forever and contains personal data (IPs + user agents).
- **Evidence (measured):**

```
cache/           816 MB · 213 files        (avg ≈ 3.8 MB/file)
logs/requests.jsonl  83 lines · 44 KB
X-Cache distribution over 83 requests:  fresh 82 · memory 1 · disk 0
```

0 disk hits means the 816 MB buys no measurable latency saving on this traffic pattern (all distinct seeds); it is pure unbounded growth.

- **Impact:** Medium. Disk exhaustion over time; privacy retention obligation; large backup/restore surface.
- **Recommendation (no output change; ops-safe):** do not auto-delete by default — make it opt-in and bounded:

```js
// server.js — recommended, env-gated sweep (boot + interval)
const CACHE_MAX_MB = Number(process.env.CACHE_MAX_MB ?? 0); // 0 = disabled (keep today's behaviour)
async function sweepCache() {
  if (!CACHE_MAX_MB) return;
  const entries = (await fs.promises.readdir(CACHE_DIR))
    .map((f) => ({ f, p: path.join(CACHE_DIR, f) }));
  const stats = await Promise.all(entries.map(async (e) => ({ ...e, s: await fs.promises.stat(e.p) })));
  stats.sort((a, b) => a.s.mtimeMs - b.s.mtimeMs);
  let total = stats.reduce((n, e) => n + e.s.size, 0);
  const cap = CACHE_MAX_MB * 1024 * 1024;
  for (const e of stats) {
    if (total <= cap) break;
    await fs.promises.unlink(e.p).catch(() => {});
    total -= e.s.size;
  }
}
```

Ops (no code): logrotate for `logs/requests.jsonl`; document `du -sh cache logs` and `find cache -type f -mtime +30 -delete`. Note in the runbook that the log holds personal data (AGENTS.md already flags this).

- **Verification:** with `CACHE_MAX_MB=1` and a warm `cache/`, boot the server and confirm `du -sh cache` drops to ≤ 1 MB and the oldest files are the ones gone; with the env unset, no file is deleted.

---

## P2 — Polish / perf follow-ups

### N6. `kaleido` is functionally identical to `quad`

- **Category:** bug (dead mode)
- **Location:** `lib/post.js:6` (mode list), `lib/post.js:32` (`if (mode === 'quad' || mode === 'kaleido')`)
- **Problem:** `kaleido` shares `quad`'s code path in both the mirror step and the second flip step, so the two modes produce byte-identical output. One of seven modes (≈14 % of renders) is a no-op alias, and the "kaleidoscope" look users expect (rotational symmetry) never appears.
- **Evidence (measured):** forcing each mode on the same source canvas and averaging the four quadrants:

```
quad      256×256  TL 128  TR 128  BL 128  BR 128
kaleido   256×256  TL 128  TR 128  BL 128  BR 128   (identical)
```

Only the `mirrorX` and `quad||kaleido` branches mention `kaleido`; there is no separate rotational step (that lives in `pinwheel`).

- **Impact:** Low. Missed variety, misleading code.
- **Recommendation (output-changing → bump `RENDER_VERSION`):** either give `kaleido` its own rotational-wedge step (e.g. wedge-reflect around N rotational sectors), or drop it from the pick list and keep six modes. Dropping it is the smaller, safer change but alters every seed that would have picked it.
- **Verification:** fixture PNGs per mode; after the change, `kaleido` differs from `quad`.

---

### N7. Implicit all-interfaces bind, no `EADDRINUSE` / shutdown handling

- **Category:** hardening
- **Location:** `server.js:86-87`
- **Problem:** `app.listen(PORT)` binds `0.0.0.0` implicitly. There is no `HOST` override, no handler for `EADDRINUSE` (the process prints a raw stack and exits), and no `SIGTERM` drain, so a restart can kill an in-flight render mid-cache-write (see #7).
- **Evidence:** `app.listen(PORT, () => …)` — no host argument, no error callback.
- **Impact:** Low-medium. Surprising exposure on multi-homed hosts; ugly restart behaviour.
- **Recommendation (no output change):**

```js
// server.js — recommended
const HOST = process.env.HOST ?? '0.0.0.0'; // keep 0.0.0.0 as default: the live deploy relies on it
const server = app.listen(PORT, HOST, () => console.log(`Listening on http://${HOST}:${PORT}`));
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} already in use`);
  else console.error('server error:', err);
  process.exit(1);
});
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref(); });
}
```

- **Verification:** `PORT=3040 npm start` twice → second prints `Port 3040 already in use` and exits 1 (no stack trace); `kill -TERM <pid>` exits 0 within 5 s; `HOST=127.0.0.1` makes the port unreachable from outside.

---

### N8. Peak RSS 435 MB at 4096²: spare canvases and spare ImageData

- **Category:** performance
- **Location:** `lib/post.js:9-40` (`applySymmetry`), `lib/post.js:96-113` (chromatic aberration)
- **Problem:** A single 4096² render holds, at various points: the main canvas, `tmp`, and `tmp2` from `applySymmetry`, plus `src` and `out` `ImageData` in `postProcess`, plus the encoded PNG — roughly 5 × 67 MB. On a smaller container this is the difference between serving and OOM-killing.
- **Evidence (measured):** `render('hello', 4096, 4096)` → peak RSS **435 MB**, 16.8 MB PNG; the two symmetry canvases (`tmp`, `tmp2`) are allocated before the mode branch and `tmp2` only inside `quad`/`kaleido`; aberration allocates a full second `ImageData`.
- **Impact:** Medium at large sizes; low at typical sizes.
- **Recommendation (output-changing if the aberration pass is fused → bump `RENDER_VERSION`; the canvas reuse alone is output-identical):**
  1. Output-identical: allocate `tmp` once at module/render scope and clear it per call instead of creating two canvases per render.
  2. Output-changing (Batch B): do the chromatic shift row-wise in place with a small row buffer instead of a second full `ImageData`.
- **Verification:** measure peak RSS (`process.memoryUsage().rss`) at 4096² before/after; `sha256sum` to confirm whether output moved.

---

### N9. pixelSort skips one bright pixel at maxRun truncation

- **Category:** bug (visual quirk)
- **Location:** `lib/filters.js:97` (`x = end + 1`)
- **Problem:** When a bright run is cut by the `end - x < maxRun` cap (rather than by a dark pixel), the pixel at `end` is still bright, but the outer scan resumes at `end + 1` — that pixel is never sorted, leaving a single unsorted bright pixel between consecutive runs.
- **Evidence:** code read:

```js
while (end < w && lumAt(end, y) > threshold && end - x < maxRun) end++;
// ... sort [x, end) ...
x = end + 1;   // pixel `end` is bright when the run was cut by maxRun — skipped forever
```

When the run instead ends on a dark pixel, the `+ 1` is harmless (the scan-ahead would skip it anyway).

- **Impact:** Low. Subtle deterministic glitch; arguably part of the "glitch look". Fixing it changes output.
- **Recommendation:** no action by default (output change for a cosmetic edge case). If Batch B touches `pixelSort` anyway (#12), consider `x = end` there and let the same `RENDER_VERSION` bump cover it. **Decision recorded: revisit only with #12.**
- **Verification:** craft a synthetic row containing a run longer than `maxRun`; before a fix the pixel at index `x + maxRun` is unchanged, after `x = end` it participates in the next run's sort.

---

### N10. `tile` symmetry resamples fractionally at odd dims

- **Category:** bug (visual)
- **Location:** `lib/post.js:41-47`
- **Problem:** `tw = w / tiles` / `th = h / tiles` are fractional whenever `w`/`h` are not divisible by `tiles` (2–4), so every tile is resampled (blurred) — the same fractional-destination root cause as #8's mirror seams. Tile edges still land exactly on `w`/`h` (no gaps), so this is softness only, not a seam.
- **Evidence:** code read; e.g. 255×257 with `tiles = 4` → `tw = 63.75`, `th = 64.25`. Fractional `drawImage` resampling confirmed by measurement for the mirror modes in #8.
- **Impact:** Low. Slight softening of `tile` renders at odd dims (~1 of 7 symmetry modes × odd-size requests).
- **Recommendation (output-changing → covered by the single Batch B version bump):** fold into #8 — compute integer tile sizes that tile the canvas exactly (distribute the remainder over the first `w % tiles` columns / `h % tiles` rows).
- **Verification:** forced-mode fixture matrix from #8 extended with `tile` at odd dims; tile boundaries sharp and canvas exactly covered after the fix.

---

### N11. Frontend discards the server's JSON error body

- **Category:** enhancement (UX)
- **Location:** `public/index.html:255` (`if (!res.ok) throw new Error('Render failed')`)
- **Problem:** Every non-2xx collapses to the string `Render failed`. Once Batch A lands, the server answers with actionable JSON reasons (`width and height must be integers 1..4096`, `invalid json`, `image too large …`, `server busy, try again`) that the UI throws away.
- **Evidence:** code read; `setStatus('Error: ' + err.message, 'error')` can only ever display `Render failed`.
- **Impact:** Low. Worse debuggability exactly when the server starts rejecting bad input.
- **Recommendation (no output change; merge into #13, Batch A):**

```js
if (!res.ok) {
  let msg = `Render failed (HTTP ${res.status})`;
  try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
  throw new Error(msg);
}
```

- **Verification:** with Batch A's strict dim validation in place, force a bad size from the form → status line shows the server's message instead of `Render failed`.

---

### 11. noiseField per-cell `fillRect` (up to ~1M calls)

- **Category:** performance / enhancement
- **Location:** `lib/primitives.js:130-144`
- **Problem:** Nested `for y+=cell, x+=cell` with individual `fillStyle` + `fillRect` per cell. At 4096² with `cell=4`, ~1M state changes → seconds.
- **Evidence:**

```js
for (let y = 0; y < h; y += cell) {
  for (let x = 0; x < w; x += cell) {
    const v = (noise(x * scale, y * scale, z) + 1) / 2;
    const c = pal.colors[Math.floor(v * pal.colors.length) % pal.colors.length];
    ctx.fillStyle = rgbaStr(c, v * 0.6);
    ctx.fillRect(x, y, cell, cell);
  }
}
```

- **Impact:** Medium for seeds hitting this layer at large sizes.
- **Recommendation (output-changing → bump version):** render low-res `ImageData` then scale up:

```js
// sketch (needs care to match colors exactly):
const lw = Math.ceil(w / cell), lh = Math.ceil(h / cell);
const low = ctx.createImageData(lw, lh);
// fill low.data from noise+palette ...
// then draw via temp canvas with imageSmoothingEnabled = true
```

- **Verification:** benchmark seed forcing `noiseField` (stub `rng.pick` to return it) at 2048² before/after; visual diff review.

---

### 12. pixelSort comparator overhead + repeated full-buffer copies

- **Category:** performance
- **Location:** `lib/filters.js:67-101`, `lib/post.js:89-113`
- **Problem:** `order.subarray(0,len).sort((p,q)=>lumBuf(p)-lumBuf(q))` calls closure per comparison (O(n log n) closures per run). Each filter does full `getImageData`/`putImageData` (67MB at 4096²); chromatic aberration allocates two more full buffers (~134MB transient) → OOM pressure.
- **Evidence:** code read; `new Uint8ClampedArray(maxRun*4)` + `Uint32Array` reused (good), but comparator is hot.
- **Impact:** Medium at large sizes.
- **Recommendation (output-preserving micro-fix + output-changing fusion as separate steps):**
  - Micro (no output change): precompute per-run luminance array once, sort indices against it.
  - Fusion (output-changing): combine chromatic shift into final pass to avoid extra buffers; requires version bump.
- **Verification:** profile with forced `pixelSort`; measure wall time + peak RSS at 2048².

---

### 13. Frontend validation + safe download filename

- **Category:** hardening
- **Location:** `public/index.html:236-284`
- **Problem:** `parseInt($('width').value)` can be `NaN`; `JSON.stringify({width:NaN}) → null` → server sees `null`. `if (!$('art').src)` is unreliable (empty `img.src` property resolves oddly; use `getAttribute` or a flag). `a.download = art-${seed}.png` allows `/`, `..`, control chars → odd filenames.
- **Evidence:**

```js
const width = parseInt($('width').value);
const height = parseInt($('height').value);
// ...
$('save').onclick = () => {
  if (!$('art').src) return;
  a.download = `art-${$('seed').value}.png`;
```

- **Impact:** Low.
- **Recommendation:**

```js
// recommended paint() parsing:
function clampDim(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) ? Math.max(1, Math.min(4096, n)) : fallback;
}
const width = clampDim($('width').value, 800);
const height = clampDim($('height').value, 600);

// recommended save:
let hasImage = false; // set true after first successful paint
$('save').onclick = () => {
  if (!hasImage) return;
  const safe = String($('seed').value || 'art').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 50) || 'art';
  const a = document.createElement('a');
  a.href = $('art').src;
  a.download = `art-${safe}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
};
```

- **Verification:** enter `abc` dims → sane fallback request; seed `../../x` → downloads `art-____x.png`; Save before Paint does nothing.

---

### 14. Repo hygiene: tests, engines, smoke script

- **Category:** enhancement
- **Location:** `package.json`, repo root
- **Problem:** `npm test` is placeholder (exits 1); no `engines` (developed on Node v26, `@napi-rs/canvas` needs modern Node); no one-command smoke test.
- **Evidence:**

```json
"scripts": { "start": "node server.js", "test": "echo \"Error: no test specified\" && exit 1" }
```

- **Impact:** Low (DX/CI).
- **Recommendation (no output change):**

```json
{
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node server.js",
    "smoke": "node ./scripts/smoke.js",
    "test": "node --test test/"
  }
}
```

Add `test/rng.test.js` (determinism: same seed → same sequence; warm-up preserved), `test/dims.test.js` (parseDim rejects NaN/floats), `scripts/smoke.js` (POST render twice, assert `fresh→memory`, byte-identical after cache clear). Keep zero-dependency (`node:assert`, `node:test`).

- **Verification:** `npm run smoke` green on clean `cache/`; `npm test` passes.

---

## Appendix — closed by measurement (no action)

Both items below were carried as watch-items pending reproduction. The second pass reproduced them and found no defect, so **no change is recommended** and neither needs a `RENDER_VERSION` bump.

### A1. Attractor divergence — `lib/shapes.js:6-24` — REFUTED

```js
const a = rng.range(-2, 2), b = rng.range(-2, 2);
```

The concern was that Clifford / Peter de Jong orbits with coefficients near ±2 could diverge to `Infinity`/`NaN` and make `fillRect(ox + x * scale, …)` throw or silently misbehave.

**They cannot.** Every recurrence is built from `sin`/`cos` (bounded by 1) plus at most one coefficient times `cos` (|c|, |d| ≤ 2), so each coordinate is bounded by 3 regardless of iteration count — the map is a bounded attractor by construction, not an accumulating one.

Measured over 200 000 randomised parameter sets × 50 iterations:

```
max |coord| = 2.999      non-finite values = 0
```

Points beyond ±3 simply land off-canvas and are clipped by the rasteriser, which is harmless. **No guard needed**; adding one would change output for no benefit.

### A2. lerpEdge divide-by-zero — `lib/shapes.js:151-154` — NO ACTION

```js
function lerpEdge(xa, ya, xb, yb, va, vb, t) {
  const f = (t - va) / (vb - va);
```

Safe by construction: `lerpEdge` is only called when `(va < t) !== (vb < t)`, which implies `va !== vb`, so the denominator is never 0. `thresholds` are also sane (`levels = rng.int(4, 9)`, so `levels - 1 ≥ 3`). Leave as is; revisit only if `drawContours` is restructured.

---

## Suggested rollout (for approval)

Decisions recorded from review (2026-09-20):

1. **Pixel budget** — env-configurable: `MAX_PIXELS`, default **12 000 000**. Rejects 0 of the 83 observed real requests (max observed 9.22 MP) while ruling out 4096×4096 (16.7 MP).
2. **Version bump** — **one** `RENDER_VERSION v2 → v3` for the whole output-changing batch is acceptable.
3. **Throttling** — **in-process concurrency cap** only (semaphore → 429). No per-IP limiter, no new dependency. `trust proxy` (N4) must land first if IP ever becomes a key.

Decisions recorded from the third-pass review (2026-09-20):

4. **Scope** — only this document update is approved so far; implementation (Batches A–C) is deferred to a separate approval.
5. **N6 resolution** — give `kaleido` a **real rotational wedge-reflect step** of its own (do not drop it from the pick list); ships in Batch B under the single v3 bump.
6. **#4 resolution** — **Option A** (squared distance + grain early-out); ships in Batch B under the same v3 bump. Option B is dropped.
7. **#1 resolution** — **strict 400** for non-integer / out-of-range dims (no lenient fallback); `NaN` must never reach `cacheKey`.
8. **New-finding disposition** — **N9**: no action by default, revisit only if #12 touches `pixelSort`; **N10**: merged into #8 (Batch B); **N11**: merged into #13 (Batch A).

### Batch A — no output change, **no** version bump

`#1` (**strict 400** on bad dims — decided) · `#2` (JSON error handler + body limit) · `#5` (error callbacks on cache/log writes) · `#7` (atomic cache write + magic-byte read) · `#9` (revoke object URL + subtitle copy) · `#10` (seed coercion, `Cache-Control`, `/health`, move `.bak` out of `public/`) · `#13` (frontend validation + safe filename + **N11** error-body surfacing) · `#14` (`engines`, `node --test`, smoke script) · **`N1`** (async `encode('png')`) · **`N2`** (in-flight dedupe — ships with N1) · **`N3`** (pixel cap + concurrency cap) · **`N4`** (`trust proxy`).

Ordering: `N4` → `#2`/`#1` → `N1` + `N2` → `#7` → `N3` → `#5`/`#9`/`#10`/`#13`/`#14`.

### Batch B — output-changing, **one** bump `RENDER_VERSION v2 → v3`

`#4` (vignette/grain loop — **Option A**, decided) · `#8` (integer symmetry halves, incl. **N10** `tile`) · `#11` (noiseField low-res blit) · `#12` (pixelSort / buffer fusion; optionally **N9** `x = end`) · **`N6`** (`kaleido` → own rotational wedge-reflect step, decided) · **`N8`** (in-place chromatic aberration; the scratch-canvas reuse part is output-identical and may move to Batch A).

### Batch C — ops / docs

`N5` (env-gated cache sweep + log rotation) · `N7` (HOST / EADDRINUSE / SIGTERM) · proxy `limit_req` + `client_max_body_size` · `/health` monitoring · runbook note that existing log lines have `ip: "::1"` and must not be used for analysis.

### Verification for the whole effort

- `npm run smoke` (new, from #14): POST twice → `fresh` then `memory`; after restart → `disk`; bytes identical after clearing the cache file.
- Determinism: two fresh renders of a fixed seed/size → identical `sha256sum` (grain is seeded).
- Batch B gate: capture `sha256sum` for a fixed seed set before the batch, confirm it changes exactly once, then is stable.
- Concurrency: 5 parallel identical cold-cache POSTs → one render, five identical 200s (N2); 4 parallel large renders → ≥ 2 × 429 (N3).
- Corrupt cache: `printf '\x89PNG' > cache/<key>.png` → `200 fresh`, entry repaired (#7).
- Header check: responses carry `Cache-Control`, `ETag`, `X-Cache` (ETag/304 come free from Express — see #10).

---

## Implementation status (2026-09-20)

Approved and implemented. See `git diff` for the code; this section records what landed, what was measured afterwards, and what is still open.

### Batch A — done (no output change)

| Finding | Change |
|---|---|
| `N1` | `render()` is now `async` and ends with `await canvas.encode('png')` (`lib/render.js`); server `await`s it. Bytes identical. |
| `N2` | `inflight: Map<key, Promise<Buffer>>` in `server.js`; concurrent identical misses share one render. |
| `N3` | `MAX_PIXELS` (default 12 MP) → 400; `MAX_CONCURRENT_RENDERS` (default 2) → 429. Both env-configurable. |
| `#1` | New `lib/dims.js` `parseDim()` (`Number()` + `Number.isInteger`, range 1–4096); bad dims → JSON 400; `render()` shares the same clamp so key and image can never diverge. |
| `#2` | `express.json({ limit: '50kb' })` + error middleware → JSON `400 invalid json` / `413 body too large`. |
| `#5` | Cache write and log append now log their errors instead of swallowing them. |
| `#7` | Atomic write (`<key>.png.<pid>.tmp` → `rename`) + async read + PNG magic-byte check (bad entry → re-render). |
| `#10` | Seed coerced/truncated (`MAX_SEED_LEN`, 500) before hashing; `Cache-Control: public, max-age=31536000, immutable`; `GET /health`; backup moved out of `public/` to the repo root. |
| `#9` | Object URL revoked on each repaint; subtitle now "Same seed + size = same image." |
| `#13` + `N11` | `clampDim()` in the UI, safe download filename, and the server's JSON `error` surfaced in the status line. |
| `#14` | `engines.node >= 18`; `npm test` → `node --test test/` (13 tests), `npm run smoke` → `scripts/smoke.js`. |
| `N4` | `TRUST_PROXY` env → `app.set('trust proxy', …)`; documented that unset means `ip` is the proxy. |

### Batch C — done

`N5` (`CACHE_MAX_MB` sweep, boot + hourly, oldest-first; verified 5×400 KB → 2 files under a 1 MB cap) and `N7` (`HOST` env, `EADDRINUSE` message instead of a stack trace, `SIGTERM`/`SIGINT` drain; listen log now reports the real port so `PORT=0` is usable).

### Batch B — partially done, under the single `v2 → v3` bump

- **`#4` Option A** — squared-distance vignette, per-row `dy²`, grain early-out at `grain > 0.001`. Measured `postProcess` 2048²: 801 ms → 693 ms (1024²: 290 → 263 ms).
- **`#8` + `N10`** — integer halves (`Math.ceil(w/2)` / `w - hw`) for `mirrorX`/`mirrorY`/`quad`, integer tile rects for `tile`. Verified: with an all-white source, uncovered pixels at odd dimensions went from a black seam column to **0** for every mode.
- **`N6`** — `kaleido` is now a real rotational wedge-reflect step (6–12 sectors, every second copy mirrored, source scaled by `hypot(w,h)/min(w,h)` so rotation always covers the corners). Verified 0 uncovered pixels at 256×256, 255×257 and 64×512, and no longer byte-identical to `quad`.
- **`RENDER_VERSION` bumped `v2 → v3`** — consequence: every existing `cache/*.png` (816 MB / 213 files) is now unreachable and will not be deleted automatically. Set `CACHE_MAX_MB` or prune by hand if disk matters.

### Still open (not implemented)

- **`#11`** noiseField low-res blit — the sketch in the review needs pixel-level colour matching; deferring to a change with visual fixture sign-off.
- **`#12`** pixelSort/buffer fusion and **`N8`** (in-place chromatic aberration, scratch-canvas reuse) — memory/latency work that needs a fixture pass; the `hypot`-free vignette already took the cheap part of the win.
- **`N9`** — decision 8 records "no action by default"; left as is.
- Log rotation remains ops-only (`logrotate`), no code change.

---

*End of review document. Third pass complete; decisions 4–8 recorded. Batch A, Batch C and the items listed above are implemented; see "Implementation status".*
