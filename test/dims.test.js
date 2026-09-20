import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDim, MIN_DIM, MAX_DIM } from '../lib/dims.js';

test('accepts integers, as number or string', () => {
  assert.equal(parseDim(512), 512);
  assert.equal(parseDim('512'), 512);
  assert.equal(parseDim(MIN_DIM), MIN_DIM);
  assert.equal(parseDim(MAX_DIM), MAX_DIM);
});

test('rejects values that parseInt() used to accept', () => {
  // these are the cases that produced a NaN cache key and a 1x1 render
  assert.equal(parseDim('800abc'), null); // parseInt -> 800
  assert.equal(parseDim(''), null);
  assert.equal(parseDim('abc'), null);
  assert.equal(parseDim(null), null);
  assert.equal(parseDim(undefined), null);
  assert.equal(parseDim(NaN), null);
  assert.equal(parseDim(Infinity), null);
  assert.equal(parseDim(true), null);
  assert.equal(parseDim({}), null);
  assert.equal(parseDim([512]), null);
});

test('parses exponent notation correctly (parseInt gave 1)', () => {
  assert.equal(parseDim('1e3'), 1000);
});

test('rejects out-of-range and non-integer numbers', () => {
  assert.equal(parseDim(0), null);
  assert.equal(parseDim(-1), null);
  assert.equal(parseDim(MAX_DIM + 1), null);
  assert.equal(parseDim(512.5), null);
});
