/**
 * Execution-side persistence: what the user actually lifted.
 *
 * Nothing here writes to the template tables, and **every** function starts
 * by proving that the day belongs to the caller. The client sends ids; ids
 * are guessable; so ownership is re-derived from the database on each write
 * rather than trusted from the request.
 */

import type { Database } from '../db/database';
import { requireSessionId } from './programs';

/** Raised when a request refers to rows that do not exist or are not yours. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface SetValues {
  weight: number | null;
  reps: number | null;
  rir: number | null;
}

/**
 * Confirms the day exists and belongs to `userId`.
 *
 * Walks day → week → program → owner. A day id belonging to somebody else
 * fails here with the same message as a day that does not exist, so the API
 * cannot be used to discover which ids are real.
 */
export async function assertDayExists(
  db: Database,
  dayId: number,
  userId: number,
): Promise<void> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT d.id
       FROM workout_days d
       JOIN weeks w    ON w.id = d.week_id
       JOIN programs p ON p.id = w.program_id
      WHERE d.id = $1 AND p.user_id = $2`,
    [dayId, userId],
  );
  if (rows.length === 0) throw new NotFoundError('El día no existe.');
}

/**
 * Confirms the exercise belongs to the day, and the day to the caller.
 *
 * Both halves matter: without the first, a forged exercise id could attach a
 * set to an unrelated program; without the second, another account's data.
 */
async function assertExerciseInDay(
  db: Database,
  dayId: number,
  exerciseId: number,
  userId: number,
): Promise<void> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT e.id
       FROM exercises e
       JOIN workout_days d ON d.id = e.day_id
       JOIN weeks w        ON w.id = d.week_id
       JOIN programs p     ON p.id = w.program_id
      WHERE e.id = $1 AND e.day_id = $2 AND p.user_id = $3`,
    [exerciseId, dayId, userId],
  );
  if (rows.length === 0) {
    throw new NotFoundError('El ejercicio no pertenece a ese día.');
  }
}

/**
 * Records one set.
 *
 * A set with nothing in it is deleted rather than stored, which keeps the
 * table free of the empty template slots and makes `currentWeek` sparse-safe.
 */
export async function saveSet(
  db: Database,
  dayId: number,
  exerciseId: number,
  setIndex: number,
  values: SetValues,
  userId: number,
): Promise<void> {
  await assertExerciseInDay(db, dayId, exerciseId, userId);
  const sessionId = await requireSessionId(db, dayId);

  const isEmpty = values.weight === null && values.reps === null && values.rir === null;
  if (isEmpty) {
    await db.query(
      'DELETE FROM session_sets WHERE session_id = $1 AND exercise_id = $2 AND set_index = $3',
      [sessionId, exerciseId, setIndex],
    );
    // Clearing a set is a change to the session like any other; returning
    // early left `updated_at` claiming the day had not been touched.
    await touchSession(db, sessionId);
    return;
  }

  await db.query(
    `INSERT INTO session_sets (session_id, exercise_id, set_index, weight, reps, rir)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (session_id, exercise_id, set_index) DO UPDATE
        SET weight = EXCLUDED.weight,
            reps   = EXCLUDED.reps,
            rir    = EXCLUDED.rir,
            updated_at = now()`,
    [sessionId, exerciseId, setIndex, values.weight, values.reps, values.rir],
  );
  await touchSession(db, sessionId);
}

/** Drops a set the user removed, shifting nothing: indexes stay stable. */
export async function deleteSet(
  db: Database,
  dayId: number,
  exerciseId: number,
  setIndex: number,
  userId: number,
): Promise<void> {
  await assertExerciseInDay(db, dayId, exerciseId, userId);
  const sessionId = await requireSessionId(db, dayId);
  await db.query(
    'DELETE FROM session_sets WHERE session_id = $1 AND exercise_id = $2 AND set_index = $3',
    [sessionId, exerciseId, setIndex],
  );
  await touchSession(db, sessionId);
}

export interface SessionPatch {
  notes?: string;
  completed?: boolean;
  elapsedSeconds?: number;
  timerRunning?: boolean;
}

/** Updates session notes, the completed flag and/or the clock. */
export async function updateSession(
  db: Database,
  dayId: number,
  patch: SessionPatch,
  userId: number,
): Promise<void> {
  await assertDayExists(db, dayId, userId);
  const sessionId = await requireSessionId(db, dayId);

  if (patch.notes !== undefined) {
    await db.query('UPDATE workout_sessions SET notes = $2, updated_at = now() WHERE id = $1', [
      sessionId,
      patch.notes,
    ]);
  }

  // The elapsed total is the client's to compute: it is the only party that
  // knows when the buttons were actually pressed, and a value stamped here
  // would count the minutes a queued write spent waiting for signal as
  // training. The range is enforced by the column's CHECK either way.
  if (patch.elapsedSeconds !== undefined) {
    await db.query(
      'UPDATE workout_sessions SET elapsed_seconds = $2, updated_at = now() WHERE id = $1',
      [sessionId, Math.round(patch.elapsedSeconds)],
    );
  }

  if (patch.timerRunning !== undefined) {
    await db.query(
      `UPDATE workout_sessions
          SET timer_started_at = CASE WHEN $2 THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [sessionId, patch.timerRunning],
    );
  }

  if (patch.completed !== undefined) {
    await db.query(
      // `completed_at` records when the day was finished, so it is only
      // stamped on the transition. Re-sending `completed: true` — a replayed
      // queue entry, a double tap — used to overwrite it with the current
      // time and lose the moment the session actually ended.
      `UPDATE workout_sessions
          SET completed = $2,
              completed_at = CASE
                WHEN NOT $2 THEN NULL
                WHEN completed_at IS NULL THEN now()
                ELSE completed_at
              END,
              updated_at = now()
        WHERE id = $1`,
      [sessionId, patch.completed],
    );
  }
}

/** Clears everything the user logged for a day. The template is untouched. */
export async function resetSession(
  db: Database,
  dayId: number,
  userId: number,
): Promise<void> {
  await assertDayExists(db, dayId, userId);
  const sessionId = await requireSessionId(db, dayId);

  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM session_sets WHERE session_id = $1', [sessionId]);
    // The per-exercise notes and the clock are part of what was logged that
    // day, so they go with the sets. The setup notes are not: they describe
    // the movement and live on the template side, untouched.
    await tx.query('DELETE FROM session_exercise_notes WHERE session_id = $1', [sessionId]);
    await tx.query(
      `UPDATE workout_sessions
          SET notes = '', completed = FALSE, completed_at = NULL,
              elapsed_seconds = 0, timer_started_at = NULL, updated_at = now()
        WHERE id = $1`,
      [sessionId],
    );
  });
}

/**
 * Writes this session's note for one exercise. Empty deletes the row.
 *
 * A note nobody wrote and a note somebody deleted are the same thing, and
 * keeping empty strings around would make every "has a note" check lie.
 */
export async function saveExerciseNote(
  db: Database,
  dayId: number,
  exerciseId: number,
  note: string,
  userId: number,
): Promise<void> {
  await assertExerciseInDay(db, dayId, exerciseId, userId);
  const sessionId = await requireSessionId(db, dayId);

  if (note.trim() === '') {
    await db.query(
      'DELETE FROM session_exercise_notes WHERE session_id = $1 AND exercise_id = $2',
      [sessionId, exerciseId],
    );
  } else {
    await db.query(
      `INSERT INTO session_exercise_notes (session_id, exercise_id, note)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, exercise_id) DO UPDATE
          SET note = EXCLUDED.note, updated_at = now()`,
      [sessionId, exerciseId, note],
    );
  }

  await touchSession(db, sessionId);
}

/**
 * Writes the permanent setup note for a movement.
 *
 * Keyed by the exercise's lineage within its program, so it reaches every week
 * at once — which is what makes it permanent rather than a note that happens
 * to sit on the week you were looking at. Ownership is re-derived from the
 * exercise id, as everywhere else here.
 */
export async function saveExerciseSetup(
  db: Database,
  exerciseId: number,
  note: string,
  userId: number,
): Promise<boolean> {
  const { rows } = await db.query<{ program_id: number; lineage: string }>(
    `SELECT w.program_id, e.lineage
       FROM exercises e
       JOIN workout_days d ON d.id = e.day_id
       JOIN weeks w        ON w.id = d.week_id
       JOIN programs p     ON p.id = w.program_id
      WHERE e.id = $1 AND p.user_id = $2`,
    [exerciseId, userId],
  );

  const target = rows[0];
  if (!target) return false;

  if (note.trim() === '') {
    await db.query('DELETE FROM exercise_setups WHERE program_id = $1 AND lineage = $2', [
      target.program_id,
      target.lineage,
    ]);
    return true;
  }

  await db.query(
    `INSERT INTO exercise_setups (program_id, lineage, note)
     VALUES ($1, $2, $3)
     ON CONFLICT (program_id, lineage) DO UPDATE
        SET note = EXCLUDED.note, updated_at = now()`,
    [target.program_id, target.lineage, note],
  );
  return true;
}

async function touchSession(db: Database, sessionId: number): Promise<void> {
  await db.query('UPDATE workout_sessions SET updated_at = now() WHERE id = $1', [sessionId]);
}
