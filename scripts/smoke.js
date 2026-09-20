// End-to-end smoke test: boots the server in a temp sandbox (own cache + log
// dirs), exercises the render endpoint and the new guards, then cleans up.
// Usage: npm run smoke
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seeded-art-smoke-'));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function startServer() {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      CACHE_DIR: path.join(tmp, 'cache'),
      LOG_DIR: path.join(tmp, 'logs'),
      MAX_PIXELS: '10000',
      MAX_CONCURRENT_RENDERS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  return new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/Listening on http:\S+:(\d+)/);
      if (m) resolve({ proc, base: `http://127.0.0.1:${m[1]}` });
    });
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (code) => reject(new Error(`server exited early (${code})`)));
    setTimeout(() => reject(new Error('server did not start in time')), 15000);
  });
}

function stopServer(proc) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve();
    proc.once('exit', resolve);
    proc.kill('SIGTERM');
    setTimeout(() => proc.kill('SIGKILL'), 3000);
  });
}

const post = (base, body) => fetch(`${base}/render`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
});

async function main() {
  let { proc, base } = await startServer();
  try {
    const health = await fetch(`${base}/health`);
    const healthJson = await health.json();
    check('GET /health', health.status === 200 && healthJson.ok === true, JSON.stringify(healthJson));

    const first = await post(base, JSON.stringify({ seed: 'smoke', width: 64, height: 64 }));
    const firstBuf = Buffer.from(await first.arrayBuffer());
    check('first render is fresh',
      first.status === 200 && first.headers.get('x-cache') === 'fresh',
      `${first.status} x-cache=${first.headers.get('x-cache')}`);
    check('content-type is image/png', first.headers.get('content-type') === 'image/png');
    check('cache-control is set', (first.headers.get('cache-control') || '').includes('immutable'));
    check('response is a PNG', firstBuf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a');

    const second = await post(base, JSON.stringify({ seed: 'smoke', width: 64, height: 64 }));
    check('second render is served from memory', second.headers.get('x-cache') === 'memory',
      `x-cache=${second.headers.get('x-cache')}`);

    const bad = await post(base, JSON.stringify({ seed: 'smoke', width: 'abc', height: 64 }));
    const badJson = await bad.json();
    check('non-integer width is a 400', bad.status === 400 && !!badJson.error, `${bad.status} ${badJson.error}`);

    const huge = await post(base, JSON.stringify({ seed: 'smoke', width: 4096, height: 4096 }));
    check('oversized request is rejected before rendering', huge.status === 400,
      `${huge.status} ${(await huge.json()).error}`);

    const badJson2 = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const badJsonBody = await badJson2.json();
    check('malformed JSON returns a JSON 400',
      badJson2.status === 400 && badJsonBody.error === 'invalid json',
      `${badJson2.status} ${badJsonBody.error}`);

    // rendered once here so it exists on disk (but not in memory) after the restart
    await post(base, JSON.stringify({ seed: 'corruptme', width: 64, height: 64 }));

    // N2/N3: with MAX_CONCURRENT_RENDERS=1, parallel distinct renders must not all run
    const parallel = await Promise.all([1, 2, 3].map((n) =>
      post(base, JSON.stringify({ seed: `par-${n}`, width: 64, height: 64 }))));
    const statuses = parallel.map((r) => r.status);
    check('concurrency cap produces at least one 429', statuses.includes(429), statuses.join(','));

    // identical concurrent requests share one render (N2)
    const dupes = await Promise.all([1, 2, 3].map(() =>
      post(base, JSON.stringify({ seed: 'dupe', width: 64, height: 64 }))));
    const dupeBytes = await Promise.all(dupes.map((r) => r.arrayBuffer().then((b) => Buffer.from(b))));
    check('duplicate concurrent renders return identical bytes',
      dupeBytes.every((b) => Buffer.compare(b, dupeBytes[0]) === 0) && dupes.every((r) => r.status === 200),
      dupes.map((r) => r.status).join(','));

    await new Promise((r) => setTimeout(r, 300)); // let the async cache write land
    await stopServer(proc);

    // restart: disk cache should now serve it, byte-identical
    ({ proc, base } = await startServer());
    const disk = await post(base, JSON.stringify({ seed: 'smoke', width: 64, height: 64 }));
    const diskBuf = Buffer.from(await disk.arrayBuffer());
    check('after restart the disk cache serves it', disk.headers.get('x-cache') === 'disk',
      `x-cache=${disk.headers.get('x-cache')}`);
    check('disk copy is byte-identical', Buffer.compare(firstBuf, diskBuf) === 0);

    // #7: a corrupt entry must be re-rendered, not served (use a seed that is
    // only on disk — 'smoke' is already in the memory cache at this point)
    const cacheDir = path.join(tmp, 'cache');
    for (const f of fs.readdirSync(cacheDir).filter((f) => f.endsWith('.png'))) {
      fs.writeFileSync(path.join(cacheDir, f), 'not a png');
    }
    const repaired = await post(base, JSON.stringify({ seed: 'corruptme', width: 64, height: 64 }));
    const repairedBuf = Buffer.from(await repaired.arrayBuffer());
    check('corrupt cache entry is re-rendered',
      repaired.headers.get('x-cache') === 'fresh' && repairedBuf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
      `x-cache=${repaired.headers.get('x-cache')}`);

    check('request log was written',
      fs.existsSync(path.join(tmp, 'logs', 'requests.jsonl')) &&
      fs.readFileSync(path.join(tmp, 'logs', 'requests.jsonl'), 'utf8').includes('"path":"/render"'));
  } finally {
    await stopServer(proc);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\nsmoke: all checks passed' : `\nsmoke: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke failed:', err);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
