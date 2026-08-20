/**
 * Excel template → normalized {@link Program}.
 *
 * The template is fixed, but its rows and columns are not addressed directly:
 * every anchor is a **text label** found in the sheet ("DÍA 3", "Protocolo",
 * "S1 Peso", "VOLUMEN TOTAL"…). A hand-edited copy with an inserted column or
 * an extra blank row still parses. No exercise or day name is ever hardcoded.
 *
 * Formulas in the source file are deliberately ignored — the app recomputes
 * every derived number from `src/domain/calculations.ts`. The reference file
 * contains genuinely broken volume formulas (`#REF!`, off-by-one row
 * references), and recomputing fixes them instead of importing the bug.
 */

import * as XLSX from 'xlsx';

import { MAX_FILE_BYTES, TemplateError } from '../../src/domain/upload';
import {
  SCHEMA_VERSION,
  TEMPLATE_SET_COUNT,
  emptySet,
  emptySets,
  isSetEmpty,
  type Day,
  type Exercise,
  type Program,
  type SetEntry,
  type Week,
} from '../../src/domain/types';
import {
  cellAt,
  createCellBudget,
  findColumn,
  label,
  normalize,
  numberAt,
  text,
  toGrid,
  toNumber,
  type CellBudget,
  type Grid,
} from './cells';
import { assertInflatedSizeIsSane } from './zipGuard';

export { MAX_FILE_BYTES, TemplateError } from '../../src/domain/upload';

// The parser now runs only on the server: uploads are posted as raw bytes and
// turned into a program here, so the database is never given a model built by
// the browser, and SheetJS stays out of the client bundle entirely.

/** How far below a day header we will look for its table headers. */
const HEADER_SEARCH_DEPTH = 5;

/** Guards against a malformed sheet producing an unbounded exercise list. */
const MAX_EXERCISE_ROWS = 200;

/**
 * How many `Semana N` sheets are worth reading.
 *
 * A mesocycle is weeks, not hundreds of them, and every extra sheet is another
 * dense grid allocated on the thread that serves every other request. Fifty-two
 * matches the ceiling the app puts on weeks it creates itself.
 */
const MAX_WEEK_SHEETS = 52;

const WEEK_SHEET = /^\s*semana\s*(\d+)\s*$/;
const DAY_HEADER = /^dia\s*(\d+)\b/;

/**
 * Parses an uploaded workbook.
 *
 * @param data Raw bytes of the `.xlsx` file.
 * @param sourceFileName Name shown back to the user; not trusted for anything else.
 * @throws {TemplateError} when no `Semana N` sheet with day blocks is found.
 */
export function parseWorkbook(data: ArrayBuffer | Uint8Array, sourceFileName: string): Program {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (bytes.byteLength === 0) {
    throw new TemplateError('El archivo está vacío.');
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new TemplateError('El archivo supera el límite de 10 MB.');
  }

  // Before SheetJS sees it: a zip that inflates to gigabytes is refused unread.
  assertInflatedSizeIsSane(bytes);

  const workbook = readWorkbook(bytes);

  // One budget for the whole file, spent sheet by sheet. Without it the
  // per-sheet cap bounds each grid and nothing bounds their number.
  const budget = createCellBudget();

  const weeks = findWeekSheets(workbook)
    .slice(0, MAX_WEEK_SHEETS)
    .map(({ sheetName, weekNumber }) => parseWeek(workbook, sheetName, weekNumber, budget))
    .filter((week): week is Week => week !== null)
    .sort((a, b) => a.number - b.number);

  if (weeks.length === 0) {
    throw new TemplateError(
      'No se ha encontrado ninguna hoja "Semana N" con días de entrenamiento. ' +
        '¿Es la plantilla correcta?',
    );
  }

  derivePreviousWeeks(weeks);

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceFileName,
    importedAt: new Date().toISOString(),
    weeks,
  };
}

function readWorkbook(bytes: Uint8Array): XLSX.WorkBook {
  try {
    return XLSX.read(bytes, {
      type: 'array',
      // Values and hyperlinks only. Formulas are read as text for HYPERLINK()
      // recovery and never evaluated.
      cellFormula: true,
      cellHTML: false,
      cellStyles: false,
      cellDates: false,
      // Keeps each cell's number format, which is the only trace left of a
      // reps entry Excel autocorrected into a date. See `recoverMangledDate`.
      cellNF: true,
    });
  } catch {
    throw new TemplateError('No se ha podido leer el archivo. ¿Es un .xlsx válido?');
  }
}

interface WeekSheet {
  sheetName: string;
  weekNumber: number;
}

/** Every worksheet named `Semana <n>`, in ascending week order. */
function findWeekSheets(workbook: XLSX.WorkBook): WeekSheet[] {
  const sheets: WeekSheet[] = [];

  for (const sheetName of workbook.SheetNames) {
    const match = WEEK_SHEET.exec(normalize(sheetName));
    const weekNumber = match?.[1] ? Number.parseInt(match[1], 10) : NaN;
    if (Number.isFinite(weekNumber)) sheets.push({ sheetName, weekNumber });
  }

  return sheets.sort((a, b) => a.weekNumber - b.weekNumber);
}

function parseWeek(
  workbook: XLSX.WorkBook,
  sheetName: string,
  weekNumber: number,
  budget: CellBudget,
): Week | null {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;

  const grid = toGrid(sheet, budget);
  const days: Day[] = [];

  for (let row = 0; row < grid.length; row += 1) {
    const dayNumber = matchDayHeader(grid, row);
    if (dayNumber === null) continue;

    const day = parseDay(grid, row, weekNumber, dayNumber);
    if (day) days.push(day);
  }

  return days.length > 0 ? { number: weekNumber, sheetName, days } : null;
}

/** The day number when `row` is a "DÍA n" header row, else `null`. */
function matchDayHeader(grid: Grid, row: number): number | null {
  const cells = grid[row];
  if (!cells) return null;

  // The header is in the first few columns; scanning them all would match
  // stray prose elsewhere in the sheet.
  for (let col = 0; col < Math.min(cells.length, 4); col += 1) {
    const match = DAY_HEADER.exec(label(grid, row, col));
    if (match?.[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/** Column layout of one day block, resolved from its header labels. */
interface DayColumns {
  headerRow: number;
  setsRow: number;
  number: number;
  name: number;
  video: number | null;
  protocol: number | null;
  comments: number | null;
  previousSets: SetColumns[];
  currentSets: SetColumns[];
}

interface SetColumns {
  weight: number;
  reps: number;
  rir: number | null;
}

function parseDay(grid: Grid, headerRow: number, weekNumber: number, dayNumber: number): Day | null {
  const columns = resolveColumns(grid, headerRow);
  if (!columns) return null;

  const dayId = `w${weekNumber}:d${dayNumber}`;
  const exercises: Exercise[] = [];

  let row = columns.setsRow + 1;
  const limit = Math.min(grid.length, row + MAX_EXERCISE_ROWS);
  let summaryRow: number | null = null;

  for (; row < limit; row += 1) {
    if (isSummaryRow(grid, row)) {
      summaryRow = row;
      break;
    }
    // Another day starting means this block had no summary row.
    if (matchDayHeader(grid, row) !== null) break;

    const exercise = parseExercise(grid, row, columns, dayId, dayNumber);
    if (exercise) exercises.push(exercise);
  }

  // Ids key the merge on re-import, so a hand-edited sheet with a repeated
  // exercise number must not collapse two exercises into one.
  deduplicateIds(exercises);

  // Days the template pre-numbered but the user never filled in.
  if (exercises.length === 0) return null;

  // Notes and the completion flag live in the rows just after the summary. If
  // there was no summary row the block is malformed; skip the trailer rather
  // than read into whatever follows.
  const trailer =
    summaryRow === null
      ? null
      : { start: summaryRow + 1, end: Math.min(grid.length, summaryRow + 6) };

  return {
    id: dayId,
    number: dayNumber,
    type: readDayType(grid, headerRow),
    exercises,
    notes: trailer ? readTrailerText(grid, trailer.start, trailer.end, /^notas/) : '',
    completed: trailer ? readCompleted(grid, trailer.start, trailer.end) : false,
  };
}

/**
 * Finds the table-header row and the set sub-header row below a day header,
 * then maps every column the app needs.
 */
function resolveColumns(grid: Grid, dayHeaderRow: number): DayColumns | null {
  for (let row = dayHeaderRow + 1; row < dayHeaderRow + 1 + HEADER_SEARCH_DEPTH; row += 1) {
    const nameCol = findColumn(grid, row, (value) => value.startsWith('ejercic'));
    if (nameCol === null) continue;

    const numberCol = findColumn(grid, row, (value) => value === 'n' || value === 'nº' || value === 'no');
    const setsRow = row + 1;
    const { previousSets, currentSets } = resolveSetColumns(grid, row, setsRow);
    if (currentSets.length === 0) continue;

    return {
      headerRow: row,
      setsRow,
      number: numberCol ?? Math.max(nameCol - 1, 0),
      name: nameCol,
      video: findColumn(grid, row, (value) => value.includes('video')),
      protocol: findColumn(grid, row, (value) => value.includes('protocolo')),
      comments: findColumn(grid, row, (value) => value.startsWith('comentario')),
      previousSets,
      currentSets,
    };
  }

  return null;
}

/**
 * Maps the `S1 Peso | S1 Reps | RIR | S2 Peso | …` sub-header into set columns,
 * splitting them into the previous-week and current-week blocks announced by
 * the "← Semana anterior" / "Semana actual" banners on the header row.
 */
function resolveSetColumns(
  grid: Grid,
  headerRow: number,
  setsRow: number,
): { previousSets: SetColumns[]; currentSets: SetColumns[] } {
  const previousBanner = findColumn(grid, headerRow, (value) => value.includes('semana anterior'));
  const currentBanner = findColumn(grid, headerRow, (value) => value.includes('semana actual'));

  const groups: SetColumns[] = [];
  const cells = grid[setsRow] ?? [];

  for (let col = 0; col < cells.length; col += 1) {
    const value = label(grid, setsRow, col);
    if (/^s\d+\s*peso$/.test(value)) {
      groups.push({ weight: col, reps: -1, rir: null });
      continue;
    }

    const current = groups.at(-1);
    if (!current) continue;
    if (current.reps === -1 && /^s\d+\s*reps$/.test(value)) {
      current.reps = col;
    } else if (current.reps !== -1 && current.rir === null && value === 'rir') {
      current.rir = col;
    }
  }

  const complete = groups.filter((group) => group.reps !== -1);

  // Without banners we cannot tell the blocks apart; treat everything as the
  // current week rather than silently dropping half the data.
  if (currentBanner === null) return { previousSets: [], currentSets: complete };

  const previousSets = complete.filter(
    (group) => group.weight < currentBanner && (previousBanner === null || group.weight >= previousBanner),
  );
  const currentSets = complete.filter((group) => group.weight >= currentBanner);

  return { previousSets, currentSets };
}

function parseExercise(
  grid: Grid,
  row: number,
  columns: DayColumns,
  dayId: string,
  dayNumber: number,
): Exercise | null {
  const name = text(grid, row, columns.name);
  const currentWeek = readSets(grid, row, columns.currentSets);
  const previousWeek = readSets(grid, row, columns.previousSets);

  // The template pre-numbers ten rows per day; unused ones carry only a number.
  const hasData =
    currentWeek.some((set) => !isSetEmpty(set)) || previousWeek.some((set) => !isSetEmpty(set));
  if (name === '' && !hasData) return null;

  const number = numberAt(grid, row, columns.number) ?? row;

  return {
    id: `${dayId}:e${number}`,
    // Position within the day, which is exactly how `derivePreviousWeeks`
    // already pairs an exercise with its counterpart a week earlier.
    lineage: `d${dayNumber}:e${number}`,
    number,
    name,
    video: readVideo(grid, row, columns.video),
    protocol: readOptionalText(grid, row, columns.protocol),
    comments: readOptionalText(grid, row, columns.comments),
    previousWeek: padSets(previousWeek),
    currentWeek: padSets(currentWeek),
  };
}

function deduplicateIds(exercises: Exercise[]): void {
  const seen = new Set<string>();
  for (const exercise of exercises) {
    let candidate = exercise.id;
    let suffix = 2;
    while (seen.has(candidate)) {
      candidate = `${exercise.id}#${suffix}`;
      suffix += 1;
    }
    exercise.id = candidate;
    seen.add(candidate);
  }
}

function readSets(grid: Grid, row: number, columns: readonly SetColumns[]): SetEntry[] {
  return columns.map((group) => ({
    weight: numberAt(grid, row, group.weight),
    reps: numberAt(grid, row, group.reps),
    rir: group.rir === null ? null : numberAt(grid, row, group.rir),
  }));
}

/** Guarantees the template's four slots so the UI never has to special-case. */
function padSets(sets: SetEntry[]): SetEntry[] {
  if (sets.length >= TEMPLATE_SET_COUNT) return sets;
  return [...sets, ...emptySets(TEMPLATE_SET_COUNT - sets.length)];
}

function readOptionalText(grid: Grid, row: number, col: number | null): string | null {
  if (col === null) return null;
  const value = text(grid, row, col);
  return value === '' ? null : value;
}

/**
 * A video may arrive as a real hyperlink, as a `HYPERLINK()` formula, or as a
 * bare URL typed into the cell. Only `http(s)` survives — the cell is
 * untrusted input that ends up in an `href`.
 */
function readVideo(grid: Grid, row: number, col: number | null): string | null {
  if (col === null) return null;

  const cell = cellAt(grid, row, col);
  const candidates = [cell.link, extractHyperlinkFormula(cell.formula), text(grid, row, col)];

  for (const candidate of candidates) {
    const safe = sanitizeUrl(candidate);
    if (safe) return safe;
  }
  return null;
}

function extractHyperlinkFormula(formula: string | null): string | null {
  if (!formula) return null;
  const match = /HYPERLINK\s*\(\s*"([^"]+)"/i.exec(formula);
  return match?.[1] ?? null;
}

/** Accepts only absolute http(s) URLs; blocks `javascript:`, `data:`, etc. */
export function sanitizeUrl(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function isSummaryRow(grid: Grid, row: number): boolean {
  const cells = grid[row];
  if (!cells) return true;
  for (let col = 0; col < Math.min(cells.length, 4); col += 1) {
    if (label(grid, row, col).startsWith('volumen total')) return true;
  }
  return false;
}

/** Session type, e.g. "PUSH" — the first text to the right of "DÍA n". */
function readDayType(grid: Grid, dayHeaderRow: number): string | null {
  const cells = grid[dayHeaderRow] ?? [];
  let seenDayLabel = false;

  for (let col = 0; col < cells.length; col += 1) {
    const value = text(grid, dayHeaderRow, col);
    if (value === '') continue;
    if (!seenDayLabel) {
      seenDayLabel = DAY_HEADER.test(normalize(value));
      continue;
    }
    return value;
  }
  return null;
}

/**
 * Reads a labelled value from the rows trailing a day block ("Notas de
 * sesión:", "Sesión completada:"): find the label, return the first non-empty
 * cell to its right.
 */
function findTrailerValue(
  grid: Grid,
  start: number,
  end: number,
  labelPattern: RegExp,
): { row: number; col: number } | null {
  for (let row = start; row < end; row += 1) {
    const labelCol = findColumn(grid, row, (value) => labelPattern.test(value));
    if (labelCol === null) continue;

    const cells = grid[row] ?? [];
    for (let col = labelCol + 1; col < cells.length; col += 1) {
      if (text(grid, row, col) !== '') return { row, col };
    }
    return null;
  }
  return null;
}

function readTrailerText(grid: Grid, start: number, end: number, labelPattern: RegExp): string {
  const found = findTrailerValue(grid, start, end, labelPattern);
  return found ? text(grid, found.row, found.col) : '';
}

const AFFIRMATIVE = new Set(['si', 'sí', 'yes', 'true', 'x', 'ok', 'v', '1', 'hecho', 'completada']);

/**
 * The template puts a hint ("← Selecciona SI al terminar el día") to the right
 * of the answer cell, so presence of text is not enough — only an explicit
 * affirmative counts as completed.
 */
function readCompleted(grid: Grid, start: number, end: number): boolean {
  const found = findTrailerValue(grid, start, end, /^sesion completada/);
  if (!found) return false;

  const cell = cellAt(grid, found.row, found.col);
  if (typeof cell.value === 'boolean') return cell.value;
  if (toNumber(cell.value) === 1) return true;

  return AFFIRMATIVE.has(text(grid, found.row, found.col).toLowerCase());
}

/**
 * Fills each week's previous-week columns from the week before it.
 *
 * The template expects the user to copy last week's results across by hand
 * (see the "Instrucciones" sheet). When they haven't, we derive it, matching
 * exercises by their position number within the day.
 */
function derivePreviousWeeks(weeks: Week[]): void {
  for (let index = 1; index < weeks.length; index += 1) {
    const week = weeks[index];
    const earlier = weeks[index - 1];
    if (!week || !earlier) continue;

    for (const day of week.days) {
      const source = earlier.days.find((candidate) => candidate.number === day.number);
      if (!source) continue;

      for (const exercise of day.exercises) {
        if (exercise.previousWeek.some((set) => !isSetEmpty(set))) continue;

        const previous = source.exercises.find((candidate) => candidate.number === exercise.number);
        if (!previous) continue;

        exercise.previousWeek = previous.currentWeek
          .slice(0, TEMPLATE_SET_COUNT)
          .map((set) => ({ ...set }));
        while (exercise.previousWeek.length < TEMPLATE_SET_COUNT) {
          exercise.previousWeek.push(emptySet());
        }
      }
    }
  }
}
