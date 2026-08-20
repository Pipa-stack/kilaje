/**
 * The journey back: a stored {@link Program} written out as a workbook.
 *
 * The point is not a pretty spreadsheet, it is a copy of your training that
 * lives somewhere neither Railway nor this app controls. Continuous backups
 * cost money; a file in your own Drive costs nothing, and if this service ever
 * disappears the training does not go with it.
 *
 * So the layout is deliberately the one `excelParser.ts` already knows how to
 * read — same day headers, same `S1 Peso | S1 Reps | RIR` blocks, same summary
 * and trailer rows. That makes the export re-importable, which is what turns a
 * download into an actual backup: there is a test asserting the round trip
 * survives it. Anything the app cannot read back is not a backup, it is a
 * souvenir.
 */

import * as XLSX from 'xlsx';

import { isSetWorked, type Day, type Exercise, type Program, type SetEntry } from '../../src/domain/types';

/** Columns before the set blocks: Nº, Ejercicio, Vídeo, Protocolo, Comentarios, gap. */
const PLAN_COLUMNS = 6;

/** A gap column between the previous-week block and the current-week one. */
const GAP = 1;

/** Each set costs three columns: peso, reps, RIR. */
const PER_SET = 3;

type Row = (string | number | null)[];

/**
 * Builds an `.xlsx` from a program.
 *
 * @returns the file's bytes, ready to stream to the browser.
 */
export function buildWorkbook(program: Program): Uint8Array {
  const workbook = XLSX.utils.book_new();

  for (const week of program.weeks) {
    const setCount = maxSetCount(week.days);
    const rows: Row[] = [];

    for (const day of week.days) {
      appendDay(rows, day, setCount);
      // A blank row between day blocks, exactly as the template has it.
      rows.push([]);
    }

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(rows),
      // The parser finds weeks by sheet name, so this is not cosmetic.
      `Semana ${week.number}`,
    );
  }

  return new Uint8Array(
    XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
  );
}

/** The widest exercise in the week, so added sets survive the round trip. */
function maxSetCount(days: readonly Day[]): number {
  let widest = 4;
  for (const day of days) {
    for (const exercise of day.exercises) {
      widest = Math.max(widest, exercise.currentWeek.length, exercise.previousWeek.length);
    }
  }
  return widest;
}

function appendDay(rows: Row[], day: Day, setCount: number): void {
  rows.push([`DÍA ${day.number}`, day.type ?? '']);
  rows.push(headerRow(setCount));
  rows.push(setsRow(setCount));

  for (const exercise of day.exercises) {
    rows.push(exerciseRow(exercise, setCount));
  }

  // The parser reads exercises until it meets this row, then looks just below
  // it for the notes and the completion flag.
  rows.push([`VOLUMEN TOTAL DÍA ${day.number}`]);
  rows.push(['📝 Notas de sesión:', day.notes]);
  rows.push(['✅ Sesión completada:', day.completed ? 'SI' : 'NO']);
}

function headerRow(setCount: number): Row {
  const row: Row = ['Nº', 'Ejercicio', '📹 Vídeo', 'Protocolo', 'Comentarios', ''];
  row[PLAN_COLUMNS] = '← Semana anterior';
  row[PLAN_COLUMNS + setCount * PER_SET + GAP] = 'Semana actual';
  return fill(row);
}

function setsRow(setCount: number): Row {
  const row: Row = [];
  for (const start of blockStarts(setCount)) {
    for (let set = 0; set < setCount; set += 1) {
      const at = start + set * PER_SET;
      row[at] = `S${set + 1} Peso`;
      row[at + 1] = `S${set + 1} Reps`;
      row[at + 2] = 'RIR';
    }
  }
  return fill(row);
}

function exerciseRow(exercise: Exercise, setCount: number): Row {
  const row: Row = [
    exercise.number,
    exercise.name,
    exercise.video ?? '',
    exercise.protocol ?? '',
    exercise.comments ?? '',
    '',
  ];

  const [previousStart, currentStart] = blockStarts(setCount);
  writeSets(row, previousStart!, exercise.previousWeek, setCount);
  writeSets(row, currentStart!, exercise.currentWeek, setCount);

  return fill(row);
}

/** Where the previous-week and current-week blocks begin. */
function blockStarts(setCount: number): [number, number] {
  return [PLAN_COLUMNS, PLAN_COLUMNS + setCount * PER_SET + GAP];
}

function writeSets(row: Row, start: number, sets: readonly SetEntry[], setCount: number): void {
  for (let index = 0; index < setCount; index += 1) {
    const set = sets[index];
    const at = start + index * PER_SET;
    // Empty rather than zero: a blank cell is "not recorded", and 0 kg is a
    // claim the parser would faithfully read back.
    row[at] = set?.weight ?? '';
    row[at + 1] = set?.reps ?? '';
    row[at + 2] = set?.rir ?? '';
  }
}

/** `aoa_to_sheet` writes `undefined` holes as nothing; make them explicit. */
function fill(row: Row): Row {
  for (let index = 0; index < row.length; index += 1) {
    if (row[index] === undefined) row[index] = '';
  }
  return row;
}

/**
 * A filename someone can find again in six months.
 *
 * Stripped of anything a browser or a filesystem would argue about, since it
 * travels in a `Content-Disposition` header.
 */
export function exportFileName(program: Program, on = new Date()): string {
  const base = program.sourceFileName.replace(/\.(xlsx|xlsm)$/i, '').trim() || 'entrenamiento';
  const safe = base.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'entrenamiento';
  return `${safe} — ${on.toISOString().slice(0, 10)}.xlsx`;
}

/** How much training the file actually carries, for the log line. */
export function countWorkedSets(program: Program): number {
  return program.weeks
    .flatMap((week) => week.days)
    .flatMap((day) => day.exercises)
    .flatMap((exercise) => exercise.currentWeek)
    .filter(isSetWorked).length;
}
