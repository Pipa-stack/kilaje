/**
 * Every number the app shows is produced here.
 *
 * These functions reproduce the formulas found in the source spreadsheet
 * (see SPEC.md §2). They are pure and independently testable on purpose: the
 * spreadsheet is the specification, and a regression here is a wrong training
 * decision for the user.
 */

import { isSetWorked, type Day, type Exercise, type SetEntry, type Week } from './types';

/**
 * Excel's ROUND, which rounds half **away from zero**.
 *
 * `Math.round` rounds half **up**, so it disagrees with Excel on negatives
 * (`Math.round(-2.5) === -2`, `ROUND(-2.5,0) === -3`). Scaling by a power of
 * ten also has to survive binary floating point, hence the epsilon nudge —
 * without it `excelRound(1.005, 2)` would give 1 instead of Excel's 1.01.
 */
export function excelRound(value: number, digits = 0): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  const scaled = value * factor;
  const nudged = scaled + Math.sign(scaled) * Number.EPSILON * Math.abs(scaled);
  return (Math.sign(nudged) * Math.round(Math.abs(nudged))) / factor;
}

/** Rounds to the nearest 2.5 kg plate increment, the way the template does. */
export function roundToPlate(weight: number, increment = 2.5): number {
  return excelRound(weight / increment, 0) * increment;
}

/** The heaviest set actually performed, and what it was. */
export interface BestSet {
  weight: number;
  /** May be absent: a set logged with an RIR and no reps is still work. */
  reps: number | null;
  /** Position within the exercise, 0-based. */
  setIndex: number;
}

/**
 * The best set of the lot — the one number the app calls "your best".
 *
 * There used to be an estimated 1RM here (Epley, over set 1, as the
 * spreadsheet does). It is gone. An estimate is a weight nobody has lifted,
 * and it sat where the real one belongs: the ranking, the record notice and
 * the exercise card all have to agree on what "best" means, and the only
 * answer that survives being checked against a training log is the set that
 * actually happened.
 *
 * Weight decides it, because that is what "my best press" means to the person
 * asking. Reps only break a tie, so 100×8 beats 100×5 and 100×1 beats 95×12 —
 * the second is arguable, the alternative was arithmetic nobody performed.
 *
 * Only sets that count as work are eligible, so a week pre-filled with last
 * week's loads is not a set of records waiting to be claimed.
 */
export function bestSet(sets: readonly SetEntry[]): BestSet | null {
  let best: BestSet | null = null;

  sets.forEach((set, setIndex) => {
    if (set.weight === null || !isSetWorked(set)) return;
    const candidate: BestSet = { weight: set.weight, reps: set.reps, setIndex };
    if (!best || isBetterSet(candidate, best)) best = candidate;
  });

  return best;
}

/**
 * Strictly better: heavier, or the same weight for more reps.
 *
 * Exported because the comparison must be identical everywhere — the card,
 * the record notice, the ranking and the profile all rank the same sets, and
 * three private copies of this rule is three chances for them to disagree.
 */
export function isBetterSet(candidate: BestSet, incumbent: BestSet): boolean {
  if (candidate.weight !== incumbent.weight) return candidate.weight > incumbent.weight;
  return (candidate.reps ?? 0) > (incumbent.reps ?? 0);
}

/** This week's best set for the exercise. */
export function exerciseBestSet(exercise: Exercise): BestSet | null {
  return bestSet(exercise.currentWeek);
}

/** `"100 kg × 5"`, or `"100 kg"` when the reps were never written down. */
export function formatBestSet(best: BestSet | null): string {
  if (!best) return '—';
  const weight = `${formatNumber(best.weight)} kg`;
  return best.reps === null ? weight : `${weight} × ${best.reps}`;
}

/** Σ weight × reps across the given sets. Missing values count as zero. */
export function exerciseVolume(sets: readonly SetEntry[]): number {
  return sets.reduce((total, set) => total + (set.weight ?? 0) * (set.reps ?? 0), 0);
}

/** Σ volume of every exercise in the day. */
export function dayVolume(day: Day): number {
  return day.exercises.reduce((total, ex) => total + exerciseVolume(ex.currentWeek), 0);
}

/** Σ volume of every day in the week. */
export function weekVolume(week: Week): number {
  return week.days.reduce((total, day) => total + dayVolume(day), 0);
}

/** Σ volume of the previous-week columns, for week-over-week comparison. */
export function dayPreviousVolume(day: Day): number {
  return day.exercises.reduce((total, ex) => total + exerciseVolume(ex.previousWeek), 0);
}

export interface Progression {
  /** Suggested working weight, already rounded to a 2.5 kg increment. */
  weight: number | null;
  /** Kilos added versus last week: 0, 2.5 or 5. */
  delta: number | null;
  /** Ready-to-display string, matching the spreadsheet exactly. */
  text: string;
}

const NO_PROGRESSION: Progression = { weight: null, delta: null, text: '—' };

/**
 * Next-session weight suggestion, driven by **last week's** set 1.
 *
 * Mirrors the template: RIR 0 → hold, RIR 1 → +2.5 kg, anything else
 * (including a missing RIR, which Excel's `=0`/`=1` comparisons both reject)
 * → +5 kg. No previous weight means no suggestion.
 */
export function suggestProgression(previousFirstSet: SetEntry | undefined): Progression {
  if (!previousFirstSet || previousFirstSet.weight === null) return NO_PROGRESSION;

  const { weight, rir } = previousFirstSet;
  const delta = rir === 0 ? 0 : rir === 1 ? 2.5 : 5;
  const suggested = roundToPlate(weight + delta);
  const sign = delta === 0 ? '=' : `+${formatNumber(delta)}`;

  return { weight: suggested, delta, text: `${formatNumber(suggested)} kg (${sign})` };
}

/** The exercise's progression suggestion. */
export function exerciseProgression(exercise: Exercise): Progression {
  return suggestProgression(exercise.previousWeek[0]);
}

/**
 * How many sets the protocol text asks for, e.g. "3 SETS X 4-6 REPS" → 3.
 *
 * Used only to pre-open the right number of input rows; a protocol we cannot
 * read is not an error, it just means we fall back to the template default.
 */
export function parseProtocolSetCount(protocol: string | null): number | null {
  if (!protocol) return null;
  const match = /(\d+)\s*SETS?\b/i.exec(protocol);
  if (!match?.[1]) return null;
  const count = Number.parseInt(match[1], 10);
  return Number.isFinite(count) && count > 0 ? count : null;
}

/**
 * Sets that count as work performed — see {@link isSetWorked}.
 *
 * A weight with no reps does not count. This is what keeps a week started from
 * last week's loads out of every total until it is actually trained.
 */
export function loggedSetCount(sets: readonly SetEntry[]): number {
  return sets.filter(isSetWorked).length;
}

/** An exercise counts as started once any set has data. */
export function isExerciseStarted(exercise: Exercise): boolean {
  return loggedSetCount(exercise.currentWeek) > 0;
}

export interface DayProgress {
  totalExercises: number;
  startedExercises: number;
  /** 0–1. Zero when the day has no exercises. */
  ratio: number;
}

/** Progress through a session, for the header bar. */
export function dayProgress(day: Day): DayProgress {
  const totalExercises = day.exercises.length;
  const startedExercises = day.exercises.filter(isExerciseStarted).length;
  return {
    totalExercises,
    startedExercises,
    ratio: totalExercises === 0 ? 0 : startedExercises / totalExercises,
  };
}

/* ------------------------------------------------------------------ */
/* The session clock                                                   */
/* ------------------------------------------------------------------ */

/**
 * Longer than any session, short enough to still be today.
 *
 * Past this the clock was left running, not left training: the phone went in
 * a bag with the timer on. Counting it would put a four-hour session into the
 * average and quietly ruin every duration the app ever reports.
 */
export const RUNAWAY_TIMER_SECONDS = 4 * 60 * 60;

/**
 * How long the session has lasted: banked seconds plus the stretch running.
 *
 * Derived from a wall-clock instant rather than counted, so a phone that
 * slept through three sets comes back with the right number.
 */
export function sessionSeconds(day: Day, now: number = Date.now()): number {
  if (day.timerStartedAt === null) return day.elapsedSeconds;

  const started = Date.parse(day.timerStartedAt);
  if (Number.isNaN(started)) return day.elapsedSeconds;

  return day.elapsedSeconds + Math.max(0, Math.floor((now - started) / 1000));
}

/** True when the clock has clearly been left running rather than used. */
export function isTimerRunaway(day: Day, now: number = Date.now()): boolean {
  return day.timerStartedAt !== null && sessionSeconds(day, now) > RUNAWAY_TIMER_SECONDS;
}

/** `"42:15"`, and `"1h 12min"` once it passes the hour. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Where a session stands, for the home screen. */
export type SessionStatus = 'completed' | 'in-progress' | 'pending';

/**
 * A day is "in progress" as soon as anything is logged against it, and only
 * "completed" once the user says so — finishing is a decision, not something
 * inferred from having filled every box.
 */
export function daySessionStatus(day: Day): SessionStatus {
  if (day.completed) return 'completed';
  return dayProgress(day).startedExercises > 0 ? 'in-progress' : 'pending';
}

export interface WeekSummary {
  totalDays: number;
  completedDays: number;
  /** Days started but not finished. */
  activeDays: number;
  totalExercises: number;
  startedExercises: number;
  volume: number;
  previousVolume: number;
  /** Percentage change against the previous week, or `null` with no history. */
  changePercent: number | null;
  /** 0–1, by completed sessions. */
  ratio: number;
}

/** Everything the home screen needs about a week, in one pass. */
export function weekSummary(week: Week): WeekSummary {
  const volume = weekVolume(week);
  const previousVolume = week.days.reduce((total, day) => total + dayPreviousVolume(day), 0);
  const completedDays = week.days.filter((day) => day.completed).length;
  const activeDays = week.days.filter((day) => daySessionStatus(day) === 'in-progress').length;

  const exercises = week.days.reduce(
    (totals, day) => {
      const progress = dayProgress(day);
      return {
        total: totals.total + progress.totalExercises,
        started: totals.started + progress.startedExercises,
      };
    },
    { total: 0, started: 0 },
  );

  return {
    totalDays: week.days.length,
    completedDays,
    activeDays,
    totalExercises: exercises.total,
    startedExercises: exercises.started,
    volume,
    previousVolume,
    changePercent: volumeChangePercent(volume, previousVolume),
    ratio: week.days.length === 0 ? 0 : completedDays / week.days.length,
  };
}

/**
 * The session to offer as "continue": the one already started, otherwise the
 * first pending one. `null` when the whole week is done.
 */
export function findNextDay(week: Week): Day | null {
  return (
    week.days.find((day) => daySessionStatus(day) === 'in-progress') ??
    week.days.find((day) => daySessionStatus(day) === 'pending') ??
    null
  );
}

export interface TopLift {
  best: BestSet;
  exerciseName: string;
}

/** The heaviest set logged anywhere in the week, for the summary. */
export function bestLiftOfWeek(week: Week): TopLift | null {
  let top: TopLift | null = null;

  for (const day of week.days) {
    for (const exercise of day.exercises) {
      const best = exerciseBestSet(exercise);
      if (!best) continue;
      if (!top || isBetterSet(best, top.best)) {
        top = { best, exerciseName: exercise.name };
      }
    }
  }

  return top;
}

export interface ExerciseProgressRow {
  exerciseId: string;
  name: string;
  dayNumber: number;
  volume: number;
  /** The heaviest set performed on it this week. */
  best: BestSet | null;
  loggedSets: number;
}

/**
 * Per-exercise totals for the progress screen, heaviest lift first.
 *
 * Only exercises with something logged are included: a table of zeroes tells
 * the user nothing about their training.
 */
export function exerciseProgress(week: Week): ExerciseProgressRow[] {
  const rows: ExerciseProgressRow[] = [];

  for (const day of week.days) {
    for (const exercise of day.exercises) {
      const logged = loggedSetCount(exercise.currentWeek);
      if (logged === 0) continue;

      rows.push({
        exerciseId: exercise.id,
        name: exercise.name,
        dayNumber: day.number,
        volume: exerciseVolume(exercise.currentWeek),
        best: exerciseBestSet(exercise),
        loggedSets: logged,
      });
    }
  }

  return rows.sort((a, b) => b.volume - a.volume);
}

/* ------------------------------------------------------------------ */
/* Across the whole mesocycle                                          */
/* ------------------------------------------------------------------ */

export interface WeekVolumeRow {
  number: number;
  volume: number;
  completedDays: number;
  totalDays: number;
  /** Change against the week before it, or `null` for the first one. */
  changePercent: number | null;
}

/**
 * Volume week by week.
 *
 * While a program was one imported week this had nothing to compare; now that
 * weeks are created inside the app, this is the shape of a mesocycle — whether
 * the load is climbing, flat, or quietly falling off.
 */
export function volumeByWeek(weeks: readonly Week[]): WeekVolumeRow[] {
  return weeks.map((week, index) => {
    const volume = weekVolume(week);
    const earlier = index > 0 ? weeks[index - 1] : undefined;

    return {
      number: week.number,
      volume,
      completedDays: week.days.filter((day) => day.completed).length,
      totalDays: week.days.length,
      // A week you have not trained yet is not a 100% drop in training. It
      // read as one the moment you created it, in alarming amber.
      changePercent:
        earlier && volume > 0 ? volumeChangePercent(volume, weekVolume(earlier)) : null,
    };
  });
}

export interface TrendPoint {
  weekNumber: number;
  volume: number;
  /** The heaviest set performed that week. */
  best: BestSet | null;
}

export interface ExerciseTrend {
  /** The lineage these points share. Unique, unlike the name. */
  key: string;
  name: string;
  points: TrendPoint[];
  /** Top weight in the most recent week that has one. */
  latestTopWeight: number | null;
  /** Change in top weight between the first and last week with data, in kg. */
  weightGain: number | null;
}

/**
 * One row per exercise, tracked across every week of the program.
 *
 * Grouped by `lineage`, not by name and not by id. Each week holds its own copy
 * of the plan, so ids differ every week; and names can be edited from the app,
 * so grouping by name turned one renamed exercise into two lines and threw
 * away the progression it had taken the whole block to build.
 *
 * The label is the most recent name, since that is what the person now calls
 * the lift.
 *
 * Only weeks with something logged become points; an untrained week is absent
 * rather than a zero, so a mesocycle in progress does not read as a collapse.
 */
export function exerciseTrends(weeks: readonly Week[]): ExerciseTrend[] {
  const byLineage = new Map<string, { name: string; points: TrendPoint[] }>();

  for (const week of weeks) {
    for (const day of week.days) {
      for (const exercise of day.exercises) {
        const name = exercise.name.trim();
        if (name === '' || loggedSetCount(exercise.currentWeek) === 0) continue;

        const entry = byLineage.get(exercise.lineage) ?? { name, points: [] };
        // Weeks arrive in order, so the last one to write wins the label.
        entry.name = name;

        const volume = exerciseVolume(exercise.currentWeek);
        const best = exerciseBestSet(exercise);

        // One point per week, never one per occurrence. An upper/lower split
        // hits the same movement twice a week, and two entries for one week
        // gave the list duplicate keys and let `weightGain` report a
        // progression measured between two sessions of the same Monday.
        const existing = entry.points.find((point) => point.weekNumber === week.number);
        if (existing) {
          existing.volume += volume;
          existing.best = betterOrNull(existing.best, best);
        } else {
          entry.points.push({ weekNumber: week.number, volume, best });
        }

        byLineage.set(exercise.lineage, entry);
      }
    }
  }

  const trends: ExerciseTrend[] = [];

  for (const [key, { name, points }] of byLineage) {
    points.sort((a, b) => a.weekNumber - b.weekNumber);
    const withWeight = points.filter((point) => point.best !== null);
    const first = withWeight[0]?.best?.weight ?? null;
    const last = withWeight.at(-1)?.best?.weight ?? null;

    trends.push({
      key,
      name,
      points,
      latestTopWeight: last,
      weightGain: first !== null && last !== null && withWeight.length > 1 ? excelRound(last - first, 1) : null,
    });
  }

  // Most weeks trained first: those are the ones a progression is real for.
  return trends.sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name));
}

function betterOrNull(left: BestSet | null, right: BestSet | null): BestSet | null {
  if (left === null) return right;
  if (right === null) return left;
  return isBetterSet(right, left) ? right : left;
}

/**
 * The best set for every movement of the program, keyed by lineage.
 *
 * `exceptWeek` is what makes a record notice possible. Without it the set you
 * are typing right now is part of the history it is being compared against,
 * so the first weight of the day always ties its own record and nothing is
 * ever beaten. Leaving the current week out asks the only useful question:
 * is today better than everything before it?
 */
export function bestSetByLineage(
  weeks: readonly Week[],
  options: { exceptWeek?: number } = {},
): Map<string, BestSet> {
  const best = new Map<string, BestSet>();

  for (const week of weeks) {
    if (week.number === options.exceptWeek) continue;
    for (const day of week.days) {
      for (const exercise of day.exercises) {
        const candidate = exerciseBestSet(exercise);
        if (!candidate) continue;
        const incumbent = best.get(exercise.lineage);
        if (!incumbent || isBetterSet(candidate, incumbent)) best.set(exercise.lineage, candidate);
      }
    }
  }

  return best;
}

export interface DayVolumeRow {
  dayNumber: number;
  type: string | null;
  volume: number;
  completed: boolean;
}

/** Volume per day, for the bar chart on the progress screen. */
export function volumeByDay(week: Week): DayVolumeRow[] {
  return week.days.map((day) => ({
    dayNumber: day.number,
    type: day.type,
    volume: dayVolume(day),
    completed: day.completed,
  }));
}

/**
 * Percentage change between this week's and last week's volume.
 * `null` when there is nothing to compare against.
 */
export function volumeChangePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return excelRound(((current - previous) / previous) * 100, 1);
}

/** Formats a number the way the spreadsheet does: no trailing zeros, dot decimal. */
export function formatNumber(value: number): string {
  return String(excelRound(value, 2));
}

/** Volume as a label, rounded to one decimal: `970` → `"970 kg"`. */
export function formatVolume(value: number): string {
  return `${formatNumber(excelRound(value, 1))} kg`;
}
