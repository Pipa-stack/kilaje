/**
 * Normalized training model.
 *
 * Nothing in this file (or anywhere outside `src/parser`) knows about
 * spreadsheets, cells, rows or columns. The parser's job is to produce these
 * shapes; everything else consumes them.
 */

/** How many sets the Excel template reserves per exercise. */
export const TEMPLATE_SET_COUNT = 4;

/** Current persisted-schema version. Bump when the shape changes. */
export const SCHEMA_VERSION = 1;

/** A single working set. `null` means "not recorded". */
export interface SetEntry {
  weight: number | null;
  reps: number | null;
  rir: number | null;
}

export interface Exercise {
  /** Stable across re-imports: `w<week>:d<day>:e<number>`. */
  id: string;
  /**
   * Identifies the same movement across weeks.
   *
   * Every week holds its own copy of the plan, so the same exercise has a
   * different `id` in each one. This is what lets progress be followed from
   * week to week: assigned once, inherited by every clone, and untouched by a
   * rename — which is what matching on the name could not survive.
   */
  lineage: string;
  /** Position within the day, 1-based, as printed in the template. */
  number: number;
  name: string;
  video: string | null;
  protocol: string | null;
  comments: string | null;
  /** Previous-week reference sets. Always `TEMPLATE_SET_COUNT` long. */
  previousWeek: SetEntry[];
  /** Sets logged for this week. At least `TEMPLATE_SET_COUNT`; user may add more. */
  currentWeek: SetEntry[];
}

export interface Day {
  /** Stable across re-imports: `w<week>:d<day>`. */
  id: string;
  /** Day number as printed in the template ("DÍA 3" → 3). */
  number: number;
  /** Session type such as "PUSH" or "LEG (CADENA ANTERIOR)". May be absent. */
  type: string | null;
  exercises: Exercise[];
  notes: string;
  completed: boolean;
}

export interface Week {
  number: number;
  /** Original worksheet name, kept for traceability. */
  sheetName: string;
  days: Day[];
}

export interface Program {
  schemaVersion: number;
  sourceFileName: string;
  /** ISO 8601 timestamp of the import. */
  importedAt: string;
  weeks: Week[];
}

/** An empty, unrecorded set. */
export function emptySet(): SetEntry {
  return { weight: null, reps: null, rir: null };
}

/** `n` empty sets. */
export function emptySets(count: number): SetEntry[] {
  return Array.from({ length: count }, emptySet);
}

/** True when nothing at all has been recorded for this set. */
export function isSetEmpty(set: SetEntry): boolean {
  return set.weight === null && set.reps === null && set.rir === null;
}

/**
 * True when this set represents work that was actually performed.
 *
 * A weight on its own is a plan, not a session: it is what the app pre-fills
 * when a week is started from the previous one's loads, and what sits in the
 * box for the few seconds between typing the weight and typing the reps. The
 * reps (or an RIR) are what turn it into training.
 *
 * The distinction has to live in one place. It was previously re-decided at
 * each call site, and the three answers disagreed: a week pre-filled with last
 * week's weights counted as trained for the progress chart and for the
 * "previous week" reference — so the next week suggested a progression on top
 * of numbers nobody had lifted.
 */
export function isSetWorked(set: SetEntry): boolean {
  return set.reps !== null || set.rir !== null;
}
