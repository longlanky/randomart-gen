import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LRUCache } from 'lru-cache';
import { render } from './lib/render.js';
import { logRequest } from './lib/request-log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CACHE_DIR = path.join(__dirname, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

// In-memory hot cache
const memCache = new LRUCache({ max: 200, maxSize: 256 * 1024 * 1024,
  sizeCalculation: (buf) => buf.length });

// Bump when the render pipeline changes so stale cached PNGs stop being served
const RENDER_VERSION = 'v2';

function cacheKey(seed, w, h) {
  return crypto.createHash('sha256')
    .update(`${RENDER_VERSION}::${seed}::${w}x${h}`).digest('hex');
}

app.post('/render', (req, res) => {
  const start = Date.now();
  const { seed = '', width = 512, height = 512 } = req.body;
  const w = Math.max(1, Math.min(4096, parseInt(width)));
  const h = Math.max(1, Math.min(4096, parseInt(height)));
  const key = cacheKey(seed, w, h);
  const file = path.join(CACHE_DIR, `${key}.png`);

  res.on('finish', () => logRequest({
    ts: new Date().toISOString(),
    method: req.method,
    path: req.path,
    status: res.statusCode,
    durationMs: Date.now() - start,
    seed: String(seed).slice(0, 200),
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

  // 1) Memory cache
  const mem = memCache.get(key);
  if (mem) return sendPng(res, mem, 'memory');

  // 2) Disk cache
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    memCache.set(key, buf);
    return sendPng(res, buf, 'disk');
  }

  // 3) Render fresh
  try {
    const buf = render(seed, w, h);
    memCache.set(key, buf);
    fs.writeFile(file, buf, () => {}); // async write, don't block response
    return sendPng(res, buf, 'fresh');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'render failed' });
  }
});

function sendPng(res, buf, source) {
  res.locals.cacheSource = source;
  res.set('Content-Type', 'image/png');
  res.set('X-Cache', source);
  res.send(buf);
}

const PORT = process.env.PORT || 3040;
app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
