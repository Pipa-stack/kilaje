/**
 * The profile: who you are, and what you have lifted since you started.
 *
 * Modelled on what training apps actually put on this screen — personal
 * records, lifetime totals, consistency, body weight — rather than on
 * invented engagement metrics. Everything here is derived from sets the user
 * already logged; nothing new is asked of them.
 */

import { loadHistory } from './history';
import type { Database } from '../db/database';

export type WeightUnit = 'kg' | 'lb';

export interface ProfileIdentity {
  email: string;
  /** What to call you. Falls back to the part of the email before the @. */
  displayName: string;
  gym: string | null;
  weightUnit: WeightUnit;
  memberSince: string;
}

export interface LifetimeStats {
  /** Sessions the user marked completed, across every program. */
  completedSessions: number;
  /** Sessions with at least one set logged, finished or not. */
  startedSessions: number;
  totalVolumeKg: number;
  distinctExercises: number;
  totalSets: number;
  programs: number;
}

export interface PersonalRecord {
  exercise: string;
  /** Best Epley estimate across every set ever logged for it. */
  oneRepMax: number;
  /** Heaviest weight moved for at least one rep. */
  topWeight: number | null;
  achievedAt: string;
}

export interface BodyWeightEntry {
  /** Always kilos. The unit above is a display preference. */
  weightKg: number;
  measuredOn: string;
}

export interface Profile {
  identity: ProfileIdentity;
  stats: LifetimeStats;
  /** Best lifts, heaviest estimate first. */
  records: PersonalRecord[];
  /** Oldest first, so a chart reads left to right. */
  bodyWeights: BodyWeightEntry[];
}

/** How many records to show. Beyond this it stops being a highlight. */
const MAX_RECORDS = 8;

export async function getProfile(db: Database, userId: number): Promise<Profile | null> {
  const { rows } = await db.query<{
    email: string;
    display_name: string | null;
    gym: string | null;
    weight_unit: WeightUnit;
    created_at: Date | string;
  }>(
    'SELECT email, display_name, gym, weight_unit, created_at FROM users WHERE id = $1',
    [userId],
  );

  const user = rows[0];
  if (!user) return null;

  const [history, sessions, bodyWeights] = await Promise.all([
    loadHistory(db, userId),
    countSessions(db, userId),
    listBodyWeights(db, userId),
  ]);

  const records = history
    .filter((exercise): exercise is typeof exercise & { bestOneRepMax: number } =>
      exercise.bestOneRepMax !== null,
    )
    .map((exercise) => {
      const best = exercise.entries.reduce((champion, entry) =>
        (entry.oneRepMax ?? 0) > (champion.oneRepMax ?? 0) ? entry : champion,
      );
      return {
        exercise: exercise.name,
        oneRepMax: exercise.bestOneRepMax,
        topWeight: exercise.bestWeight,
        achievedAt: best.performedAt,
      };
    })
    .sort((a, b) => b.oneRepMax - a.oneRepMax)
    .slice(0, MAX_RECORDS);

  return {
    identity: {
      email: user.email,
      displayName: user.display_name?.trim() || user.email.split('@')[0] || 'Sin nombre',
      gym: user.gym,
      weightUnit: user.weight_unit,
      memberSince: toIso(user.created_at),
    },
    stats: {
      completedSessions: sessions.completed,
      startedSessions: sessions.started,
      totalVolumeKg: history.reduce((total, exercise) => total + exercise.totalVolume, 0),
      distinctExercises: history.length,
      totalSets: history.reduce(
        (total, exercise) =>
          total + exercise.entries.reduce((sets, entry) => sets + countLogged(entry.sets), 0),
        0,
      ),
      programs: sessions.programs,
    },
    records,
    bodyWeights,
  };
}

function countLogged(sets: { weight: number | null; reps: number | null }[]): number {
  return sets.filter((set) => set.weight !== null || set.reps !== null).length;
}

async function countSessions(
  db: Database,
  userId: number,
): Promise<{ completed: number; started: number; programs: number }> {
  const { rows } = await db.query<{ completed: number; started: number; programs: number }>(
    `SELECT
        COUNT(DISTINCT s.id) FILTER (WHERE s.completed)          AS completed,
        COUNT(DISTINCT ss.session_id)                            AS started,
        COUNT(DISTINCT p.id)                                     AS programs
       FROM programs p
       JOIN weeks w                 ON w.program_id = p.id
       JOIN workout_days d          ON d.week_id = w.id
       LEFT JOIN workout_sessions s ON s.day_id = d.id
       LEFT JOIN session_sets ss    ON ss.session_id = s.id
      WHERE p.user_id = $1`,
    [userId],
  );

  return {
    completed: Number(rows[0]?.completed ?? 0),
    started: Number(rows[0]?.started ?? 0),
    programs: Number(rows[0]?.programs ?? 0),
  };
}

export interface ProfilePatch {
  displayName?: string | null;
  gym?: string | null;
  weightUnit?: WeightUnit;
}

export async function updateProfile(
  db: Database,
  userId: number,
  patch: ProfilePatch,
): Promise<void> {
  if (patch.displayName !== undefined) {
    await db.query('UPDATE users SET display_name = $2 WHERE id = $1', [
      userId,
      emptyToNull(patch.displayName),
    ]);
  }
  if (patch.gym !== undefined) {
    await db.query('UPDATE users SET gym = $2 WHERE id = $1', [userId, emptyToNull(patch.gym)]);
  }
  if (patch.weightUnit !== undefined) {
    await db.query('UPDATE users SET weight_unit = $2 WHERE id = $1', [userId, patch.weightUnit]);
  }
}

export async function listBodyWeights(
  db: Database,
  userId: number,
): Promise<BodyWeightEntry[]> {
  const { rows } = await db.query<{ weight_kg: number | string; measured_on: Date | string }>(
    `SELECT weight_kg, measured_on
       FROM body_weights WHERE user_id = $1
      ORDER BY measured_on ASC
      LIMIT 400`,
    [userId],
  );

  return rows.map((row) => ({
    weightKg: typeof row.weight_kg === 'number' ? row.weight_kg : Number.parseFloat(row.weight_kg),
    measuredOn: toDateOnly(row.measured_on),
  }));
}

/**
 * Records a weigh-in.
 *
 * One reading per day: stepping on the scale twice replaces the entry instead
 * of producing a sawtooth that says nothing about a trend.
 */
export async function recordBodyWeight(
  db: Database,
  userId: number,
  weightKg: number,
  measuredOn: string,
): Promise<void> {
  await db.query(
    `INSERT INTO body_weights (user_id, weight_kg, measured_on)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, measured_on) DO UPDATE SET weight_kg = EXCLUDED.weight_kg`,
    [userId, weightKg, measuredOn],
  );
}

export async function deleteBodyWeight(
  db: Database,
  userId: number,
  measuredOn: string,
): Promise<void> {
  await db.query('DELETE FROM body_weights WHERE user_id = $1 AND measured_on = $2', [
    userId,
    measuredOn,
  ]);
}

function emptyToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDateOnly(value: Date | string): string {
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.slice(0, 10);
}
