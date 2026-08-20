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

import {
  emptySets,
  isSetEmpty,
  isSetWorked,
  TEMPLATE_SET_COUNT,
  type SetEntry,
} from '../../src/domain/types';
import { randomUUID } from 'node:crypto';

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
  lineage: string;
  name: string;
  video_url: string | null;
  protocol: string | null;
  comments: string | null;
  planned_set_count: number | null;
}

export interface AppendWeekOptions {
  /**
   * Pre-fill each set with the weight used last week, leaving the reps blank.
   *
   * Adjusting a number beats typing it from scratch, and most weeks repeat
   * most of the load. Only the weight is carried: reps are what turn a set
   * into work, so volume, 1RM and the completion count all stay at zero until
   * the person records what they actually did. Copying those too would have
   * the app claim a session nobody trained.
   */
  copyWeights?: boolean;
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
  { copyWeights = false }: AppendWeekOptions = {},
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

  try {
    await insertClonedWeek(db, programId, source.id, number, copyWeights);
  } catch (error) {
    // Two taps on a slow connection both read the same last week and both try
    // to insert week N. The unique index on (program_id, number) stops the
    // duplicate; without this the loser answered 500 and the user saw a crash
    // where the thing they had asked for did in fact just get created.
    //
    // But only THAT collision is forgivable. Swallowing every 23505 meant any
    // other unique violation inside the clone rolled the transaction back and
    // then reported success, so the button could go on answering 201 for ever
    // while creating nothing. If week N is not there afterwards, the error was
    // not the race and the caller has to hear about it.
    if (!isUniqueViolation(error) || !(await weekExists(db, programId, number))) throw error;
  }

  return getProgram(db, programId, userId);
}

async function weekExists(db: Database, programId: number, number: number): Promise<boolean> {
  const { rows } = await db.query<{ id: number }>(
    'SELECT id FROM weeks WHERE program_id = $1 AND number = $2',
    [programId, number],
  );
  return rows.length > 0;
}

/** PostgreSQL reports a unique index violation as SQLSTATE 23505. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

async function insertClonedWeek(
  db: Database,
  programId: number,
  sourceWeekId: number,
  number: number,
  copyWeights: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows: created } = await tx.query<{ id: number }>(
      'INSERT INTO weeks (program_id, number, sheet_name) VALUES ($1, $2, $3) RETURNING id',
      [programId, number, `Semana ${number}`],
    );
    const weekId = created[0]?.id;
    if (weekId === undefined) throw new Error('No se ha podido crear la semana');

    const { rows: days } = await tx.query<DayRow>(
      'SELECT id, number, type FROM workout_days WHERE week_id = $1 ORDER BY number',
      [sourceWeekId],
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
      const { rows: sessions } = await tx.query<{ id: number }>(
        'INSERT INTO workout_sessions (day_id) VALUES ($1) RETURNING id',
        [dayId],
      );
      const sessionId = sessions[0]?.id;
      if (sessionId === undefined) throw new Error('No se ha podido crear la sesión');

      const { rows: exercises } = await tx.query<ExerciseRow>(
        `SELECT id, position, lineage, name, video_url, protocol, comments, planned_set_count
           FROM exercises WHERE day_id = $1 ORDER BY position`,
        [day.id],
      );

      for (const exercise of exercises) {
        const { rows: copies } = await tx.query<{ id: number }>(
          `INSERT INTO exercises
             (day_id, position, external_key, lineage, name, video_url, protocol, comments,
              planned_set_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            dayId,
            exercise.position,
            // Not derived from the position. Two exercises in a day can share
            // one (the template's "Nº" column is whatever was typed), and the
            // resulting collision on UNIQUE (day_id, external_key) rolled back
            // every future clone of that program. The key's job — matching
            // sets across a re-import — does not apply to a week the app made
            // anyway; `lineage` is what carries identity across weeks now.
            `clone:${randomUUID()}`,
            // Inherited, not regenerated: this is what makes week 9's third
            // exercise the same movement as week 1's for the progress view.
            exercise.lineage,
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

          if (copyWeights && set.weight !== null) {
            await tx.query(
              `INSERT INTO session_sets (session_id, exercise_id, set_index, weight, reps, rir)
               VALUES ($1, $2, $3, $4, NULL, NULL)`,
              [sessionId, copyId, index, set.weight],
            );
          }
        }
      }
    }
  });
}

/** Why a week could not be removed, for the caller to turn into a status. */
export type RemoveWeekOutcome =
  | 'eliminada'
  | 'no existe'
  | 'tiene trabajo anotado'
  | 'es la unica'
  | 'no es la ultima';

/**
 * Deletes a week, but only one nobody has trained.
 *
 * Creating a week is one tap, so mistyping the plan and wanting it gone is
 * ordinary. Losing a session to that same tap is not: anything logged against
 * the week — a set, a note, a completed flag — makes this refuse rather than
 * cascade. Empty the day first if you really mean it.
 *
 * The last remaining week is kept too. A program with no weeks reads back as
 * empty and drops the app onto the import screen, which looks like the whole
 * plan was deleted rather than one week of it.
 */
export async function removeWeek(
  db: Database,
  programId: number,
  weekNumber: number,
  userId: number,
): Promise<{ outcome: RemoveWeekOutcome; program: StoredProgram | null }> {
  const { rows: owned } = await db.query<{ id: number }>(
    'SELECT id FROM programs WHERE id = $1 AND user_id = $2',
    [programId, userId],
  );
  if (owned.length === 0) return { outcome: 'no existe', program: null };

  const { rows: weeks } = await db.query<{ id: number; number: number }>(
    'SELECT id, number FROM weeks WHERE program_id = $1 ORDER BY number',
    [programId],
  );
  const target = weeks.find((week) => week.number === weekNumber);
  const program = await getProgram(db, programId, userId);

  if (!target) return { outcome: 'no existe', program };
  if (weeks.length === 1) return { outcome: 'es la unica', program };

  // Only the newest week. Removing one from the middle leaves a gap that the
  // week numbers cannot express — `appendWeek` counts from MAX(number), so the
  // hole is permanent, and every "vs. la semana anterior" after it compares
  // against a week that is no longer adjacent. The UI already offered only
  // this one; nothing enforced it.
  if (weekNumber !== weeks.at(-1)?.number) return { outcome: 'no es la ultima', program };

  // Checked and deleted in ONE statement. As two, a set arriving from a phone
  // flushing its offline queue between them was cascaded away by a delete that
  // had already decided the week was untouched — the exact loss this guard
  // exists to prevent, reported as success.
  const { rowCount } = await db.query(
    `DELETE FROM weeks
      WHERE id = $1
        AND NOT EXISTS (
          SELECT 1
            FROM workout_days d
            JOIN workout_sessions s ON s.day_id = d.id
            LEFT JOIN session_sets ss
                   ON ss.session_id = s.id
                  AND (ss.reps IS NOT NULL OR ss.rir IS NOT NULL)
           WHERE d.week_id = $1
             AND (ss.id IS NOT NULL OR s.completed OR s.notes <> '')
        )`,
    [target.id],
  );

  if (rowCount === 0) return { outcome: 'tiene trabajo anotado', program };
  return { outcome: 'eliminada', program: await getProgram(db, programId, userId) };
}

/*
 * What counts as "this week was trained", i.e. the NOT EXISTS above: a set with
 * reps or an RIR, a session note, or a day marked completed.
 *
 * A bare weight does not count. It is what `copyWeights` pre-fills, and
 * treating it as training made a week started from last week's loads
 * impossible to delete for ever — the app's own suggestion locking the door
 * behind it. Same rule as everywhere else: reps are what turn a weight into
 * work (see `isSetWorked`).
 *
 * The cost is that a weight typed but not yet completed goes with the week.
 * That is the right side to err on: the alternative refuses to delete weeks
 * nobody trained, which is precisely the case the button exists for.
 */

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
  // Worked, not merely present. A week started with `copyWeights` holds
  // weight-only rows; passing those on as "what you lifted last week" made the
  // app suggest a progression on top of numbers nobody had lifted, and the
  // error compounded with every further week.
  if (logged.some(isSetWorked)) return logged;

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
