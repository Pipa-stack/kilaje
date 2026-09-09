/**
 * What a workbook is allowed to weigh once unzipped.
 *
 * Every size check before this one — the 10 MB in `express.raw`, in the route,
 * in `parseWorkbook` — measures the **compressed** bytes. SheetJS then inflates
 * the whole archive eagerly, and a 10 MB `.xlsx` whose XML is repetitive text
 * compresses at ratios in the thousands: the heap is gone before any of the
 * parser's own limits are consulted.
 *
 * So the archive is inspected before it is opened. A zip's central directory
 * lists, for every entry, the size it claims to inflate to; the sum of those
 * claims has to fit in a budget or the file is refused unread.
 *
 * That check alone was a filter, not a proof, and this file used to say so:
 * the declared sizes are four bytes an attacker writes, and understating them
 * walked straight past it into SheetJS, which inflates for real. A 10 MB
 * archive of repetitive XML reaches gigabytes, and the heap is gone before any
 * of the parser's own limits are ever consulted.
 *
 * So the claim is now checked against the bytes. Every entry is inflated here
 * first, through a counter that stops at the budget, and only an archive whose
 * *actual* inflated size fits is handed on. The cost is inflating a legitimate
 * workbook twice — a few hundred kilobytes, twice — and the benefit is that
 * the number an attacker controls no longer decides anything.
 */

import { inflateRawSync } from 'node:zlib';

import { MAX_FILE_BYTES, TemplateError } from '../../src/domain/upload';

/**
 * How much inflated XML a legitimate training workbook can need.
 *
 * The reference files are a few hundred kilobytes unzipped. Fifty megabytes is
 * far past any real one and far below what hurts.
 */
export const MAX_INFLATED_BYTES = 50 * 1024 * 1024;

/** Signature of the end-of-central-directory record. */
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;

/** The EOCD is at the end, after a comment of up to 64 kB. */
const MAX_COMMENT = 0xffff;

/** Deflate. Anything else in a real `.xlsx` is stored, which needs no work. */
const METHOD_DEFLATE = 8;
const LOCAL_FILE_HEADER = 0x04034b50;

/**
 * Refuses an archive that inflates past {@link MAX_INFLATED_BYTES}.
 *
 * Two passes, cheap one first: the central directory's declared sizes reject
 * the ordinary bomb for the price of fifty bytes an entry, and then the
 * entries are actually inflated to catch the archive that lied about them.
 *
 * Silently allows anything it cannot parse: this is a guard in front of
 * SheetJS, not a replacement for it, and SheetJS gives a far better error for
 * "this is not a spreadsheet" than a zip reader can.
 *
 * @throws {TemplateError} when the inflated total is too large.
 */
export function assertInflatedSizeIsSane(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd === null) return;

  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  let total = 0;
  const entryPlan: EntryPlan[] = [];

  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > view.byteLength) return;
    if (view.getUint32(offset, true) !== CENTRAL_FILE_HEADER) return;

    const uncompressed = view.getUint32(offset + 24, true);
    // 0xffffffff means the real size lives in a ZIP64 extra field. Rather than
    // parse those, treat it as the largest thing it could be — a training
    // template has no business needing them.
    total += uncompressed === 0xffffffff ? MAX_INFLATED_BYTES + 1 : uncompressed;

    if (total > MAX_INFLATED_BYTES) throw tooBig();

    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);

    entryPlan.push({
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  assertRealInflatedSizeIsSane(bytes, view, entryPlan);
}

interface EntryPlan {
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/**
 * Inflates every entry against a shrinking budget.
 *
 * `maxOutputLength` is what makes this safe to do at all: zlib stops and
 * throws at the ceiling instead of allocating whatever the stream asks for,
 * so checking a bomb costs the budget and not the bomb.
 *
 * An entry that will not inflate for any other reason — encrypted, truncated,
 * not deflate at all — is left alone. It is not this function's job to decide
 * whether a file is a spreadsheet, and SheetJS will fail it with a message
 * somebody can act on.
 */
function assertRealInflatedSizeIsSane(
  bytes: Uint8Array,
  view: DataView,
  entries: readonly EntryPlan[],
): void {
  let remaining = MAX_INFLATED_BYTES;

  for (const entry of entries) {
    const data = entryData(bytes, view, entry);
    if (data === null) continue;

    if (entry.method !== METHOD_DEFLATE) {
      // Stored: what it weighs compressed is what it weighs inflated.
      remaining -= data.byteLength;
      if (remaining < 0) throw tooBig();
      continue;
    }

    try {
      // +1 so that hitting the budget exactly still fits, and only passing it
      // throws — the ceiling is inclusive.
      remaining -= inflateRawSync(data, { maxOutputLength: remaining + 1 }).byteLength;
    } catch (error) {
      if (isTooLarge(error)) throw tooBig();
      continue;
    }

    if (remaining < 0) throw tooBig();
  }
}

/** The compressed bytes of one entry, or null when the header does not read. */
function entryData(bytes: Uint8Array, view: DataView, entry: EntryPlan): Uint8Array | null {
  const at = entry.localHeaderOffset;
  if (at + 30 > view.byteLength) return null;
  if (view.getUint32(at, true) !== LOCAL_FILE_HEADER) return null;

  // The local header's own name and extra lengths, which are allowed to differ
  // from the central directory's — the data starts after whatever *this* one
  // declares, not after what the other one did.
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const end = start + entry.compressedSize;
  if (entry.compressedSize === 0xffffffff || end > bytes.byteLength) return null;

  return bytes.subarray(start, end);
}

/** zlib's own signal that it stopped at `maxOutputLength`. */
function isTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE'
  );
}

function tooBig(): TemplateError {
  return new TemplateError(
    'El archivo se descomprime a un tamaño desproporcionado. ¿Es la plantilla correcta?',
  );
}

/** Scans backwards for the EOCD signature, which is the only way to find it. */
function findEndOfCentralDirectory(view: DataView): number | null {
  const earliest = Math.max(0, view.byteLength - MAX_COMMENT - 22);
  for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return null;
}

export { MAX_FILE_BYTES };
