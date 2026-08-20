/**
 * Continuing a plan past the weeks the workbook shipped with.
 *
 * The Excel template is a starting point, not the whole mesocycle: most files
 * carry one or two weeks, and after that there was nowhere left to log — the
 * only way forward was to edit the spreadsheet and upload it again, which is
 * exactly what this app exists to avoid.
 *
 * Appending a week copies the *plan* (days, exercises, protocols, videos) and
 * leaves the *execution* empty, so the person starts the week with the same
 * session in front of them and their own weights still to enter. What they
 * lifted in the week being copied becomes the new week's reference column —
 * the "Semana anterior" the template would have made them paste by hand.
 */

import { emptySets, isSetEmpty, TEMPLATE_SET_COUNT, type SetEntry } from '../../src/domain/types';
import type { Database } from '../db/database';
import { getProgram, type StoredProgram } from './programs';

/**
 * How many weeks a single program may hold.
 *
 * A year of training is already far past any mesocycle; the cap is only here
 * so a stuck client cannot grow one program without bound.
 */
export const MAX_WEEKS = 52;

/** Raised when appending a week is refused for a reason the user can act on. */
export class WeekLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeekLimitError';
  }
}

interface WeekRow {
  id: number;
  number: number;
}

interface DayRow {
  id: number;
  number: number;
  type: string | null;
}

interface ExerciseRow {
  id: number;
  position: number;
  name: string;
  video_url: string | null;
  protocol: string | null;
  comments: string | null;
  planned_set_count: number | null;
}

/**
 * Adds one more week to a program, cloned from its last one.
 *
 * @returns the whole updated program, or `null` when it does not exist or does
 * not belong to `userId`.
 * @throws {WeekLimitError} when the program has no week to copy, or already
 * has {@link MAX_WEEKS}.
 */
export async function appendWeek(
  db: Database,
  programId: number,
  userId: number,
): Promise<StoredProgram | null> {
  // Checked on `rows`, not `rowCount`: PGlite reports 0 affected rows for a
  // SELECT, which would make every request look like a missing program.
  const { rows: owned } = await db.query<{ id: number }>(
    'SELECT id FROM programs WHERE id = $1 AND user_id = $2',
    [programId, userId],
  );
  if (owned.length === 0) return null;

  const { rows: weekRows } = await db.query<WeekRow>(
    'SELECT id, number FROM weeks WHERE program_id = $1 ORDER BY number DESC LIMIT 1',
    [programId],
  );
  const source = weekRows[0];
  if (!source) {
    throw new WeekLimitError('Este programa no tiene ninguna semana que copiar.');
  }

  const { rows: countRows } = await db.query<{ total: number }>(
    'SELECT COUNT(*)::int AS total FROM weeks WHERE program_id = $1',
    [programId],
  );
  if ((countRows[0]?.total ?? 0) >= MAX_WEEKS) {
    throw new WeekLimitError(
      `Un programa no puede tener más de ${MAX_WEEKS} semanas. Importa uno nuevo para seguir.`,
    );
  }

  const number = source.number + 1;

  await db.transaction(async (tx) => {
    const { rows: created } = await tx.query<{ id: number }>(
      'INSERT INTO weeks (program_id, number, sheet_name) VALUES ($1, $2, $3) RETURNING id',
      [programId, number, `Semana ${number}`],
    );
    const weekId = created[0]?.id;
    if (weekId === undefined) throw new Error('No se ha podido crear la semana');

    const { rows: days } = await tx.query<DayRow>(
      'SELECT id, number, type FROM workout_days WHERE week_id = $1 ORDER BY number',
      [source.id],
    );

    for (const day of days) {
      const { rows: inserted } = await tx.query<{ id: number }>(
        'INSERT INTO workout_days (week_id, number, type) VALUES ($1, $2, $3) RETURNING id',
        [weekId, day.number, day.type],
      );
      const dayId = inserted[0]?.id;
      if (dayId === undefined) throw new Error('No se ha podido crear el día');

      // A day with no session row reads back as "not started", but the import
      // path creates one for every day and the reader joins on it; keeping the
      // shapes identical means a cloned week behaves like an imported one.
      await tx.query('INSERT INTO workout_sessions (day_id) VALUES ($1)', [dayId]);

      const { rows: exercises } = await tx.query<ExerciseRow>(
        `SELECT id, position, name, video_url, protocol, comments, planned_set_count
           FROM exercises WHERE day_id = $1 ORDER BY position`,
        [day.id],
      );

      for (const exercise of exercises) {
        const { rows: copies } = await tx.query<{ id: number }>(
          `INSERT INTO exercises
             (day_id, position, external_key, name, video_url, protocol, comments, planned_set_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            dayId,
            exercise.position,
            `w${number}:d${day.number}:e${exercise.position}`,
            exercise.name,
            exercise.video_url,
            exercise.protocol,
            exercise.comments,
            exercise.planned_set_count,
          ],
        );
        const copyId = copies[0]?.id;
        if (copyId === undefined) throw new Error('No se ha podido copiar el ejercicio');

        const reference = await readReference(tx, exercise.id);
        for (const [index, set] of reference.entries()) {
          if (isSetEmpty(set)) continue;
          await tx.query(
            `INSERT INTO reference_sets (exercise_id, set_index, weight, reps, rir)
             VALUES ($1, $2, $3, $4, $5)`,
            [copyId, index, set.weight, set.reps, set.rir],
          );
        }
      }
    }
  });

  return getProgram(db, programId, userId);
}

/**
 * What the new week should show as "semana anterior" for one exercise.
 *
 * What was actually lifted wins. When the week being copied was never trained
 * — someone adding two weeks ahead of themselves — its own reference column is
 * passed along instead, so the last real numbers keep travelling forward
 * rather than the card going blank.
 */
async function readReference(tx: Database, exerciseId: number): Promise<SetEntry[]> {
  const logged = await readSets(
    tx,
    `SELECT set_index, weight, reps, rir FROM session_sets
      WHERE exercise_id = $1 ORDER BY set_index`,
    exerciseId,
  );
  if (logged.some((set) => !isSetEmpty(set))) return logged;

  return readSets(
    tx,
    `SELECT set_index, weight, reps, rir FROM reference_sets
      WHERE exercise_id = $1 ORDER BY set_index`,
    exerciseId,
  );
}

async function readSets(tx: Database, sql: string, exerciseId: number): Promise<SetEntry[]> {
  const { rows } = await tx.query<{
    set_index: number;
    weight: number | string | null;
    reps: number | null;
    rir: number | null;
  }>(sql, [exerciseId]);

  const sets: SetEntry[] = emptySets(TEMPLATE_SET_COUNT);
  for (const row of rows) {
    while (sets.length <= row.set_index) sets.push({ weight: null, reps: null, rir: null });
    sets[row.set_index] = {
      weight: numeric(row.weight),
      reps: row.reps,
      rir: row.rir,
    };
  }
  return sets;
}

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
