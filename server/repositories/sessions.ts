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
}

/** Updates session notes and/or the completed flag. */
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

  if (patch.completed !== undefined) {
    await db.query(
      `UPDATE workout_sessions
          SET completed = $2,
              completed_at = CASE WHEN $2 THEN now() ELSE NULL END,
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
    await tx.query(
      `UPDATE workout_sessions
          SET notes = '', completed = FALSE, completed_at = NULL, updated_at = now()
        WHERE id = $1`,
      [sessionId],
    );
  });
}

async function touchSession(db: Database, sessionId: number): Promise<void> {
  await db.query('UPDATE workout_sessions SET updated_at = now() WHERE id = $1', [sessionId]);
}
