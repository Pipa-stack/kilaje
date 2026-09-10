// @vitest-environment node
/**
 * The guard in front of SheetJS.
 *
 * A `.xlsx` is a zip, SheetJS inflates it eagerly, and repetitive XML
 * compresses in the thousands: ten megabytes of upload becomes gigabytes of
 * heap before any limit inside the parser is ever consulted.
 *
 * The archives here are hand-built rather than fixtures, because the attack
 * is a lie told in four specific bytes of the central directory and no real
 * file contains one.
 */

import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { assertInflatedSizeIsSane, MAX_INFLATED_BYTES } from '../server/parser/zipGuard';
import { TemplateError } from '../src/domain/upload';

const NAME = Buffer.from('xl/worksheets/sheet1.xml');

/**
 * One zip entry, with the inflated size the central directory *claims*.
 *
 * `declaredSize` defaults to the truth. Passing something smaller is the whole
 * attack: the directory is metadata an attacker writes, and nothing in a zip
 * makes it agree with the stream beside it.
 */
function buildZip(contents: Buffer, declaredSize = contents.byteLength): Uint8Array {
  const compressed = deflateRawSync(contents, { level: 9 });

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(0, 14); // crc, unchecked by the guard
  local.writeUInt32LE(compressed.byteLength, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(NAME.byteLength, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(compressed.byteLength, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(NAME.byteLength, 28);
  central.writeUInt32LE(0, 42); // local header sits at offset zero

  const centralStart = local.byteLength + NAME.byteLength + compressed.byteLength;
  const centralSize = central.byteLength + NAME.byteLength;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);

  return new Uint8Array(
    Buffer.concat([local, NAME, compressed, central, NAME, eocd]),
  );
}

describe('assertInflatedSizeIsSane', () => {
  it('lets an ordinary workbook through', () => {
    const zip = buildZip(Buffer.from('<worksheet><sheetData/></worksheet>'));
    expect(() => assertInflatedSizeIsSane(zip)).not.toThrow();
  });

  it('refuses an archive that admits how big it inflates', () => {
    // The cheap bomb: honest metadata, absurd size. Caught by reading fifty
    // bytes, without inflating anything.
    const zip = buildZip(Buffer.alloc(1024), MAX_INFLATED_BYTES + 1);
    expect(() => assertInflatedSizeIsSane(zip)).toThrow(TemplateError);
  });

  it('refuses an archive that lies about how big it inflates', () => {
    // The attack the declared-size check could never see: 60 MB of one
    // repeated byte, compressed to a few kilobytes, with the directory
    // claiming a harmless 1 KB. Before the entries were actually inflated
    // this walked straight through into SheetJS.
    const bomb = Buffer.alloc(MAX_INFLATED_BYTES + 10 * 1024 * 1024, 0x41);
    const zip = buildZip(bomb, 1024);

    expect(zip.byteLength).toBeLessThan(1024 * 1024);
    expect(() => assertInflatedSizeIsSane(zip)).toThrow(TemplateError);
  }, 30_000);

  it('accepts a truthful archive that sits just under the budget', () => {
    const almost = Buffer.alloc(MAX_INFLATED_BYTES - 1024, 0x41);
    expect(() => assertInflatedSizeIsSane(buildZip(almost))).not.toThrow();
  }, 30_000);

  it('leaves something that is not a zip to SheetJS', () => {
    // Not this function's job to decide what is a spreadsheet: SheetJS gives
    // a far better error for "this is a PDF" than a zip reader can.
    expect(() => assertInflatedSizeIsSane(new Uint8Array([1, 2, 3, 4]))).not.toThrow();
  });

  it('refuses an entry that hides its compressed size in ZIP64', () => {
    // The asymmetry that used to let a bomb through. The inflated size is
    // declared harmlessly small, so the cheap first pass is happy; the
    // compressed size is the ZIP64 sentinel, so the entry cannot be sliced
    // out of the buffer and the second pass had nothing to inflate and
    // skipped it. Neither check ever looked at the 60 MB actually sitting
    // there.
    const bomb = Buffer.alloc(MAX_INFLATED_BYTES + 10 * 1024 * 1024, 0x41);
    const zip = buildZip(bomb, 1024);

    // Overwrite the central directory's compressed size, and only that.
    const compressedSize = deflateRawSync(bomb, { level: 9 }).byteLength;
    const centralStart = 30 + NAME.byteLength + compressedSize;
    new DataView(zip.buffer, zip.byteOffset, zip.byteLength).setUint32(
      centralStart + 20,
      0xffffffff,
      true,
    );

    expect(() => assertInflatedSizeIsSane(zip)).toThrow(TemplateError);
  }, 30_000);

  it('leaves an entry it cannot inflate to SheetJS as well', () => {
    // Corrupt the compressed stream but keep the headers honest.
    const zip = buildZip(Buffer.from('<worksheet/>'));
    const dataStart = 30 + NAME.byteLength;
    zip[dataStart] = 0xff;
    zip[dataStart + 1] = 0xff;

    expect(() => assertInflatedSizeIsSane(zip)).not.toThrow();
  });
});
