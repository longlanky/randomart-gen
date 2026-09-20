import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createArtwork, artworkIdentity } from '../lib/artwork.js';
import { rasterizeArtwork } from '../lib/raster.js';
import { effectViewport } from '../lib/layout.js';
import { RENDER_VERSION } from '../lib/version.js';
import { render } from '../lib/render.js';
import { CHAOTIC_KINDS } from '../lib/chaos.js';

const seeds = ['review-8', 'review-29', 'review-3', 'review-6', 'review-7', 'review-19', 'review-0', 'review-34', 'review-2', 'review-9', 'review-56', 'review-1'];
const pixels = (canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;

function freezeDeep(object) {
  if (!object || typeof object !== 'object' || Object.isFrozen(object)) return;
  Object.freeze(object);
  for (const value of Object.values(object)) freezeDeep(value);
}

function meanError(a, b) {
  let error = 0;
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) error += Math.abs(a[i] - b[i]);
  return error / (a.length / 4 * 3);
}

test('v5 seeds cover nine structured variants and three chaotic intensities', () => {
  const art = seeds.map((seed) => createArtwork(seed, 16, 9));
  assert.equal(new Set(art.map((a) => `${a.family}/${a.variant}`)).size, 12);
  for (const a of art) {
    assert.equal(a.version, RENDER_VERSION);
    assert.ok(a.layers.every((l) => l.marks.length > 0));
    if (a.family === 'chaotic') assert.ok(a.layers.length >= 5 && a.layers.length <= 12);
  }
});

test('chaotic mode occupies about 30% of seeds and remaining families are balanced', () => {
  const counts = { minimal: 0, organic: 0, ornamental: 0, chaotic: 0 };
  for (let i = 0; i < 3000; i++) counts[artworkIdentity(`distribution-${i}`).family]++;
  assert.ok(counts.chaotic > 810 && counts.chaotic < 990, JSON.stringify(counts));
  for (const family of ['minimal', 'organic', 'ornamental']) assert.ok(counts[family] > 600 && counts[family] < 800, JSON.stringify(counts));
});

test('equivalent ratios create identical plans; changing ratio preserves identity and effect choices', () => {
  for (const seed of seeds) {
    const art = createArtwork(seed, 1920, 1080);
    assert.deepEqual(art, createArtwork(seed, 3840, 2160));
    assert.deepEqual(art, createArtwork(seed, 16, 9));
    for (const [w, h] of [[1, 1], [9, 16], [21, 9]]) {
      const adapted = createArtwork(seed, w, h);
      assert.equal(adapted.family, art.family);
      assert.equal(adapted.variant, art.variant);
      assert.deepEqual(adapted.palette, art.palette);
      assert.deepEqual(adapted.effects, art.effects);
      assert.notDeepEqual(adapted.layers, art.layers);
    }
  }
});

test('plans are serializable and rendering never mutates them', () => {
  for (const seed of seeds) {
    const art = createArtwork(seed, 16, 9);
    const before = JSON.stringify(art);
    freezeDeep(art);
    const a = rasterizeArtwork(art, 160, 90);
    rasterizeArtwork(art, 320, 180);
    assert.equal(JSON.stringify(art), before);
    assert.deepEqual(pixels(a), pixels(rasterizeArtwork(JSON.parse(before), 160, 90)));
    assert.throws(() => rasterizeArtwork(art, 90, 160), /aspect ratio/);
  }
});

test('full-frame rasterization reaches every edge without padding or distorting circles', () => {
  for (const [w, h] of [[160, 90], [90, 160], [210, 90], [99, 99], [255, 257]]) {
    const art = createArtwork('frame-fixture', w, h);
    const { width, height } = art.viewport;
    art.effects = { symmetry: 'none', material: 'clean' };
    art.layers = [{ marks: [
      { type: 'rect', x: 0, y: 0, width: width / 2, height, fill: [220, 30, 40] },
      { type: 'rect', x: width / 2, y: 0, width: width / 2, height, fill: [30, 70, 220] },
      { type: 'circle', x: width / 2, y: height / 2, radius: 200, fill: [0, 255, 0] },
    ] }];
    const data = pixels(rasterizeArtwork(art, w, h));
    for (let y = 0; y < h; y++) {
      assert.deepEqual(Array.from(data.slice(y * w * 4, y * w * 4 + 4)), [220, 30, 40, 255]);
      assert.deepEqual(Array.from(data.slice((y * w + w - 1) * 4, (y * w + w) * 4)), [30, 70, 220, 255]);
    }
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 1] > 240) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    assert.ok(Math.abs((x1 - x0) - (y1 - y0)) <= 1, `${w}x${h} stretched a circle`);
  }
});

test('all variants preserve appearance at larger widescreen resolutions', () => {
  for (const seed of seeds) {
    const art = createArtwork(seed, 16, 9);
    const small = rasterizeArtwork(art, 256, 144), large = rasterizeArtwork(art, 1024, 576);
    const reduced = createCanvas(256, 144), ctx = reduced.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(large, 0, 0, 256, 144);
    const error = meanError(pixels(small), pixels(reduced));
    assert.ok(error < 8, `${seed}: mean RGB error ${error.toFixed(2)}`);
  }
});

test('portrait, square, ultrawide and odd-ratio exports preserve appearance across resolutions', () => {
  for (const seed of ['review-8', 'review-6', 'review-0', 'review-9']) {
    for (const [w, h] of [[90, 160], [160, 160], [210, 90], [127, 129]]) {
      const art = createArtwork(seed, w, h);
      const small = rasterizeArtwork(art, w, h), large = rasterizeArtwork(art, w * 3, h * 3);
      const reduced = createCanvas(w, h), ctx = reduced.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(large, 0, 0, w, h);
      const error = meanError(pixels(small), pixels(reduced));
      assert.ok(error < 9, `${seed} ${w}x${h}: mean RGB error ${error.toFixed(2)}`);
    }
  }
});

test('extreme viewports, all symmetry modes, and effect buffers stay bounded and opaque', () => {
  for (const [w, h] of [[1, 1], [1, 4096], [4096, 1], [255, 257]]) {
    const art = createArtwork('review-1', w, h);
    const size = effectViewport(art.viewport);
    assert.ok(size.width >= 1 && size.height >= 1 && size.width * size.height <= 512 * 512);
    for (const symmetry of ['none', 'mirror', 'tile', 'kaleido']) {
      art.effects.symmetry = symmetry;
      const canvas = rasterizeArtwork(art, w, h), data = pixels(canvas);
      assert.equal(canvas.width, w);
      assert.equal(canvas.height, h);
      for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 255);
    }
  }
});

test('chaotic layers and optional finishes remain byte-deterministic', async () => {
  const kinds = new Set(), finishes = new Set();
  for (const seed of ['review-1', 'review-9', 'review-26', 'review-27', 'review-38', 'review-56']) {
    const art = createArtwork(seed, 16, 9);
    for (const layer of art.layers) kinds.add(layer.kind);
    for (const name of ['glow', 'pixelSort', 'duotone', 'posterize', 'aberration', 'scanlines']) if (art.effects[name]) finishes.add(name);
    assert.deepEqual(await render(seed, 128, 72), await render(seed, 128, 72));
  }
  assert.deepEqual([...kinds].sort(), [...CHAOTIC_KINDS].sort());
  assert.equal(finishes.size, 6);
});
