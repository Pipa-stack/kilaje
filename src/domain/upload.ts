/**
 * Upload constraints shared by the browser and the server.
 *
 * The browser checks these to fail fast and give a clear message; the server
 * checks them again because a client-side check is a convenience, not a
 * control. Both sides must agree on the numbers, so they live here — in the
 * domain, free of any spreadsheet or HTTP dependency.
 */

/** Raised when a file is not the expected training template. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** Hard cap on accepted uploads. A training template is a few hundred KB. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Extensions the parser can read. The old binary `.xls` is not supported. */
export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xlsm'] as const;

/**
 * Minimum password length, shared so the form and the server agree.
 *
 * Length beats character-class rules: a long passphrase is both easier to
 * remember and harder to guess than eight characters with a symbol in them.
 */
export const MIN_PASSWORD_LENGTH = 10;
