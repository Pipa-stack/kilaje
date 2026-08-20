/**
 * Request validation.
 *
 * Nothing from the client is trusted: ids must be positive integers, set
 * values must be inside the ranges the database also enforces, and unknown
 * keys are rejected rather than passed through. The CHECK constraints in
 * `001_init.sql` are the second line of defence, not the first.
 */

import { z } from 'zod';

/** A database id arriving as a path parameter. */
export const idParam = z
  .string()
  .regex(/^\d{1,18}$/, 'Identificador inválido')
  .transform((value) => Number.parseInt(value, 10))
  .refine((value) => Number.isSafeInteger(value) && value > 0, 'Identificador inválido');

const optionalNumber = (max: number, integer: boolean) =>
  z
    .union([z.number(), z.null()])
    .refine(
      (value) => value === null || (Number.isFinite(value) && value >= 0 && value <= max),
      `Debe ser un número entre 0 y ${max}`,
    )
    .refine(
      (value) => value === null || !integer || Number.isInteger(value),
      'Debe ser un número entero',
    );

export const saveSetBody = z
  .object({
    exerciseId: z.number().int().positive(),
    setIndex: z.number().int().min(0).max(49),
    // The column is NUMERIC(7,2), so 99999.99 is the largest value it can
    // hold. Accepting 100000 here — as the CHECK constraint nominally allows —
    // gets past validation and then dies in the driver with a numeric overflow
    // and a 500. Nine tonnes is already far past any barbell.
    weight: optionalNumber(99_999, false),
    reps: optionalNumber(999, true),
    rir: optionalNumber(10, true),
  })
  .strict();

export type SaveSetBody = z.infer<typeof saveSetBody>;

export const deleteSetBody = z
  .object({
    exerciseId: z.number().int().positive(),
    setIndex: z.number().int().min(0).max(49),
  })
  .strict();

export const sessionPatchBody = z
  .object({
    // Bounded so a paste cannot fill the database with one request.
    notes: z.string().max(4000).optional(),
    completed: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) => body.notes !== undefined || body.completed !== undefined,
    'Indica al menos "notes" o "completed"',
  );

/** How a new week is started. */
export const appendWeekBody = z
  .object({
    /** Carry last week's weights across, with the reps left blank. */
    copyWeights: z.boolean().optional(),
  })
  .strict();

/**
 * A video link typed into the app.
 *
 * Only absolute http(s) survives, exactly as in the parser: this string ends
 * up in an `href`, and `javascript:` in a plan is a stored XSS.
 */
const videoUrl = z
  .union([z.string().trim().max(2000), z.null()])
  .transform((value) => (value === null || value === '' ? null : value))
  .refine((value) => {
    if (value === null) return true;
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, 'El enlace del vídeo debe empezar por http:// o https://');

const optionalText = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .transform((value) => (value === null || value.trim() === '' ? null : value.trim()));

/**
 * Every field, not just the ones being changed.
 *
 * The editor holds all of them, and requiring them keeps the UPDATE a fixed
 * statement instead of one assembled from whatever the request contained.
 */
export const exerciseFieldsBody = z
  .object({
    name: z.string().trim().min(1, 'El ejercicio necesita un nombre').max(200),
    protocol: optionalText(500),
    comments: optionalText(500),
    video: videoUrl,
  })
  .strict();

/** A new exercise: same shape, but everything except the name may be omitted. */
export const newExerciseBody = z
  .object({
    name: z.string().trim().min(1, 'El ejercicio necesita un nombre').max(200),
    protocol: optionalText(500).optional(),
    comments: optionalText(500).optional(),
    video: videoUrl.optional(),
  })
  .strict();

export const moveExerciseBody = z
  .object({
    /** One place up (-1) or down (1). Nothing else moves a list predictably. */
    offset: z.union([z.literal(-1), z.literal(1)]),
  })
  .strict();

/** Characters that must never survive into a filename we echo back. */
const FORBIDDEN_FILENAME_CHARS = new Set(['<', '>', '"', "'", '`', '&', '\\', '/', ':', '|', '?', '*']);

/**
 * Reduces an uploaded filename to something safe to store and display.
 *
 * The name is attacker-controlled and ends up in the API response and in the
 * page, so directory separators, control characters and anything that could
 * be read as markup are dropped, and a spreadsheet extension is enforced.
 */
export function sanitizeFileName(raw: string): string {
  const lastSeparator = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  const withoutPath = raw.slice(lastSeparator + 1);

  const cleaned = [...withoutPath]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) return false;
      return !FORBIDDEN_FILENAME_CHARS.has(character);
    })
    .join('')
    .trim()
    .slice(0, 120);

  if (cleaned === '') return 'entrenamiento.xlsx';
  return /\.(xlsx|xlsm)$/i.test(cleaned) ? cleaned : `${cleaned}.xlsx`;
}
