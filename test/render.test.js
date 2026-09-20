import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../lib/render.js';

test('render is deterministic for the same seed and size', async () => {
  const a = await render('determinism', 64, 64);
  const b = await render('determinism', 64, 64);
  assert.equal(Buffer.compare(a, b), 0);
});

test('render returns a PNG', async () => {
  const buf = await render('png', 32, 32);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('render clamps unusable dimensions instead of throwing', async () => {
  for (const bad of [NaN, undefined, null, 'abc', 0, -5, 1e9]) {
    const buf = await render('clamp', bad, 16);
    assert.ok(buf.length > 0, `expected a PNG for ${String(bad)}`);
  }
});

test('odd dimensions render without error', async () => {
  // previously the mirror symmetry modes left a black seam at odd sizes
  const buf = await render('odd', 255, 257);
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});
