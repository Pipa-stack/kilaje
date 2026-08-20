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
 * This is a filter, not a proof. An archive can understate the sizes in its
 * directory, and only inflating with a running counter would catch that. What
 * it does do is turn the cheap, ordinary bomb — the one built by compressing a
 * gigabyte of the same byte — into a rejected upload, at the cost of parsing
 * about fifty bytes per entry.
 */

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

/**
 * Refuses an archive that claims to inflate past {@link MAX_INFLATED_BYTES}.
 *
 * Silently allows anything it cannot parse: this is a guard in front of
 * SheetJS, not a replacement for it, and SheetJS gives a far better error for
 * "this is not a spreadsheet" than a zip reader can.
 *
 * @throws {TemplateError} when the declared inflated total is too large.
 */
export function assertInflatedSizeIsSane(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd === null) return;

  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  let total = 0;

  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > view.byteLength) return;
    if (view.getUint32(offset, true) !== CENTRAL_FILE_HEADER) return;

    const uncompressed = view.getUint32(offset + 24, true);
    // 0xffffffff means the real size lives in a ZIP64 extra field. Rather than
    // parse those, treat it as the largest thing it could be — a training
    // template has no business needing them.
    total += uncompressed === 0xffffffff ? MAX_INFLATED_BYTES + 1 : uncompressed;

    if (total > MAX_INFLATED_BYTES) {
      throw new TemplateError(
        'El archivo se descomprime a un tamaño desproporcionado. ¿Es la plantilla correcta?',
      );
    }

    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
  }
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
