import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { LRUCache } from 'lru-cache';
import { render } from './lib/render.js';
import { logRequest } from './lib/request-log.js';
import { parseDim, MIN_DIM, MAX_DIM } from './lib/dims.js';
import { RENDER_VERSION } from './lib/version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');

// Only honour X-Forwarded-For when the deploy says it is behind a proxy;
// trusting it blindly lets any client spoof req.ip (and the request log).
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3040; // PORT=0 picks a free port
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_PIXELS = Number(process.env.MAX_PIXELS ?? 12_000_000);
const MAX_CONCURRENT_RENDERS = Number(process.env.MAX_CONCURRENT_RENDERS ?? 2);
const MAX_SEED_LEN = Number(process.env.MAX_SEED_LEN ?? 500);
const CACHE_MAX_MB = Number(process.env.CACHE_MAX_MB ?? 0); // 0 = no sweep (previous behaviour)
const CACHE_DIR = path.resolve(process.env.CACHE_DIR ?? path.join(__dirname, 'cache'));

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

fs.mkdirSync(CACHE_DIR, { recursive: true });

// In-memory hot cache
const memCache = new LRUCache({ max: 200, maxSize: 256 * 1024 * 1024,
  sizeCalculation: (buf) => buf.length });

function cacheKey(seed, w, h) {
  return crypto.createHash('sha256')
    .update(`${RENDER_VERSION}::${seed}::${w}x${h}`).digest('hex');
}

// One render per key: concurrent identical misses share the result instead of
// each re-rendering (render() awaits PNG encoding, so requests can overlap).
const inflight = new Map();
let activeRenders = 0;

function fail(res, status, message) {
  res.locals.cacheSource = 'error';
  res.status(status).json({ error: message });
}

function sendPng(res, buf, source) {
  res.locals.cacheSource = source;
  res.set('Content-Type', 'image/png');
  res.set('X-Cache', source);
  res.set('X-Render-Version', RENDER_VERSION);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  // Express adds Content-Length and a weak ETag, and answers 304 on If-None-Match.
  res.send(buf);
}

// Atomic write: a crash or ENOSPC mid-write must not leave a truncated PNG
// behind, because it would be served for that seed/size forever.
function writeCache(file, key, buf) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFile(tmp, buf, (err) => {
    if (err) return console.error(`[cache] write failed ${key}:`, err.message);
    fs.rename(tmp, file, (e2) => {
      if (e2) console.error(`[cache] rename failed ${key}:`, e2.message);
    });
  });
}

async function readCache(file, key) {
  try {
    const buf = await fsp.readFile(file);
    if (buf.length > PNG_MAGIC.length && buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      return buf;
    }
    console.error(`[cache] corrupt entry ${key}, re-rendering`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[cache] read failed ${key}:`, err.message);
  }
  return null;
}

async function sweepCache() {
  const cap = CACHE_MAX_MB * 1024 * 1024;
  try {
    const names = await fsp.readdir(CACHE_DIR);
    const entries = [];
    for (const name of names) {
      if (!name.endsWith('.png')) continue;
      const p = path.join(CACHE_DIR, name);
      try {
        const s = await fsp.stat(p);
        entries.push({ p, size: s.size, mtimeMs: s.mtimeMs });
      } catch { /* vanished between readdir and stat */ }
    }
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = entries.reduce((n, e) => n + e.size, 0);
    for (const e of entries) {
      if (total <= cap) break;
      try {
        await fsp.unlink(e.p);
        total -= e.size;
      } catch (err) {
        console.error(`[cache] sweep failed ${e.p}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[cache] sweep failed:', err.message);
  }
}

app.get('/health', (req, res) => res.json({ ok: true, version: RENDER_VERSION }));

app.post('/render', async (req, res) => {
  const start = Date.now();
  const { seed = '', width = 512, height = 512 } = req.body ?? {};
  const seedStr = String(seed ?? '').slice(0, MAX_SEED_LEN);
  const w = parseDim(width);
  const h = parseDim(height);

  res.on('finish', () => logRequest({
    ts: new Date().toISOString(),
    method: req.method,
    path: req.path,
    status: res.statusCode,
    durationMs: Date.now() - start,
    seed: seedStr.slice(0, 200),
    width: w,
    height: h,
    cache: res.locals.cacheSource || 'error',
    ip: req.ip,
    ips: req.headers['x-forwarded-for'],
    userAgent: req.headers['user-agent'],
    referer: req.headers['referer'],
    origin: req.headers['origin'],
    acceptLanguage: req.headers['accept-language'],
  }));

  try {
    if (w === null || h === null) {
      return fail(res, 400, `width and height must be integers ${MIN_DIM}..${MAX_DIM}`);
    }
    if (w * h > MAX_PIXELS) {
      return fail(res, 400, `image too large: ${w}x${h} exceeds ${MAX_PIXELS} pixels`);
    }

    const key = cacheKey(seedStr, w, h);
    const file = path.join(CACHE_DIR, `${key}.png`);

    // 1) Memory cache
    const mem = memCache.get(key);
    if (mem) return sendPng(res, mem, 'memory');

    // 2) Disk cache
    const cached = await readCache(file, key);
    if (cached) {
      memCache.set(key, cached);
      return sendPng(res, cached, 'disk');
    }

    // 3) Render fresh
    let job = inflight.get(key);
    if (!job) {
      if (activeRenders >= MAX_CONCURRENT_RENDERS) return fail(res, 429, 'server busy, try again');
      activeRenders++;
      job = (async () => {
        try {
          const buf = await render(seedStr, w, h);
          memCache.set(key, buf);
          writeCache(file, key, buf);
          return buf;
        } finally {
          activeRenders--;
          inflight.delete(key);
        }
      })();
      inflight.set(key, job);
    }

    return sendPng(res, await job, 'fresh');
  } catch (err) {
    console.error('[render] failed:', err);
    if (!res.headersSent) fail(res, 500, 'render failed');
  }
});

app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') return fail(res, 400, 'invalid json');
  if (err?.type === 'entity.too.large') return fail(res, 413, 'body too large');
  console.error('[server]', err);
  if (!res.headersSent) fail(res, 500, 'internal error');
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Listening on http://${HOST}:${server.address().port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} already in use`);
  else console.error('[server] listen error:', err.message);
  process.exit(1);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}

if (CACHE_MAX_MB > 0) {
  sweepCache();
  setInterval(sweepCache, 60 * 60 * 1000).unref();
}
