/**
 * Offline cache in `localStorage`.
 *
 * PostgreSQL is the source of truth; this is the fallback that keeps the app
 * usable when the API cannot be reached — a gym basement with no signal shows
 * the last known workout instead of an empty screen.
 *
 * Nothing here may ever throw: a full quota, a disabled storage (Safari
 * private mode) or a corrupted entry must degrade to "nothing cached", not to
 * a blank page.
 */

import {
  SCHEMA_VERSION,
  TEMPLATE_SET_COUNT,
  emptySets,
  type Day,
  type Exercise,
  type Program,
  type SetEntry,
  type Week,
} from '../domain/types';

export const STORAGE_KEY = 'gimnasio.program.v1';

/** Where the UI selection is remembered, so a reload lands on the same day. */
export const SELECTION_KEY = 'gimnasio.selection.v1';

export interface Selection {
  weekNumber: number;
  dayNumber: number;
}

/** `localStorage`, or `null` where it is unavailable or blocked. */
function storage(): Storage | null {
  try {
    const candidate = globalThis.localStorage;
    if (!candidate) return null;
    // Access alone can throw in locked-down browsers; a probe confirms writes.
    const probe = '__gimnasio_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
}

/** True when the program can actually be persisted on this device. */
export function isStorageAvailable(): boolean {
  return storage() !== null;
}

/** Reads the saved program, or `null` when there is nothing usable stored. */
export function loadProgram(): Program | null {
  const store = storage();
  if (!store) return null;

  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeProgram(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persists the program. Returns false when the write did not happen. */
export function saveProgram(program: Program): boolean {
  const store = storage();
  if (!store) return false;

  try {
    store.setItem(STORAGE_KEY, JSON.stringify(program));
    return true;
  } catch {
    // Quota exceeded, most likely. The in-memory state stays correct.
    return false;
  }
}

/** A cached program keeps the database identity so it can be reconciled. */
export interface CachedProgram extends Program {
  id: number;
  name: string;
  version: number;
}

/** Stores the program currently on screen for offline use. */
export function cacheProgram(program: CachedProgram): boolean {
  return saveProgram(program);
}

/**
 * Reads the cached program.
 *
 * Returns `null` unless the entry still carries its database identity: a
 * cache written by an older, `localStorage`-only build cannot be written back
 * to the API and must not be shown as if it could.
 */
export function loadCachedProgram(): CachedProgram | null {
  const store = storage();
  if (!store) return null;

  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    const program = normalizeProgram(parsed);
    if (!program || !isRecord(parsed)) return null;

    const id = finiteNumber(parsed.id);
    const version = finiteNumber(parsed.version);
    if (id === null || version === null) return null;

    return {
      ...program,
      id,
      version,
      name: typeof parsed.name === 'string' ? parsed.name : program.sourceFileName,
    };
  } catch {
    return null;
  }
}

export function clearProgram(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
    store.removeItem(SELECTION_KEY);
  } catch {
    /* nothing sensible to do */
  }
}

export function loadSelection(): Selection | null {
  const store = storage();
  if (!store) return null;

  try {
    const raw = store.getItem(SELECTION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    const weekNumber = finiteNumber(parsed.weekNumber);
    const dayNumber = finiteNumber(parsed.dayNumber);
    return weekNumber === null || dayNumber === null ? null : { weekNumber, dayNumber };
  } catch {
    return null;
  }
}

export function saveSelection(selection: Selection): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(SELECTION_KEY, JSON.stringify(selection));
  } catch {
    /* selection is a convenience; losing it is acceptable */
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Rebuilds a {@link Program} from untrusted JSON.
 *
 * Anything stored by an older version, hand-edited in devtools, or truncated
 * mid-write reaches this function. Rather than trusting a type assertion,
 * every field is rebuilt with a fallback; unrecoverable input returns `null`.
 */
export function normalizeProgram(input: unknown): Program | null {
  if (!isRecord(input)) return null;

  const weeks = Array.isArray(input.weeks)
    ? input.weeks.map(normalizeWeek).filter((week): week is Week => week !== null)
    : [];
  if (weeks.length === 0) return null;

  return {
    schemaVersion: finiteNumber(input.schemaVersion) ?? SCHEMA_VERSION,
    sourceFileName: typeof input.sourceFileName === 'string' ? input.sourceFileName : 'entrenamiento.xlsx',
    importedAt: typeof input.importedAt === 'string' ? input.importedAt : new Date().toISOString(),
    weeks,
  };
}

function normalizeWeek(input: unknown): Week | null {
  if (!isRecord(input)) return null;

  const number = finiteNumber(input.number);
  if (number === null) return null;

  const days = Array.isArray(input.days)
    ? input.days.map((day) => normalizeDay(day, number)).filter((day): day is Day => day !== null)
    : [];
  if (days.length === 0) return null;

  return {
    number,
    sheetName: typeof input.sheetName === 'string' ? input.sheetName : `Semana ${number}`,
    days,
  };
}

function normalizeDay(input: unknown, weekNumber: number): Day | null {
  if (!isRecord(input)) return null;

  const number = finiteNumber(input.number);
  if (number === null) return null;

  const id = typeof input.id === 'string' ? input.id : `w${weekNumber}:d${number}`;
  const exercises = Array.isArray(input.exercises)
    ? input.exercises
        .map((exercise) => normalizeExercise(exercise, id))
        .filter((exercise): exercise is Exercise => exercise !== null)
    : [];
  if (exercises.length === 0) return null;

  return {
    id,
    number,
    type: typeof input.type === 'string' ? input.type : null,
    exercises,
    notes: typeof input.notes === 'string' ? input.notes : '',
    completed: input.completed === true,
  };
}

function normalizeExercise(input: unknown, dayId: string): Exercise | null {
  if (!isRecord(input)) return null;

  const number = finiteNumber(input.number);
  if (number === null) return null;

  return {
    id: typeof input.id === 'string' ? input.id : `${dayId}:e${number}`,
    number,
    name: typeof input.name === 'string' ? input.name : '',
    video: typeof input.video === 'string' ? input.video : null,
    protocol: typeof input.protocol === 'string' ? input.protocol : null,
    comments: typeof input.comments === 'string' ? input.comments : null,
    previousWeek: normalizeSets(input.previousWeek),
    currentWeek: normalizeSets(input.currentWeek),
  };
}

function normalizeSets(input: unknown): SetEntry[] {
  if (!Array.isArray(input)) return emptySets(TEMPLATE_SET_COUNT);

  const sets = input.map(normalizeSet);
  return sets.length >= TEMPLATE_SET_COUNT
    ? sets
    : [...sets, ...emptySets(TEMPLATE_SET_COUNT - sets.length)];
}

function normalizeSet(input: unknown): SetEntry {
  if (!isRecord(input)) return { weight: null, reps: null, rir: null };
  return {
    weight: finiteNumber(input.weight),
    reps: finiteNumber(input.reps),
    rir: finiteNumber(input.rir),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ */
/* Re-import                                                           */
/* ------------------------------------------------------------------ */

/**
 * Applies a freshly imported program on top of what the user already logged.
 *
 * Re-importing is how the user updates their plan mid-cycle, so the incoming
 * file wins on *structure* (exercises, protocols, videos, order) while
 * anything the user typed in this app — sets, notes, completion — is carried
 * over, matched by exercise id. Values present in the new file are kept when
 * the app has nothing for that slot, so an Excel filled in on a desktop still
 * imports its data.
 */
export function mergeProgram(incoming: Program, existing: Program | null): Program {
  if (!existing) return incoming;

  const previousDays = new Map<string, Day>();
  for (const week of existing.weeks) {
    for (const day of week.days) previousDays.set(day.id, day);
  }

  return {
    ...incoming,
    weeks: incoming.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => mergeDay(day, previousDays.get(day.id))),
    })),
  };
}

function mergeDay(incoming: Day, existing: Day | undefined): Day {
  if (!existing) return incoming;

  const previousExercises = new Map(existing.exercises.map((exercise) => [exercise.id, exercise]));

  return {
    ...incoming,
    notes: incoming.notes.trim() !== '' ? incoming.notes : existing.notes,
    completed: incoming.completed || existing.completed,
    exercises: incoming.exercises.map((exercise) =>
      mergeExercise(exercise, previousExercises.get(exercise.id)),
    ),
  };
}

function mergeExercise(incoming: Exercise, existing: Exercise | undefined): Exercise {
  if (!existing || existing.name !== incoming.name) return incoming;

  return {
    ...incoming,
    currentWeek: mergeSets(incoming.currentWeek, existing.currentWeek),
    previousWeek: mergeSets(incoming.previousWeek, existing.previousWeek),
  };
}

/** Keeps every logged set, preferring the file's value where both exist. */
function mergeSets(incoming: SetEntry[], existing: SetEntry[]): SetEntry[] {
  const length = Math.max(incoming.length, existing.length);
  return Array.from({ length }, (_unused, index) => {
    const from = incoming[index];
    const saved = existing[index];
    if (!from) return saved ? { ...saved } : { weight: null, reps: null, rir: null };
    if (!saved) return { ...from };
    return {
      weight: from.weight ?? saved.weight,
      reps: from.reps ?? saved.reps,
      rir: from.rir ?? saved.rir,
    };
  });
}
