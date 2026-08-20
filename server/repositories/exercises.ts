/**
 * Editing the plan itself, not just what was lifted against it.
 *
 * Until now the plan was whatever the spreadsheet said, frozen at import: you
 * could log sets but not swap a machine that was taken, drop an exercise your
 * shoulder disagreed with, or add the one you actually did instead. That was
 * defensible while a program was a photograph of one week of Excel. Once weeks
 * are created inside the app, the plan is a living thing and has to be
 * editable where it is used.
 *
 * Everything here is scoped by owner: an exercise is reachable only through
 * the chain day → week → program → user, and every function checks it. An id
 * from the client is a claim, not a permission.
 */

import { randomUUID } from 'node:crypto';

import { parseProtocolSetCount } from '../../src/domain/calculations';
import type { Database } from '../db/database';
import { getProgram, type StoredProgram } from './programs';

/** Guards against one day growing without bound. */
export const MAX_EXERCISES_PER_DAY = 30;

/** Raised when an edit is refused for a reason the user can act on. */
export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanLimitError';
  }
}

/**
 * The fields of an exercise a person can change from the app.
 *
 * Every field is required rather than optional. A partial patch would need the
 * UPDATE to be assembled from whatever arrived, and building SQL out of
 * request-shaped data is the habit this codebase does not have (see the
 * architecture test). The editor holds all four values anyway, so sending
 * them all costs nothing and keeps the statement fixed.
 */
export interface ExerciseFields {
  name: string;
  protocol: string | null;
  comments: string | null;
  video: string | null;
}

interface Location {
  exerciseId: number;
  dayId: number;
  programId: number;
  position: number;
}

/**
 * Resolves an exercise to its program, proving ownership on the way.
 *
 * @returns `null` when the exercise does not exist or belongs to somebody else
 * — deliberately the same answer, so ids cannot be probed for existence.
 */
async function locateExercise(
  db: Database,
  exerciseId: number,
  userId: number,
): Promise<Location | null> {
  const { rows } = await db.query<{
    id: number;
    day_id: number;
    program_id: number;
    position: number;
  }>(
    `SELECT e.id, e.day_id, w.program_id, e.position
       FROM exercises e
       JOIN workout_days d ON d.id = e.day_id
       JOIN weeks w        ON w.id = d.week_id
       JOIN programs p     ON p.id = w.program_id
      WHERE e.id = $1 AND p.user_id = $2`,
    [exerciseId, userId],
  );

  const row = rows[0];
  return row
    ? { exerciseId: row.id, dayId: row.day_id, programId: row.program_id, position: row.position }
    : null;
}

/** Same, for a day. */
async function locateDay(
  db: Database,
  dayId: number,
  userId: number,
): Promise<{ dayId: number; programId: number } | null> {
  const { rows } = await db.query<{ id: number; program_id: number }>(
    `SELECT d.id, w.program_id
       FROM workout_days d
       JOIN weeks w    ON w.id = d.week_id
       JOIN programs p ON p.id = w.program_id
      WHERE d.id = $1 AND p.user_id = $2`,
    [dayId, userId],
  );

  const row = rows[0];
  return row ? { dayId: row.id, programId: row.program_id } : null;
}

/**
 * Appends an exercise to a day.
 *
 * @returns the updated program, or `null` when the day is not the user's.
 * @throws {PlanLimitError} when the day is already full.
 */
export async function addExercise(
  db: Database,
  dayId: number,
  userId: number,
  input: { name: string; protocol?: string | null; comments?: string | null; video?: string | null },
): Promise<StoredProgram | null> {
  const location = await locateDay(db, dayId, userId);
  if (!location) return null;

  const { rows: existing } = await db.query<{ total: number; last: number | null }>(
    'SELECT COUNT(*)::int AS total, MAX(position) AS last FROM exercises WHERE day_id = $1',
    [dayId],
  );
  const total = existing[0]?.total ?? 0;
  if (total >= MAX_EXERCISES_PER_DAY) {
    throw new PlanLimitError(
      `Un día no puede tener más de ${MAX_EXERCISES_PER_DAY} ejercicios.`,
    );
  }

  await db.query(
    `INSERT INTO exercises
       (day_id, position, external_key, name, video_url, protocol, comments, planned_set_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      dayId,
      (existing[0]?.last ?? 0) + 1,
      // Not `w1:d1:eN`: that shape is the parser's, and reusing it would let a
      // hand-added exercise collide with an imported one on a later re-import.
      `manual:${randomUUID()}`,
      input.name,
      input.video ?? null,
      input.protocol ?? null,
      input.comments ?? null,
      parseProtocolSetCount(input.protocol ?? null),
    ],
  );

  return getProgram(db, location.programId, userId);
}

/**
 * Changes an exercise's text fields.
 *
 * Returns nothing but whether it happened: the client already holds the new
 * values, and sending the whole program back on every keystroke of a rename
 * would be absurd. Structural edits below do return it, because they move ids
 * and positions the client cannot predict.
 */
export async function updateExercise(
  db: Database,
  exerciseId: number,
  userId: number,
  fields: ExerciseFields,
): Promise<boolean> {
  const location = await locateExercise(db, exerciseId, userId);
  if (!location) return false;

  await db.query(
    `UPDATE exercises
        SET name = $2, protocol = $3, comments = $4, video_url = $5, planned_set_count = $6
      WHERE id = $1`,
    [
      exerciseId,
      fields.name,
      fields.protocol,
      fields.comments,
      fields.video,
      parseProtocolSetCount(fields.protocol),
    ],
  );
  return true;
}

/**
 * Deletes an exercise and everything logged against it.
 *
 * The sets cascade, which is the point — an exercise you did not do should
 * not leave its volume in the week's totals — but it also means this throws
 * away real training data, so the UI asks first.
 */
export async function removeExercise(
  db: Database,
  exerciseId: number,
  userId: number,
): Promise<StoredProgram | null> {
  const location = await locateExercise(db, exerciseId, userId);
  if (!location) return null;

  await db.query('DELETE FROM exercises WHERE id = $1', [exerciseId]);
  return getProgram(db, location.programId, userId);
}

/**
 * Moves an exercise one place up or down within its day.
 *
 * Positions are swapped with the neighbour rather than renumbered, so the
 * numbers printed on the cards stay the ones the template gave them.
 */
export async function moveExercise(
  db: Database,
  exerciseId: number,
  userId: number,
  offset: -1 | 1,
): Promise<StoredProgram | null> {
  const location = await locateExercise(db, exerciseId, userId);
  if (!location) return null;

  const { rows: neighbours } = await db.query<{ id: number; position: number }>(
    offset < 0
      ? `SELECT id, position FROM exercises
          WHERE day_id = $1 AND position < $2 ORDER BY position DESC LIMIT 1`
      : `SELECT id, position FROM exercises
          WHERE day_id = $1 AND position > $2 ORDER BY position ASC LIMIT 1`,
    [location.dayId, location.position],
  );

  const neighbour = neighbours[0];
  // Already at the end: not an error, just nothing to do.
  if (neighbour) {
    await db.transaction(async (tx) => {
      await tx.query('UPDATE exercises SET position = $2 WHERE id = $1', [
        exerciseId,
        neighbour.position,
      ]);
      await tx.query('UPDATE exercises SET position = $2 WHERE id = $1', [
        neighbour.id,
        location.position,
      ]);
    });
  }

  return getProgram(db, location.programId, userId);
}
