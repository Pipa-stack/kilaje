/**
 * Parser error type and limits, kept free of the `xlsx` dependency.
 *
 * The app shell needs these to validate an upload before doing anything else;
 * SheetJS is ~600 kB and is loaded on demand only when a file is actually
 * being parsed (see `useProgram.importFile`).
 */

/** Raised when the file is not the expected training template. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** Hard cap on accepted uploads. A training template is a few hundred KB. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
