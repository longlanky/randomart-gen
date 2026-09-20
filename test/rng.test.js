import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, makeStream, xmur3 } from '../lib/rng.js';

test('same seed yields the same sequence', () => {
  const a = makeRng('hello');
  const b = makeRng('hello');
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('different seeds diverge', () => {
  const a = makeRng('hello');
  const b = makeRng('hellp');
  let same = 0;
  for (let i = 0; i < 100; i++) if (a() === b()) same++;
  assert.ok(same < 5, `expected divergence, got ${same} identical values`);
});

test('values stay in [0, 1)', () => {
  const rng = makeRng('bounds');
  for (let i = 0; i < 1000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('helpers stay in range', () => {
  const rng = makeRng('helpers');
  for (let i = 0; i < 1000; i++) {
    const n = rng.int(3, 7);
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 7, `int out of range: ${n}`);
    const r = rng.range(-2, 2);
    assert.ok(r >= -2 && r < 2, `range out of range: ${r}`);
  }
  assert.ok(['a', 'b', 'c'].includes(rng.pick(['a', 'b', 'c'])));
});

test('xmur3 hashes UTF-8 bytes, not JS characters', () => {
  // 'é' is one UTF-16 code unit but two UTF-8 bytes; the seed must not collapse
  const a = xmur3('é')();
  const b = xmur3(String.fromCharCode(0xc3, 0xa9))();
  assert.notEqual(a, b);
});

test('named streams isolate geometry from texture sampling and call order', () => {
  const expected = makeStream('a seed 🌱', 'v4', 'geometry');
  const geometry = makeStream('a seed 🌱', 'v4', 'geometry');
  const texture = makeStream('a seed 🌱', 'v4', 'texture');
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < i * 100; j++) texture();
    assert.equal(geometry(), expected());
  }
});

test('stream names preserve tuple boundaries and generator versions', () => {
  const sequence = (...args) => {
    const rng = makeStream(...args);
    return Array.from({ length: 8 }, () => rng());
  };
  assert.notDeepEqual(sequence('seed', 'v4', 'a', 'b'), sequence('seed', 'v4', 'a,b'));
  assert.notDeepEqual(sequence('seed', 'v4', 'geometry'), sequence('seed', 'v5', 'geometry'));
});
