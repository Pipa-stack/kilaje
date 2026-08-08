/**
 * Program persistence: writing an imported template, and reading it back
 * merged with whatever the user has logged against it.
 *
 * The API speaks the exact same normalized {@link Program} shape the frontend
 * already used with `localStorage`, so swapping the persistence backend did
 * not require touching the domain, the calculations or the components.
 *
 * Mapping between the two halves of the schema:
 *
 *   exercise.previousWeek  <-  reference_sets   (template, imported history)
 *   exercise.currentWeek   <-  session_sets     (execution, what was lifted)
 *   day.notes / completed  <-  workout_sessions (execution)
 */

import { createHash } from 'node:crypto';

import {
  SCHEMA_VERSION,
  TEMPLATE_SET_COUNT,
  emptySets,
  isSetEmpty,
  type Day,
  type Exercise,
  type Program,
  type SetEntry,
  type Week,
} from '../../src/domain/types';
import { parseProtocolSetCount } from '../../src/domain/calculations';
import type { Database } from '../db/database';

/** A program as listed in the picker, without its contents. */
export interface ProgramSummary {
  id: number;
  name: string;
  sourceFileName: string;
  version: number;
  importedAt: string;
  weekCount: number;
  dayCount: number;
  completedDays: number;
}

/** A stored program: the normalized model plus its database identity. */
export interface StoredProgram extends Program {
  id: number;
  name: string;
  version: number;
}

export function hashSource(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

export interface ImportResult {
  program: StoredProgram;
  /** False when an identical file had already been imported. */
  created: boolean;
}

/**
 * Persists a freshly parsed program.
 *
 * Re-importing is additive by design: a new `programs` row is inserted and no
 * existing row is modified, so previous programs and every session performed
 * against them survive untouched. Uploading a byte-identical file is a no-op
 * that returns the existing program, which is what stops a double click or a
 * retried request from creating duplicates.
 *
 * The "Semana actual" values that came inside the workbook are real performed
 * work, so they are seeded into the execution tables, not the template.
 */
export async function importProgram(
  db: Database,
  parsed: Program,
  sourceHash: string,
): Promise<ImportResult> {
  const existing = await findProgramIdByHash(db, sourceHash);
  if (existing !== null) {
    const program = await getProgram(db, existing);
    if (program) return { program, created: false };
  }

  const programId = await db.transaction(async (tx) => {
    const { rows: versionRows } = await tx.query<{ next: number }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM programs WHERE source_file_name = $1',
      [parsed.sourceFileName],
    );
    const version = versionRows[0]?.next ?? 1;
    const name = buildName(parsed.sourceFileName, version);

    const { rows: programRows } = await tx.query<{ id: number }>(
      `INSERT INTO programs (name, source_file_name, source_hash, version, imported_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [name, parsed.sourceFileName, sourceHash, version, parsed.importedAt],
    );
    const insertedId = programRows[0]?.id;
    if (insertedId === undefined) throw new Error('No se ha podido crear el programa');

    for (const week of parsed.weeks) {
      const weekId = await insertWeek(tx, insertedId, week);
      for (const day of week.days) {
        const dayId = await insertDay(tx, weekId, day);
        await insertSession(tx, dayId, day);
        for (const exercise of day.exercises) {
          const exerciseId = await insertExercise(tx, dayId, exercise);
          await insertReferenceSets(tx, exerciseId, exercise.previousWeek);
          await insertSeededSets(tx, dayId, exerciseId, exercise.currentWeek);
        }
      }
    }

    return insertedId;
  });

  const program = await getProgram(db, programId);
  if (!program) throw new Error('El programa se ha guardado pero no se ha podido leer');
  return { program, created: true };
}

function buildName(sourceFileName: string, version: number): string {
  const base = sourceFileName.replace(/\.(xlsx|xlsm)$/i, '').trim() || 'Entrenamiento';
  return version === 1 ? base : `${base} (v${version})`;
}

async function insertWeek(tx: Database, programId: number, week: Week): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    'INSERT INTO weeks (program_id, number, sheet_name) VALUES ($1, $2, $3) RETURNING id',
    [programId, week.number, week.sheetName],
  );
  return requireId(rows[0]?.id);
}

async function insertDay(tx: Database, weekId: number, day: Day): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    'INSERT INTO workout_days (week_id, number, type) VALUES ($1, $2, $3) RETURNING id',
    [weekId, day.number, day.type],
  );
  return requireId(rows[0]?.id);
}

async function insertExercise(tx: Database, dayId: number, exercise: Exercise): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO exercises
       (day_id, position, external_key, name, video_url, protocol, comments, planned_set_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      dayId,
      exercise.number,
      exercise.id,
      exercise.name,
      exercise.video,
      exercise.protocol,
      exercise.comments,
      parseProtocolSetCount(exercise.protocol),
    ],
  );
  return requireId(rows[0]?.id);
}

async function insertReferenceSets(
  tx: Database,
  exerciseId: number,
  sets: readonly SetEntry[],
): Promise<void> {
  for (const [index, set] of sets.entries()) {
    if (isSetEmpty(set)) continue;
    await tx.query(
      `INSERT INTO reference_sets (exercise_id, set_index, weight, reps, rir)
       VALUES ($1, $2, $3, $4, $5)`,
      [exerciseId, index, set.weight, set.reps, set.rir],
    );
  }
}

/**
 * The workbook's "Semana actual" columns are work the user already did, so
 * they land in the session tables rather than being mistaken for plan data.
 */
async function insertSeededSets(
  tx: Database,
  dayId: number,
  exerciseId: number,
  sets: readonly SetEntry[],
): Promise<void> {
  const sessionId = await requireSessionId(tx, dayId);
  for (const [index, set] of sets.entries()) {
    if (isSetEmpty(set)) continue;
    await tx.query(
      `INSERT INTO session_sets (session_id, exercise_id, set_index, weight, reps, rir)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, exerciseId, index, set.weight, set.reps, set.rir],
    );
  }
}

async function insertSession(tx: Database, dayId: number, day: Day): Promise<void> {
  await tx.query(
    `INSERT INTO workout_sessions (day_id, notes, completed, completed_at)
     VALUES ($1, $2, $3, $4)`,
    [dayId, day.notes, day.completed, day.completed ? new Date().toISOString() : null],
  );
}

function requireId(id: number | undefined): number {
  if (id === undefined) throw new Error('La inserción no ha devuelto un identificador');
  return id;
}

/** The session row for a day, creating it on first use. */
export async function requireSessionId(db: Database, dayId: number): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO workout_sessions (day_id) VALUES ($1)
     ON CONFLICT (day_id) DO UPDATE SET day_id = EXCLUDED.day_id
     RETURNING id`,
    [dayId],
  );
  return requireId(rows[0]?.id);
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * Deletes a program and everything hanging off it.
 *
 * The foreign keys cascade, so the plan, its sessions and its logged sets go
 * together — deleting a program is meant to erase that training history, not
 * to orphan it.
 *
 * @returns false when the program did not exist.
 */
export async function deleteProgram(db: Database, programId: number): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM programs WHERE id = $1', [programId]);
  return rowCount > 0;
}

export async function findProgramIdByHash(db: Database, hash: string): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>('SELECT id FROM programs WHERE source_hash = $1', [
    hash,
  ]);
  return rows[0]?.id ?? null;
}

/** Programs newest first, for the picker. */
export async function listPrograms(db: Database): Promise<ProgramSummary[]> {
  const { rows } = await db.query<{
    id: number;
    name: string;
    source_file_name: string;
    version: number;
    imported_at: Date | string;
    week_count: number;
    day_count: number;
    completed_days: number;
  }>(`
    SELECT p.id, p.name, p.source_file_name, p.version, p.imported_at,
           COUNT(DISTINCT w.id)                                  AS week_count,
           COUNT(DISTINCT d.id)                                  AS day_count,
           COUNT(DISTINCT s.id) FILTER (WHERE s.completed)        AS completed_days
      FROM programs p
      LEFT JOIN weeks w            ON w.program_id = p.id
      LEFT JOIN workout_days d     ON d.week_id = w.id
      LEFT JOIN workout_sessions s ON s.day_id = d.id
     GROUP BY p.id
     ORDER BY p.imported_at DESC, p.id DESC
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sourceFileName: row.source_file_name,
    version: row.version,
    importedAt: toIso(row.imported_at),
    weekCount: Number(row.week_count),
    dayCount: Number(row.day_count),
    completedDays: Number(row.completed_days),
  }));
}

/** The id of the program to open when none was requested. */
export async function findLatestProgramId(db: Database): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>(
    'SELECT id FROM programs ORDER BY imported_at DESC, id DESC LIMIT 1',
  );
  return rows[0]?.id ?? null;
}

interface ProgramRow {
  id: number;
  name: string;
  source_file_name: string;
  version: number;
  imported_at: Date | string;
}

interface ContentRow {
  week_id: number;
  week_number: number;
  sheet_name: string;
  day_id: number;
  day_number: number;
  day_type: string | null;
  notes: string | null;
  completed: boolean | null;
  exercise_id: number | null;
  position: number | null;
  external_key: string | null;
  name: string | null;
  video_url: string | null;
  protocol: string | null;
  comments: string | null;
}

/**
 * Loads a whole program in three queries rather than one per exercise: the
 * skeleton, then all reference sets, then all logged sets.
 */
export async function getProgram(db: Database, programId: number): Promise<StoredProgram | null> {
  const { rows: programRows } = await db.query<ProgramRow>(
    'SELECT id, name, source_file_name, version, imported_at FROM programs WHERE id = $1',
    [programId],
  );
  const program = programRows[0];
  if (!program) return null;

  const { rows: content } = await db.query<ContentRow>(
    `SELECT w.id AS week_id, w.number AS week_number, w.sheet_name,
            d.id AS day_id, d.number AS day_number, d.type AS day_type,
            s.notes, s.completed,
            e.id AS exercise_id, e.position, e.external_key, e.name,
            e.video_url, e.protocol, e.comments
       FROM weeks w
       JOIN workout_days d          ON d.week_id = w.id
       LEFT JOIN workout_sessions s ON s.day_id = d.id
       LEFT JOIN exercises e        ON e.day_id = d.id
      WHERE w.program_id = $1
      ORDER BY w.number, d.number, e.position`,
    [programId],
  );

  const referenceSets = await loadSets(
    db,
    `SELECT r.exercise_id, r.set_index, r.weight, r.reps, r.rir
       FROM reference_sets r
       JOIN exercises e     ON e.id = r.exercise_id
       JOIN workout_days d  ON d.id = e.day_id
       JOIN weeks w         ON w.id = d.week_id
      WHERE w.program_id = $1`,
    programId,
  );

  const loggedSets = await loadSets(
    db,
    `SELECT ss.exercise_id, ss.set_index, ss.weight, ss.reps, ss.rir
       FROM session_sets ss
       JOIN exercises e     ON e.id = ss.exercise_id
       JOIN workout_days d  ON d.id = e.day_id
       JOIN weeks w         ON w.id = d.week_id
      WHERE w.program_id = $1`,
    programId,
  );

  return {
    id: program.id,
    name: program.name,
    version: program.version,
    schemaVersion: SCHEMA_VERSION,
    sourceFileName: program.source_file_name,
    importedAt: toIso(program.imported_at),
    weeks: assembleWeeks(content, referenceSets, loggedSets),
  };
}

type SetsByExercise = Map<number, SetEntry[]>;

async function loadSets(db: Database, sql: string, programId: number): Promise<SetsByExercise> {
  const { rows } = await db.query<{
    exercise_id: number;
    set_index: number;
    weight: number | null;
    reps: number | null;
    rir: number | null;
  }>(sql, [programId]);

  const byExercise: SetsByExercise = new Map();
  for (const row of rows) {
    const sets = byExercise.get(row.exercise_id) ?? [];
    // Sparse rows: only non-empty sets are stored, so gaps are filled in.
    while (sets.length <= row.set_index) sets.push({ weight: null, reps: null, rir: null });
    sets[row.set_index] = {
      weight: numeric(row.weight),
      reps: numeric(row.reps),
      rir: numeric(row.rir),
    };
    byExercise.set(row.exercise_id, sets);
  }
  return byExercise;
}

function assembleWeeks(
  content: ContentRow[],
  referenceSets: SetsByExercise,
  loggedSets: SetsByExercise,
): Week[] {
  const weeks = new Map<number, Week>();
  const days = new Map<number, Day>();

  for (const row of content) {
    let week = weeks.get(row.week_id);
    if (!week) {
      week = { number: row.week_number, sheetName: row.sheet_name, days: [] };
      weeks.set(row.week_id, week);
    }

    let day = days.get(row.day_id);
    if (!day) {
      day = {
        id: String(row.day_id),
        number: row.day_number,
        type: row.day_type,
        exercises: [],
        notes: row.notes ?? '',
        completed: row.completed ?? false,
      };
      days.set(row.day_id, day);
      week.days.push(day);
    }

    // LEFT JOIN: a day with no exercises still produces one row.
    if (row.exercise_id === null || row.external_key === null) continue;

    day.exercises.push({
      id: String(row.exercise_id),
      number: row.position ?? day.exercises.length + 1,
      name: row.name ?? '',
      video: row.video_url,
      protocol: row.protocol,
      comments: row.comments,
      previousWeek: pad(referenceSets.get(row.exercise_id)),
      currentWeek: pad(loggedSets.get(row.exercise_id)),
    });
  }

  return [...weeks.values()];
}

/** Guarantees the template's four slots so the UI never special-cases. */
function pad(sets: SetEntry[] | undefined): SetEntry[] {
  const present = sets ?? [];
  if (present.length >= TEMPLATE_SET_COUNT) return present;
  return [...present, ...emptySets(TEMPLATE_SET_COUNT - present.length)];
}

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
