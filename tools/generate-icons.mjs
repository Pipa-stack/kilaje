/**
 * Generates the app icons, so they are reproducible rather than binary blobs
 * nobody can regenerate: `node tools/generate-icons.mjs`.
 *
 * A barbell drawn out of rectangles — a bar, two plates a side — in the app's
 * own palette. No image library: a PNG is a zlib stream of scanlines plus
 * three chunks, and pulling in a rasteriser to draw six rectangles would be
 * the wrong trade.
 *
 * Also emits the maskable variant Android needs, which is the same drawing
 * inside the safe zone so the launcher's mask cannot crop the plates off.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');

const BACKGROUND = [0x0e, 0x10, 0x0f]; // iron-950
const BAR = [0xf2, 0xf4, 0xf0]; // chalk
const PLATE = [0xf2, 0xc2, 0x00]; // signal-500

/**
 * Draws the barbell into an RGBA buffer.
 *
 * @param size pixels a side
 * @param scale how much of the canvas the drawing occupies (1 = edge to edge).
 *   Maskable icons keep to 0.6 so a circular mask cannot cut into it.
 */
function draw(size, scale) {
  const pixels = Buffer.alloc(size * size * 4);

  for (let i = 0; i < size * size; i += 1) {
    pixels[i * 4] = BACKGROUND[0];
    pixels[i * 4 + 1] = BACKGROUND[1];
    pixels[i * 4 + 2] = BACKGROUND[2];
    pixels[i * 4 + 3] = 255;
  }

  const rect = (x, y, width, height, colour) => {
    for (let row = Math.round(y); row < Math.round(y + height); row += 1) {
      if (row < 0 || row >= size) continue;
      for (let col = Math.round(x); col < Math.round(x + width); col += 1) {
        if (col < 0 || col >= size) continue;
        const at = (row * size + col) * 4;
        pixels[at] = colour[0];
        pixels[at + 1] = colour[1];
        pixels[at + 2] = colour[2];
      }
    }
  };

  const unit = (size * scale) / 100;
  const centre = size / 2;

  // The bar, then the inner and outer plates mirrored either side of it.
  rect(centre - unit * 40, centre - unit * 4, unit * 80, unit * 8, BAR);

  for (const direction of [-1, 1]) {
    rect(centre + direction * unit * 26 - unit * 5, centre - unit * 26, unit * 10, unit * 52, PLATE);
    rect(centre + direction * unit * 38 - unit * 4, centre - unit * 17, unit * 8, unit * 34, PLATE);
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
  { name: 'icon-192.png', size: 192, scale: 0.82 },
  { name: 'icon-512.png', size: 512, scale: 0.82 },
  { name: 'icon-maskable-512.png', size: 512, scale: 0.6 },
  // iOS ignores the manifest and reads this one from a <link> tag.
  { name: 'apple-touch-icon.png', size: 180, scale: 0.82 },
]) {
  writeFileSync(join(OUT, name), encodePng(size, draw(size, scale)));
  console.log(`${name} (${size}x${size})`);
}
