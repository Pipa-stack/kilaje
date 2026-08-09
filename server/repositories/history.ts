/**
 * Training history across programs.
 *
 * A program is one import of one spreadsheet, so "my bench press over the
 * last months" spans several of them. Exercises are matched by name, which is
 * the only thing that survives a re-import: ids are per-program and the
 * template's own `w1:d1:e1` keys repeat in every file.
 *
 * Rows are fetched once and grouped in TypeScript rather than aggregated in
 * SQL, so the 1RM and volume figures come from the same tested functions the
 * rest of the app uses. A personal log is a few thousand rows at most; the
 * query is capped so a pathological account cannot pull the server over.
 */

import { epley1RM, exerciseVolume } from '../../src/domain/calculations';
import type { SetEntry } from '../../src/domain/types';
import type { Database } from '../db/database';

/** Guard rail. Well beyond a realistic training log. */
const MAX_ROWS = 20_000;

export interface HistoryEntry {
  programId: number;
  programName: string;
  weekNumber: number;
  dayNumber: number;
  dayType: string | null;
  performedAt: string;
  sets: SetEntry[];
  volume: number;
  /** Heaviest weight moved for at least one rep. */
  topWeight: number | null;
  /**
   * Best Epley estimate across **all** the sets of that session.
   *
   * The exercise card shows the estimate from set 1, because that is what the
   * spreadsheet does. History asks a different question — "what is the best
   * you have estimated?" — and a heavy single on the third set is exactly the
   * answer, so here every set is considered.
   */
  oneRepMax: number | null;
}

export interface ExerciseHistory {
  name: string;
  /** Distinct sessions this exercise was trained in. */
  sessions: number;
  /** Distinct programs it appears in. */
  programs: number;
  totalVolume: number;
  bestOneRepMax: number | null;
  bestWeight: number | null;
  firstTrainedAt: string | null;
  lastTrainedAt: string | null;
  /** Oldest first, so a chart reads left to right. */
  entries: HistoryEntry[];
}

interface Row {
  exercise_name: string;
  exercise_id: number;
  program_id: number;
  program_name: string;
  week_number: number;
  day_number: number;
  day_type: string | null;
  set_index: number;
  weight: number | string | null;
  reps: number | null;
  rir: number | null;
  performed_at: Date | string;
}

/**
 * Everything the signed-in user has ever logged, grouped by exercise name.
 *
 * Ordered by name then time so the grouping below is a single pass.
 */
export async function loadHistory(db: Database, userId: number): Promise<ExerciseHistory[]> {
  const { rows } = await db.query<Row>(
    `SELECT e.name  AS exercise_name,
            e.id    AS exercise_id,
            p.id    AS program_id,
            p.name  AS program_name,
            w.number AS week_number,
            d.number AS day_number,
            d.type   AS day_type,
            ss.set_index, ss.weight, ss.reps, ss.rir, ss.performed_at
       FROM session_sets ss
       JOIN exercises e         ON e.id = ss.exercise_id
       JOIN workout_days d      ON d.id = e.day_id
       JOIN weeks w             ON w.id = d.week_id
       JOIN programs p          ON p.id = w.program_id
      WHERE p.user_id = $1 AND e.name <> ''
      ORDER BY e.name, ss.performed_at, e.id, ss.set_index
      LIMIT $2`,
    [userId, MAX_ROWS],
  );

  return groupByExercise(rows);
}

function groupByExercise(rows: Row[]): ExerciseHistory[] {
  /** name -> exercise instance -> its sets. */
  const byName = new Map<string, Map<number, HistoryEntry>>();

  for (const row of rows) {
    const instances = byName.get(row.exercise_name) ?? new Map<number, HistoryEntry>();
    byName.set(row.exercise_name, instances);

    const entry =
      instances.get(row.exercise_id) ??
      ({
        programId: row.program_id,
        programName: row.program_name,
        weekNumber: row.week_number,
        dayNumber: row.day_number,
        dayType: row.day_type,
        performedAt: toIso(row.performed_at),
        sets: [],
        volume: 0,
        topWeight: null,
        oneRepMax: null,
      } satisfies HistoryEntry);
    instances.set(row.exercise_id, entry);

    // Sets are sparse: only the ones with data are stored.
    while (entry.sets.length <= row.set_index) {
      entry.sets.push({ weight: null, reps: null, rir: null });
    }
    entry.sets[row.set_index] = {
      weight: numeric(row.weight),
      reps: row.reps,
      rir: row.rir,
    };
  }

  const history: ExerciseHistory[] = [];

  for (const [name, instances] of byName) {
    const entries = [...instances.values()]
      .map((entry) => {
        const weights = entry.sets
          .filter((set) => set.weight !== null && (set.reps ?? 0) > 0)
          .map((set) => set.weight as number);

        const estimates = entry.sets
          .map((set) => epley1RM(set))
          .filter((value): value is number => value !== null);

        return {
          ...entry,
          volume: exerciseVolume(entry.sets),
          topWeight: weights.length > 0 ? Math.max(...weights) : null,
          oneRepMax: estimates.length > 0 ? Math.max(...estimates) : null,
        };
      })
      .sort((a, b) => Date.parse(a.performedAt) - Date.parse(b.performedAt));

    const oneRepMaxes = entries
      .map((entry) => entry.oneRepMax)
      .filter((value): value is number => value !== null);
    const topWeights = entries
      .map((entry) => entry.topWeight)
      .filter((value): value is number => value !== null);

    history.push({
      name,
      sessions: entries.length,
      programs: new Set(entries.map((entry) => entry.programId)).size,
      totalVolume: entries.reduce((sum, entry) => sum + entry.volume, 0),
      bestOneRepMax: oneRepMaxes.length > 0 ? Math.max(...oneRepMaxes) : null,
      bestWeight: topWeights.length > 0 ? Math.max(...topWeights) : null,
      firstTrainedAt: entries[0]?.performedAt ?? null,
      lastTrainedAt: entries.at(-1)?.performedAt ?? null,
      entries,
    });
  }

  // Most trained first: that is what somebody looking for progress wants.
  return history.sort((a, b) => b.sessions - a.sessions || b.totalVolume - a.totalVolume);
}

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
