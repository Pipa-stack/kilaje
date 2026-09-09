/**
 * The profile: who you are, and what you have lifted since you started.
 *
 * Only two things: what you have lifted, and what to call you. Everything is
 * derived from sets already logged — the profile exists to show the training,
 * not to collect fields nobody looks at twice.
 */

import { loadHistory, type ExerciseHistory, type HistoryEntry } from './history';
import { topWeights, type BestSet } from '../../src/domain/calculations';
import type { Database } from '../db/database';

export interface ProfileIdentity {
  email: string;
  /** What to call you. Falls back to the part of the email before the @. */
  displayName: string;
  memberSince: string;
}

/** One movement, everything you have ever done on it. */
export interface Lift {
  exercise: string;
  /** The heaviest set ever logged for it. */
  best: BestSet;
  /**
   * Weight of the last session's best set minus the first session's.
   *
   * First against last, not against the all-time peak: this answers "where is
   * this exercise going", so it can be negative, and that is the point. `null`
   * with a single session — one session is not a trend.
   */
  gainKg: number | null;
  sessions: number;
  lastTrainedAt: string;
  /** Whole weeks since the best set was performed. */
  weeksSince: number;
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
  /**
   * Mean length of the completed sessions that have one, in seconds.
   *
   * `null` until a session has been timed: an average over no data is not
   * zero minutes of training, it is no answer.
   */
  averageSessionSeconds: number | null;
}

export interface PersonalRecord {
  exercise: string;
  /** The heaviest set ever logged for it. */
  best: BestSet;
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
  /** Best lifts, heaviest first. */
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

  const [history, sessions, totals, activity, volumeByType, lastSessionAt, duration] =
    await Promise.all([
      loadHistory(db, userId),
      countSessions(db, userId),
      loadTotals(db, userId),
      loadWeeklyActivity(db, userId),
      loadVolumeByType(db, userId),
      loadLastSession(db, userId),
      loadAverageDuration(db, userId),
    ]);

  const records = history
    .filter(hasBest)
    .map((exercise) => {
      const achievedAt = sessionOfBest(exercise).performedAt;
      return {
        exercise: exercise.name,
        best: exercise.best,
        achievedAt,
        weeksSince: weeksSince(achievedAt),
      };
    })
    .sort((a, b) => b.best.weight - a.best.weight)
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
      totalVolumeKg: totals.volumeKg,
      distinctExercises: totals.exercises,
      totalSets: totals.sets,
      programs: sessions.programs,
      averageSessionSeconds: duration,
    },
    records,
    weeklyActivity: activity,
    streakWeeks: countStreak(activity),
    volumeByType,
    lastSessionAt,
  };
}

/**
 * The lifetime figures, counted by the database.
 *
 * Derived from {@link loadHistory} before, which reads at most 20 000 rows and
 * says nothing when it stops. Past that the totals labelled "en total" would
 * quietly start shrinking — the one place where being approximately right is
 * worse than not showing a number. Pure aggregation, so nothing about the
 * domain is restated here; the best set still comes from the one
 * implementation in `calculations.ts`.
 */
async function loadTotals(
  db: Database,
  userId: number,
): Promise<{ volumeKg: number; exercises: number; sets: number }> {
  const { rows } = await db.query<{
    volume: number | string | null;
    exercises: number | string;
    sets: number | string;
  }>(
    `SELECT COALESCE(SUM(ss.weight * ss.reps), 0) AS volume,
            COUNT(DISTINCT e.name)                AS exercises,
            COUNT(*)                              AS sets
       FROM session_sets ss
       JOIN exercises e    ON e.id = ss.exercise_id
       JOIN workout_days d ON d.id = e.day_id
       JOIN weeks w        ON w.id = d.week_id
       JOIN programs p     ON p.id = w.program_id
      WHERE p.user_id = $1 AND e.name <> ''`,
    [userId],
  );

  return {
    volumeKg: numeric(rows[0]?.volume ?? 0),
    exercises: Number(rows[0]?.exercises ?? 0),
    sets: Number(rows[0]?.sets ?? 0),
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

  // A day of pull-ups and dips logs reps with no weight, so its volume in kg
  // is zero — but it happened, and dropping the row erased the sessions along
  // with it. The bar chart skips zero-volume entries; the count does not.
  return rows.map((row) => ({
    type: row.type?.trim() || 'Sin tipo',
    volumeKg: numeric(row.volume),
    sessions: Number(row.sessions),
  }));
}

/**
 * Every movement you have trained, for the rankings screen.
 *
 * Grouped by name rather than by lineage: a lineage identifies a movement
 * inside one program, and this question spans all of them.
 */
export async function listLifts(db: Database, userId: number): Promise<Lift[]> {
  const history = await loadHistory(db, userId);

  return history.filter(hasBest).map((exercise) => {
    const weights = topWeights(exercise.entries);
    const first = weights[0];
    const last = weights.at(-1);
    const achievedAt = sessionOfBest(exercise).performedAt;

    return {
      exercise: exercise.name,
      best: exercise.best,
      gainKg:
        first !== undefined && last !== undefined && weights.length > 1
          ? Math.round((last - first) * 100) / 100
          : null,
      sessions: exercise.sessions,
      lastTrainedAt: exercise.lastTrainedAt ?? achievedAt,
      weeksSince: weeksSince(achievedAt),
    };
  });
}

/** An exercise with at least one set worth ranking. */
function hasBest(exercise: ExerciseHistory): exercise is ExerciseHistory & { best: BestSet } {
  return exercise.best !== null;
}

/**
 * The session that produced the exercise's best set.
 *
 * So the date reported is the day the weight was actually lifted, rather than
 * the last time the movement happened to be trained. Safe to call without an
 * initial value only because {@link hasBest} has already established that one
 * of these sessions has a best set.
 */
function sessionOfBest(exercise: ExerciseHistory): HistoryEntry {
  return exercise.entries.reduce((champion, entry) =>
    (entry.best?.weight ?? -1) > (champion.best?.weight ?? -1) ? entry : champion,
  );
}

/**
 * Mean duration of the sessions that were actually timed.
 *
 * Sessions with a zero clock are left out rather than counted as instant: the
 * timer is a button somebody has to press, and the ones they forgot would
 * drag the average towards a number nobody trained.
 */
async function loadAverageDuration(db: Database, userId: number): Promise<number | null> {
  const { rows } = await db.query<{ average: number | string | null }>(
    `SELECT AVG(s.elapsed_seconds) AS average
       FROM workout_sessions s
       JOIN workout_days d ON d.id = s.day_id
       JOIN weeks w        ON w.id = d.week_id
       JOIN programs p     ON p.id = w.program_id
      WHERE p.user_id = $1 AND s.completed AND s.elapsed_seconds > 0`,
    [userId],
  );

  const average = rows[0]?.average;
  if (average === null || average === undefined) return null;
  const parsed = typeof average === 'number' ? average : Number.parseFloat(average);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
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

