/**
 * Execution-side persistence: what the user actually lifted.
 *
 * Nothing here writes to the template tables. Every function verifies that the
 * exercise really belongs to the day being written to, so a forged id in a
 * request body cannot attach a set to somebody else's program.
 */

import type { Database } from '../db/database';
import { requireSessionId } from './programs';

/** Raised when a request refers to rows that do not exist or do not match. */
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
 * Confirms the exercise belongs to the day.
 *
 * The client sends both ids; trusting the pairing would let a caller write a
 * set into an unrelated program by guessing an id.
 */
async function assertExerciseInDay(db: Database, dayId: number, exerciseId: number): Promise<void> {
  const { rows } = await db.query<{ id: number }>(
    'SELECT id FROM exercises WHERE id = $1 AND day_id = $2',
    [exerciseId, dayId],
  );
  if (rows.length === 0) {
    throw new NotFoundError('El ejercicio no pertenece a ese día.');
  }
}

export async function assertDayExists(db: Database, dayId: number): Promise<void> {
  const { rows } = await db.query<{ id: number }>('SELECT id FROM workout_days WHERE id = $1', [
    dayId,
  ]);
  if (rows.length === 0) throw new NotFoundError('El día no existe.');
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
): Promise<void> {
  await assertExerciseInDay(db, dayId, exerciseId);
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
): Promise<void> {
  await assertExerciseInDay(db, dayId, exerciseId);
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
): Promise<void> {
  await assertDayExists(db, dayId);
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
export async function resetSession(db: Database, dayId: number): Promise<void> {
  await assertDayExists(db, dayId);
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
