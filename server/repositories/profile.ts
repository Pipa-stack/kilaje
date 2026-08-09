/**
 * The profile: who you are, and what you have lifted since you started.
 *
 * Only two things: what you have lifted, and what to call you. Everything is
 * derived from sets already logged — the profile exists to show the training,
 * not to collect fields nobody looks at twice.
 */

import { loadHistory } from './history';
import type { Database } from '../db/database';

export interface ProfileIdentity {
  email: string;
  /** What to call you. Falls back to the part of the email before the @. */
  displayName: string;
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

export interface Profile {
  identity: ProfileIdentity;
  stats: LifetimeStats;
  /** Best lifts, heaviest estimate first. */
  records: PersonalRecord[];
}

/** How many records to show. Beyond this it stops being a highlight. */
const MAX_RECORDS = 8;

export async function getProfile(db: Database, userId: number): Promise<Profile | null> {
  const { rows } = await db.query<{
    email: string;
    display_name: string | null;
    created_at: Date | string;
  }>('SELECT email, display_name, created_at FROM users WHERE id = $1', [userId]);

  const user = rows[0];
  if (!user) return null;

  const [history, sessions] = await Promise.all([
    loadHistory(db, userId),
    countSessions(db, userId),
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
}

function emptyToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

