import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { createArtwork } from '../lib/artwork-v4.js';
import { rasterizeArtwork } from '../lib/raster-v4.js';
import { oklchToRgb } from '../lib/palette.js';

const RENDER_VERSION = 'v4';

const seeds = ['gallery-1', 'gallery-2', 'gallery-10', 'gallery-3', 'gallery-6', 'gallery-15', 'gallery-0', 'gallery-11', 'gallery-20'];
const pixels = (canvas, x = 0, y = 0, w = canvas.width, h = canvas.height) => canvas.getContext('2d').getImageData(x, y, w, h).data;

function freezeDeep(object) {
  if (!object || typeof object !== 'object' || Object.isFrozen(object)) return;
  Object.freeze(object);
  for (const value of Object.values(object)) freezeDeep(value);
}

test('preserved v4 plans match fingerprints captured before the v5 migration', () => {
  const fingerprints = {
    'gallery-1': 'fca6611fb33cc52478a926df9c30102776c8f35659c687a4c62e3fd19591cff1',
    'gallery-3': 'e6776c4060ab7e1c810f08d48c1dc7c48722345de149ea73392ddef436e00e46',
    'gallery-11': 'dda2f924e14ea53467011d011111d43dfa270dfc35a0dd027000fed3c7d74b3b',
  };
  for (const [seed, expected] of Object.entries(fingerprints)) {
    assert.equal(createHash('sha256').update(JSON.stringify(createArtwork(seed))).digest('hex'), expected);
  }
});

test('fixed seeds exercise all nine variants, varied palettes, clean and textured finishes', () => {
  const artworks = seeds.map(createArtwork);
  assert.equal(new Set(artworks.map((a) => `${a.family}/${a.variant}`)).size, 9);
  assert.equal(new Set(artworks.map((a) => a.palette.theme)).size, 3);
  assert.equal(new Set(artworks.map((a) => a.effects.material)).size, 3);
  assert.ok(artworks.some((a) => a.effects.glow));
  for (const art of artworks) {
    assert.equal(art.version, RENDER_VERSION);
    assert.ok(art.layers[0].marks.length > 0, art.seed);
    assert.deepEqual(art, createArtwork(art.seed));
  }
});

test('artwork plans round-trip through JSON and remain immutable across exports', () => {
  for (const seed of seeds) {
    const art = createArtwork(seed);
    const snapshot = JSON.stringify(art);
    freezeDeep(art);
    const small = rasterizeArtwork(art, 80, 80);
    rasterizeArtwork(art, 320, 240);
    assert.equal(JSON.stringify(art), snapshot);
    assert.deepEqual(pixels(rasterizeArtwork(JSON.parse(snapshot), 80, 80)), pixels(small));
  }
});

test('portrait and landscape exports preserve square artwork pixels, including odd margins', () => {
  for (const seed of seeds) {
    const art = createArtwork(seed);
    const expected = pixels(rasterizeArtwork(art, 96, 96));
    for (const [w, h] of [[192, 96], [96, 192], [195, 96], [96, 195]]) {
      const image = rasterizeArtwork(art, w, h);
      const x = Math.floor((w - 96) / 2), y = Math.floor((h - 96) / 2);
      assert.deepEqual(pixels(image, x, y, 96, 96), expected, `${seed}: ${w}x${h} changes the artwork`);
      const data = pixels(image);
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          if (col >= x && col < x + 96 && row >= y && row < y + 96) continue;
          const offset = (row * w + col) * 4;
          for (let channel = 0; channel < 3; channel++) assert.equal(data[offset + channel], art.palette.background[channel]);
          assert.equal(data[offset + 3], 255);
        }
      }
    }
  }
});

test('larger exports retain appearance when downsampled, with rasterization tolerance', () => {
  for (const seed of seeds) {
    const art = createArtwork(seed);
    const small = pixels(rasterizeArtwork(art, 192, 192));
    const large = rasterizeArtwork(art, 768, 768);
    const reduced = createCanvas(192, 192);
    const ctx = reduced.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(large, 0, 0, 192, 192);
    const downsampled = pixels(reduced);
    let error = 0;
    for (let i = 0; i < small.length; i++) {
      if (i % 4 !== 3) error += Math.abs(small[i] - downsampled[i]);
    }
    const meanError = error / (192 * 192 * 3);
    assert.ok(meanError < 8, `${seed}: RGB mean absolute error ${meanError.toFixed(2)}`);
  }
});

test('one-pixel and odd artboards remain opaque in extreme fitted viewports', () => {
  for (const seed of ['gallery-3', 'gallery-11']) {
    const art = createArtwork(seed);
    for (const [w, h] of [[1, 1], [1, 4096], [4096, 1], [255, 257], [257, 255]]) {
      const image = rasterizeArtwork(art, w, h);
      assert.equal(image.width, w);
      assert.equal(image.height, h);
      const data = pixels(image);
      for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 255);
    }
  }
});

test('OKLCH conversion maps reference colors and keeps saturated hues in gamut', () => {
  assert.deepEqual(oklchToRgb(0, 0, 0), [0, 0, 0]);
  assert.deepEqual(oklchToRgb(1, 0, 0), [255, 255, 255]);
  const red = oklchToRgb(0.627955, 0.257683, 29.2339);
  assert.ok(red[0] >= 254 && red[1] <= 1 && red[2] <= 1);
  for (let hue = 0; hue < 360; hue += 15) {
    for (const light of [0.18, 0.5, 0.96]) {
      assert.ok(oklchToRgb(light, 0.4, hue).every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
    }
  }
});
