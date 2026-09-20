// Fixed seeds: widescreen, square, ultrawide, and portrait adaptive layouts.
// Usage: npm run gallery -- /path/to/gallery.png
import { writeFile } from 'node:fs/promises';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { createArtwork } from '../lib/artwork.js';
import { rasterizeArtwork } from '../lib/raster.js';
import { RENDER_VERSION } from '../lib/version.js';

const output = process.argv[2];
if (!output) {
  console.error('Usage: npm run gallery -- /path/to/gallery.png');
  process.exit(1);
}

const seeds = ['review-8', 'review-29', 'review-3', 'review-6', 'review-7', 'review-19', 'review-0', 'review-34', 'review-2', 'review-9', 'review-56', 'review-1'];
const canvas = createCanvas(1368, 1680);
const ctx = canvas.getContext('2d');

// Headless installations may have no system fonts. A tiny bitmap fallback keeps
// the seed/version labels legible without adding a font dependency to the app.
const glyphs = {
  A: '0e11111f111111', B: '1e11111e11111e', C: '0e11101010110e',
  D: '1e11111111111e', E: '1f10101e10101f', F: '1f10101e101010',
  G: '0e11101711110f', H: '1111111f111111', I: '0e04040404040e',
  J: '0702020202120c', K: '11121418141211', L: '1010101010101f',
  M: '111b1515111111', N: '11191513111111', O: '0e11111111110e',
  P: '1e11111e101010', Q: '0e11111115120d', R: '1e11111e141211',
  S: '0f10100e01011e', T: '1f040404040404', U: '1111111111110e',
  V: '11111111110a04', W: '11111115151b11', X: '11110a040a1111',
  Y: '11110a04040404', Z: '1f01020408101f',
  0: '0e11131519110e', 1: '040c040404040e', 2: '0e11010204081f',
  3: '1e01010601011e', 4: '02060a121f0202', 5: '1f10101e01011e',
  6: '0e10101e11110e', 7: '1f010204080808', 8: '0e11110e11110e',
  9: '0e11110f01010e', '-': '0000001f000000', '/': '01020204080810',
  '·': '00000004000000',
};

function label(text, x, y, size, bold = false) {
  if (GlobalFonts.families.length) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`;
    ctx.fillText(text, x, y);
    return;
  }
  const scale = size / 10;
  for (const character of text.toUpperCase()) {
    const glyph = glyphs[character];
    if (glyph) {
      for (let row = 0; row < 7; row++) {
        const bits = parseInt(glyph.slice(row * 2, row * 2 + 2), 16);
        for (let col = 0; col < 5; col++) {
          if (bits & (1 << (4 - col))) ctx.fillRect(x + col * scale, y - (7 - row) * scale, scale, scale);
        }
      }
    }
    x += 6 * scale;
  }
}

ctx.fillStyle = '#e7e4df';
ctx.fillRect(0, 0, canvas.width, canvas.height);
for (let i = 0; i < seeds.length; i++) {
  const art = createArtwork(seeds[i], 16, 9);
  const x = i % 3 * 456 + 20, y = Math.floor(i / 3) * 420;
  ctx.fillStyle = '#242428';
  label(`${art.family} / ${art.variant}`, x, y + 24, 15, true);
  label(`${art.seed} · ${RENDER_VERSION} · ${art.palette.theme}/${art.effects.material}`, x, y + 44, 12);
  ctx.drawImage(rasterizeArtwork(art, 416, 234), x, y + 52);
  for (const [dx, width, height] of [[0, 112, 112], [124, 196, 84], [332, 63, 112]]) {
    ctx.drawImage(rasterizeArtwork(createArtwork(seeds[i], width, height), width, height), x + dx, y + 298);
  }
}
await writeFile(output, await canvas.encode('png'));
console.log(`Wrote ${RENDER_VERSION} contact sheet to ${output}`);
