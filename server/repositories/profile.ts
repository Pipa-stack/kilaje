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
  /**
   * Whole weeks since this record was set.
   *
   * The number is the point: a best lift nobody has beaten in two months is
   * a stalled lift, and that is worth saying out loud.
   */
  weeksSince: number;
}

export interface WeekActivity {
  /** Monday of that week, as a date. */
  weekStart: string;
  sessions: number;
  volumeKg: number;
}

export interface TypeVolume {
  /** Session type from the spreadsheet: PUSH, PULL, LEG… */
  type: string;
  volumeKg: number;
  sessions: number;
}

export interface Profile {
  identity: ProfileIdentity;
  stats: LifetimeStats;
  /** Best lifts, heaviest estimate first. */
  records: PersonalRecord[];
  /** Exactly {@link ACTIVITY_WEEKS} entries, oldest first, gaps filled with zeroes. */
  weeklyActivity: WeekActivity[];
  /** Consecutive weeks up to now with at least one session. */
  streakWeeks: number;
  /** Volume per session type, biggest first. */
  volumeByType: TypeVolume[];
  lastSessionAt: string | null;
}

/** How many records to show. Beyond this it stops being a highlight. */
const MAX_RECORDS = 8;

/** Three months: long enough to show a habit, short enough to still be now. */
export const ACTIVITY_WEEKS = 12;

export async function getProfile(db: Database, userId: number): Promise<Profile | null> {
  const { rows } = await db.query<{
    email: string;
    display_name: string | null;
    created_at: Date | string;
  }>('SELECT email, display_name, created_at FROM users WHERE id = $1', [userId]);

  const user = rows[0];
  if (!user) return null;

  const [history, sessions, activity, volumeByType, lastSessionAt] = await Promise.all([
    loadHistory(db, userId),
    countSessions(db, userId),
    loadWeeklyActivity(db, userId),
    loadVolumeByType(db, userId),
    loadLastSession(db, userId),
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
        weeksSince: weeksSince(best.performedAt),
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
    weeklyActivity: activity,
    streakWeeks: countStreak(activity),
    volumeByType,
    lastSessionAt,
  };
}

/**
 * Sessions and volume for each of the last {@link ACTIVITY_WEEKS} weeks.
 *
 * Weeks without training are filled in with zeroes rather than dropped: a
 * chart that silently skips the weeks you missed reports a habit you do not
 * have.
 */
async function loadWeeklyActivity(db: Database, userId: number): Promise<WeekActivity[]> {
  // The empty weeks are generated in SQL and joined against, rather than
  // filled in afterwards: date_trunc gives the Monday in the database's time
  // zone, and any Monday computed here in JavaScript would be a different
  // instant on any server that is not UTC — the buckets would never match.
  const { rows } = await db.query<{
    week_start: string;
    sessions: number | string;
    volume: number | string | null;
  }>(
    `WITH span AS (
        SELECT generate_series(
                 date_trunc('week', now()) - make_interval(weeks => $2::int),
                 date_trunc('week', now()),
                 interval '1 week') AS week_start
     ),
     logged AS (
        SELECT date_trunc('week', ss.performed_at) AS week_start,
               COUNT(DISTINCT ss.session_id)       AS sessions,
               SUM(ss.weight * ss.reps)            AS volume
          FROM session_sets ss
          JOIN exercises e    ON e.id = ss.exercise_id
          JOIN workout_days d ON d.id = e.day_id
          JOIN weeks w        ON w.id = d.week_id
          JOIN programs p     ON p.id = w.program_id
         WHERE p.user_id = $1 AND e.name <> ''
         GROUP BY 1
     )
     SELECT to_char(span.week_start, 'YYYY-MM-DD') AS week_start,
            COALESCE(logged.sessions, 0)           AS sessions,
            COALESCE(logged.volume, 0)             AS volume
       FROM span
       LEFT JOIN logged ON logged.week_start = span.week_start
      ORDER BY span.week_start`,
    [userId, ACTIVITY_WEEKS - 1],
  );

  return rows.map((row) => ({
    weekStart: row.week_start,
    sessions: Number(row.sessions),
    volumeKg: numeric(row.volume),
  }));
}

/** Volume split by the session type the spreadsheet named. */
async function loadVolumeByType(db: Database, userId: number): Promise<TypeVolume[]> {
  const { rows } = await db.query<{
    type: string | null;
    volume: number | string | null;
    sessions: number;
  }>(
    `SELECT d.type                        AS type,
            SUM(ss.weight * ss.reps)      AS volume,
            COUNT(DISTINCT ss.session_id) AS sessions
       FROM session_sets ss
       JOIN exercises e    ON e.id = ss.exercise_id
       JOIN workout_days d ON d.id = e.day_id
       JOIN weeks w        ON w.id = d.week_id
       JOIN programs p     ON p.id = w.program_id
      WHERE p.user_id = $1 AND e.name <> ''
      GROUP BY d.type
      ORDER BY 2 DESC NULLS LAST`,
    [userId],
  );

  return rows
    .map((row) => ({
      type: row.type?.trim() || 'Sin tipo',
      volumeKg: numeric(row.volume),
      sessions: Number(row.sessions),
    }))
    .filter((entry) => entry.volumeKg > 0);
}

async function loadLastSession(db: Database, userId: number): Promise<string | null> {
  const { rows } = await db.query<{ last: Date | string | null }>(
    `SELECT MAX(ss.performed_at) AS last
       FROM session_sets ss
       JOIN exercises e    ON e.id = ss.exercise_id
       JOIN workout_days d ON d.id = e.day_id
       JOIN weeks w        ON w.id = d.week_id
       JOIN programs p     ON p.id = w.program_id
      WHERE p.user_id = $1 AND e.name <> ''`,
    [userId],
  );
  const last = rows[0]?.last;
  return last ? toIso(last) : null;
}

/**
 * Consecutive weeks with training, counting back from now.
 *
 * The current week not having a session yet does not break a streak — it is
 * Monday morning, not a failure.
 */
function countStreak(weeks: WeekActivity[]): number {
  let streak = 0;
  for (let index = weeks.length - 1; index >= 0; index -= 1) {
    const week = weeks[index];
    if (!week) break;
    if (week.sessions > 0) streak += 1;
    else if (index === weeks.length - 1) continue;
    else break;
  }
  return streak;
}

function weeksSince(iso: string): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / (7 * 24 * 60 * 60 * 1000)));
}

function numeric(value: number | string | null): number {
  if (value === null) return 0;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

