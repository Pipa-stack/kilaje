/**
 * Generates the app icons, so they are reproducible rather than binary blobs
 * nobody can regenerate: `node tools/generate-icons.mjs`.
 *
 * A heavy K in the app's dark iron on its competition yellow: the initial
 * reads at the size of a home-screen icon, where the old barbell turned into
 * a smudge. No image library: a PNG is a zlib stream of scanlines plus three
 * chunks, and the K is three polygons, filled with 4x4 supersampling so the
 * diagonals are smooth rather than stepped.
 *
 * Also emits the maskable variant Android needs, which is the same drawing
 * inside the safe zone so the launcher's mask cannot crop the letter.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');

const BACKGROUND = [0xf2, 0xc2, 0x00]; // signal-500
const INK = [0x0e, 0x10, 0x0f]; // iron-950

/**
 * The K, in a 100-unit box centred on 0,0: the stem, the upper arm and the
 * lower leg. The arms overlap the stem, so the joins need no special care.
 */
const K = [
  [[-30, -36], [-11, -36], [-11, 36], [-30, 36]],
  [[-14, 4], [17, -36], [40, -36], [-2, 17]],
  [[-11, 0], [6, -12], [42, 36], [18, 36], [-11, 12]],
];

/** Even-odd point-in-polygon test. */
function inside(x, y, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Draws the K into an RGBA buffer.
 *
 * @param size pixels a side
 * @param scale how much of the canvas the drawing occupies (1 = edge to edge).
 *   Maskable icons keep to 0.6 so a circular mask cannot cut into it.
 */
function draw(size, scale) {
  const pixels = Buffer.alloc(size * size * 4);
  const unit = (size * scale) / 100;
  const centre = size / 2;
  const SAMPLES = 4;

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      let covered = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (col + (sx + 0.5) / SAMPLES - centre) / unit;
          const y = (row + (sy + 0.5) / SAMPLES - centre) / unit;
          if (K.some((polygon) => inside(x, y, polygon))) covered += 1;
        }
      }
      const alpha = covered / (SAMPLES * SAMPLES);
      const at = (row * size + col) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[at + channel] = Math.round(BACKGROUND[channel] * (1 - alpha) + INK[channel] * alpha);
      }
      pixels[at + 3] = 255;
    }
  }

  return pixels;
}

/** Wraps raw RGBA into a PNG: signature, IHDR, IDAT, IEND. */
function encodePng(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let row = 0; row < size; row += 1) {
    // Filter byte 0 (None) in front of every scanline.
    raw[row * (size * 4 + 1)] = 0;
    pixels.copy(raw, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

mkdirSync(OUT, { recursive: true });

for (const { name, size, scale } of [
  { name: 'icon-192.png', size: 192, scale: 0.9 },
  { name: 'icon-512.png', size: 512, scale: 0.9 },
  { name: 'icon-maskable-512.png', size: 512, scale: 0.6 },
  // iOS ignores the manifest and reads this one from a <link> tag.
  { name: 'apple-touch-icon.png', size: 180, scale: 0.9 },
]) {
  writeFileSync(join(OUT, name), encodePng(size, draw(size, scale)));
  console.log(`${name} (${size}x${size})`);
}
