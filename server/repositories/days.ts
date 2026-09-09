/**
 * Adding and removing the days of a week.
 *
 * The number of sessions was fixed for the life of a program: it came from the
 * spreadsheet, or from the number you picked when starting a blank plan, and
 * nothing could change it afterwards. Deciding to train four days instead of
 * three meant starting a new plan and leaving the history behind.
 *
 * Like every other plan edit, this touches **one week**. The editor says so
 * ("solo afecta a esta semana") and it is what makes the change safe: the
 * weeks already trained keep the shape they were trained in, and the next
 * week cloned from this one inherits the new one.
 */

import type { Database } from '../db/database';
import { getProgram, type StoredProgram } from './programs';

/**
 * How many sessions a single week may hold.
 *
 * Seven is a week. The cap exists so a stuck client cannot grow one forever,
 * not because anybody should train all seven.
 */
export const MAX_DAYS_PER_WEEK = 7;

export type AddDayOutcome = 'anadido' | 'no existe' | 'semana llena';

export type RemoveDayOutcome =
  | 'eliminado'
  | 'no existe'
  | 'es el unico'
  | 'tiene trabajo anotado';

/** Appends an empty session to the end of a week. */
export async function addDay(
  db: Database,
  programId: number,
  weekNumber: number,
  userId: number,
): Promise<{ outcome: AddDayOutcome; program: StoredProgram | null }> {
  const { rows: weeks } = await db.query<{ id: number }>(
    `SELECT w.id
       FROM weeks w
       JOIN programs p ON p.id = w.program_id
      WHERE w.program_id = $1 AND w.number = $2 AND p.user_id = $3`,
    [programId, weekNumber, userId],
  );

  const week = weeks[0];
  if (!week) return { outcome: 'no existe', program: null };

  const { rows: counts } = await db.query<{ count: number | string; next: number | string }>(
    `SELECT COUNT(*) AS count, COALESCE(MAX(number), 0) + 1 AS next
       FROM workout_days WHERE week_id = $1`,
    [week.id],
  );

  const count = Number(counts[0]?.count ?? 0);
  if (count >= MAX_DAYS_PER_WEEK) {
    return { outcome: 'semana llena', program: await getProgram(db, programId, userId) };
  }

  // Numbered from MAX rather than from the count, so a week that has had a day
  // removed from its middle does not try to reuse a number still in use.
  await db.query('INSERT INTO workout_days (week_id, number, type) VALUES ($1, $2, NULL)', [
    week.id,
    Number(counts[0]?.next ?? 1),
  ]);

  return { outcome: 'anadido', program: await getProgram(db, programId, userId) };
}

/**
 * Removes a session nobody has trained, and closes the gap behind it.
 *
 * Any day, not only the last one — dropping the session you stopped doing is
 * the whole point, and being told to delete the two after it first would make
 * the feature useless. The remaining days are renumbered so "Día 3" never
 * disappears from the middle of a week.
 *
 * Renumbering moves `workout_days.number` only. `lineage`, which is what
 * follows an exercise from week to week and carries its progression, is a
 * stored key that nothing here rewrites.
 */
export async function removeDay(
  db: Database,
  dayId: number,
  userId: number,
): Promise<{ outcome: RemoveDayOutcome; programId: number | null }> {
  const { rows } = await db.query<{ week_id: number; program_id: number; siblings: number | string }>(
    `SELECT d.week_id,
            w.program_id,
            (SELECT COUNT(*) FROM workout_days sib WHERE sib.week_id = d.week_id) AS siblings
       FROM workout_days d
       JOIN weeks w    ON w.id = d.week_id
       JOIN programs p ON p.id = w.program_id
      WHERE d.id = $1 AND p.user_id = $2`,
    [dayId, userId],
  );

  const target = rows[0];
  if (!target) return { outcome: 'no existe', programId: null };
  if (Number(target.siblings) <= 1) {
    return { outcome: 'es el unico', programId: target.program_id };
  }

  const outcome = await db.transaction(async (tx) => {
    // Checked and deleted in ONE statement, for the reason `removeWeek`
    // records: as two, a set arriving from a phone flushing its offline queue
    // in between was cascaded away by a delete that had already decided the
    // day was untouched — the exact loss the guard exists to prevent,
    // reported as success.
    const { rowCount } = await tx.query(
      `DELETE FROM workout_days
        WHERE id = $1
          AND NOT EXISTS (
            SELECT 1
              FROM workout_sessions s
              LEFT JOIN session_sets ss
                     ON ss.session_id = s.id
                    AND (ss.reps IS NOT NULL OR ss.rir IS NOT NULL)
             WHERE s.day_id = $1
               AND (ss.id IS NOT NULL OR s.completed OR s.notes <> '')
          )`,
      [dayId],
    );

    if (rowCount === 0) return 'tiene trabajo anotado' as const;

    // Close the gap. Ascending order matters: each day moves into a number the
    // one before it has already vacated, so `UNIQUE (week_id, number)` is
    // never violated mid-flight.
    const { rows: remaining } = await tx.query<{ id: number }>(
      'SELECT id FROM workout_days WHERE week_id = $1 ORDER BY number',
      [target.week_id],
    );

    for (const [index, day] of remaining.entries()) {
      await tx.query('UPDATE workout_days SET number = $2 WHERE id = $1', [day.id, index + 1]);
    }

    return 'eliminado' as const;
  });

  return { outcome, programId: target.program_id };
}
