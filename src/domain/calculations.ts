/**
 * Every number the app shows is produced here.
 *
 * These functions reproduce the formulas found in the source spreadsheet
 * (see SPEC.md §2). They are pure and independently testable on purpose: the
 * spreadsheet is the specification, and a regression here is a wrong training
 * decision for the user.
 */

import type { Day, Exercise, SetEntry, Week } from './types';

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

/**
 * Estimated 1RM from a single set, Epley: `weight × (1 + reps / 30)`.
 *
 * The template only ever applies this to set 1 and leaves the cell blank
 * unless both weight and reps are present — `null` here is that blank.
 */
export function epley1RM(set: SetEntry | undefined): number | null {
  if (!set || set.weight === null || set.reps === null) return null;
  return excelRound(set.weight * (1 + set.reps / 30), 1);
}

/** The exercise's estimated 1RM, taken from set 1 as the template does. */
export function exercise1RM(exercise: Exercise): number | null {
  return epley1RM(exercise.currentWeek[0]);
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

/** Sets with at least a weight or a rep recorded. */
export function loggedSetCount(sets: readonly SetEntry[]): number {
  return sets.filter((set) => set.weight !== null || set.reps !== null).length;
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
  oneRepMax: number;
  exerciseName: string;
}

/** The best estimated 1RM logged in the week, for the summary. */
export function bestEstimated1RM(week: Week): TopLift | null {
  let best: TopLift | null = null;

  for (const day of week.days) {
    for (const exercise of day.exercises) {
      const oneRepMax = exercise1RM(exercise);
      if (oneRepMax === null) continue;
      if (!best || oneRepMax > best.oneRepMax) {
        best = { oneRepMax, exerciseName: exercise.name };
      }
    }
  }

  return best;
}

export interface ExerciseProgressRow {
  exerciseId: string;
  name: string;
  dayNumber: number;
  volume: number;
  oneRepMax: number | null;
  /** Heaviest weight lifted for at least one rep. */
  topWeight: number | null;
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

      const weights = exercise.currentWeek
        .filter((set) => set.weight !== null && (set.reps ?? 0) > 0)
        .map((set) => set.weight as number);

      rows.push({
        exerciseId: exercise.id,
        name: exercise.name,
        dayNumber: day.number,
        volume: exerciseVolume(exercise.currentWeek),
        oneRepMax: exercise1RM(exercise),
        topWeight: weights.length > 0 ? Math.max(...weights) : null,
        loggedSets: logged,
      });
    }
  }

  return rows.sort((a, b) => b.volume - a.volume);
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
