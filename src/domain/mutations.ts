/**
 * Pure, immutable updates to a {@link Program}.
 *
 * The UI never mutates state in place; it calls one of these and stores the
 * result. Keeping them out of React makes every edit path testable without
 * rendering anything.
 */

import {
  TEMPLATE_SET_COUNT,
  emptySet,
  emptySets,
  type Day,
  type Exercise,
  type Program,
  type SetEntry,
} from './types';

/** The fields a set input can change. */
export type SetPatch = Partial<Pick<SetEntry, 'weight' | 'reps' | 'rir'>>;

/** Maximum sets per exercise. Generous, but stops runaway input. */
export const MAX_SETS = 12;

function mapDay<T extends Program>(program: T, dayId: string, update: (day: Day) => Day): T {
  return {
    ...program,
    weeks: program.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => (day.id === dayId ? update(day) : day)),
    })),
  };
}

function mapExercise<T extends Program>(
  program: T,
  dayId: string,
  exerciseId: string,
  update: (exercise: Exercise) => Exercise,
): T {
  return mapDay(program, dayId, (day) => ({
    ...day,
    exercises: day.exercises.map((exercise) =>
      exercise.id === exerciseId ? update(exercise) : exercise,
    ),
  }));
}

/** Writes one field of one set. */
export function updateSet<T extends Program>(
  program: T,
  dayId: string,
  exerciseId: string,
  setIndex: number,
  patch: SetPatch,
): T {
  return mapExercise(program, dayId, exerciseId, (exercise) => {
    if (setIndex < 0 || setIndex >= exercise.currentWeek.length) return exercise;
    return {
      ...exercise,
      currentWeek: exercise.currentWeek.map((set, index) =>
        index === setIndex ? { ...set, ...patch } : set,
      ),
    };
  });
}

/**
 * Appends a set, pre-filling weight and reps from the last logged set —
 * during a workout the next set is usually the same as the one before it.
 */
export function addSet<T extends Program>(program: T, dayId: string, exerciseId: string): T {
  return mapExercise(program, dayId, exerciseId, (exercise) => {
    if (exercise.currentWeek.length >= MAX_SETS) return exercise;

    const last = [...exercise.currentWeek].reverse().find((set) => set.weight !== null);
    const seed: SetEntry = last ? { weight: last.weight, reps: null, rir: null } : emptySet();

    return { ...exercise, currentWeek: [...exercise.currentWeek, seed] };
  });
}

/**
 * Removes a set. The template's own four slots are cleared rather than
 * removed, so the layout the user imported stays recognizable.
 */
export function removeSet<T extends Program>(
  program: T,
  dayId: string,
  exerciseId: string,
  setIndex: number,
): T {
  return mapExercise(program, dayId, exerciseId, (exercise) => {
    if (setIndex < 0 || setIndex >= exercise.currentWeek.length) return exercise;

    if (setIndex < TEMPLATE_SET_COUNT) {
      return {
        ...exercise,
        currentWeek: exercise.currentWeek.map((set, index) =>
          index === setIndex ? emptySet() : set,
        ),
      };
    }

    return {
      ...exercise,
      currentWeek: exercise.currentWeek.filter((_unused, index) => index !== setIndex),
    };
  });
}

/** The plan fields of an exercise, as edited from the app. */
export interface ExerciseFields {
  name: string;
  protocol: string | null;
  comments: string | null;
  video: string | null;
}

/**
 * Rewrites an exercise's plan fields, leaving every logged set alone.
 *
 * Editing the plan must never touch the execution: renaming a movement does
 * not unmake the sets performed under the old name.
 */
export function setExerciseFields<T extends Program>(
  program: T,
  dayId: string,
  exerciseId: string,
  fields: ExerciseFields,
): T {
  return mapExercise(program, dayId, exerciseId, (exercise) => ({
    ...exercise,
    name: fields.name,
    protocol: fields.protocol,
    comments: fields.comments,
    video: fields.video,
  }));
}

export function setDayNotes<T extends Program>(program: T, dayId: string, notes: string): T {
  return mapDay(program, dayId, (day) => ({ ...day, notes }));
}

export function setDayCompleted<T extends Program>(program: T, dayId: string, completed: boolean): T {
  return mapDay(program, dayId, (day) => ({ ...day, completed }));
}

/** Clears every logged set, note and completion flag for a day. */
export function resetDay<T extends Program>(program: T, dayId: string): T {
  return mapDay(program, dayId, (day) => ({
    ...day,
    notes: '',
    completed: false,
    exercises: day.exercises.map((exercise) => ({
      ...exercise,
      currentWeek: emptySets(TEMPLATE_SET_COUNT),
    })),
  }));
}

/**
 * Parses what the user typed into a numeric field.
 *
 * Returns `undefined` for input we refuse to accept, which the caller reads as
 * "keep the previous value" — so a half-typed "8," never wipes a logged set.
 */
export function parseNumericInput(
  raw: string,
  options: { min?: number; max?: number } = {},
): number | null | undefined {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') return null;

  // Allow a trailing dot mid-typing ("82.") without committing a change.
  if (/^\d+\.$/.test(trimmed)) return undefined;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return undefined;

  const { min = 0, max = 100_000 } = options;
  if (value < min || value > max) return undefined;

  return value;
}
