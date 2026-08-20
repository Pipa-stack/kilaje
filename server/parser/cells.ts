/**
 * Low-level spreadsheet access helpers.
 *
 * This file and `excelParser.ts` are the ONLY places allowed to know about
 * rows, columns and cell addresses (see SPEC.md §5).
 */

import * as XLSX from 'xlsx';

/** A single cell reduced to what the parser cares about. */
export interface Cell {
  /** Raw value: number, string, boolean, or null when the cell is empty. */
  value: string | number | boolean | null;
  /** Hyperlink target, if the cell carries one. */
  link: string | null;
  /** Original formula text, if any. Kept only to recover `HYPERLINK()` URLs. */
  formula: string | null;
  /** The cell's number format, when it has one. Used to spot mangled dates. */
  format: string | null;
}

const EMPTY_CELL: Cell = { value: null, link: null, formula: null, format: null };

/** A worksheet as a dense 0-indexed `grid[row][col]` of {@link Cell}. */
export type Grid = Cell[][];

/**
 * How much of a sheet is ever read, whatever its declared size.
 *
 * The grid is dense, and the range comes from the `<dimension>` element of the
 * sheet XML — a number the uploader controls, which SheetJS reports verbatim
 * without checking it against the cells that actually exist. A 1.5 kB file can
 * declare the full Excel canvas (1048576 x 16384) and ask this loop for
 * seventeen thousand million cells, which exhausts the heap and blocks the
 * single Node thread for everyone.
 *
 * So the declared range is a request, not an instruction. These bounds are far
 * beyond any real training template: the reference workbook is under 200 rows.
 */
const MAX_ROWS = 5_000;
const MAX_COLS = 200;

/**
 * How many cells the whole workbook may cost, across every sheet.
 *
 * The per-sheet cap above bounds one grid at a million cells. It says nothing
 * about how many grids, and a `.xlsx` costs about 550 bytes per worksheet: a
 * 2.7 MB upload can carry five thousand sheets, each declaring the full Excel
 * canvas, and each one is a synchronous million-cell allocation on the single
 * thread that serves everybody. Measured at ~0.86 s per sheet, that is over an
 * hour of a completely blocked event loop from one request that passes every
 * size check in the codebase.
 *
 * Two million is ten times the largest real template and bounds the worst case
 * at a couple of seconds.
 */
export const MAX_WORKBOOK_CELLS = 2_000_000;

/** Cells still available to a workbook being parsed. Mutable on purpose. */
export interface CellBudget {
  remaining: number;
}

export function createCellBudget(total = MAX_WORKBOOK_CELLS): CellBudget {
  return { remaining: total };
}

/**
 * Reads a worksheet into a dense grid, so the parser never re-derives addresses.
 *
 * @param budget Shared across every sheet of one workbook. A sheet is trimmed
 *   to what is left rather than refused, so a legitimate file whose last sheet
 *   overruns still parses everything before it.
 */
export function toGrid(sheet: XLSX.WorkSheet, budget?: CellBudget): Grid {
  const ref = sheet['!ref'];
  if (!ref) return [];

  const declared = XLSX.utils.decode_range(ref);
  const columns = Math.min(declared.e.c, declared.s.c + MAX_COLS - 1) - declared.s.c + 1;
  const affordableRows =
    budget === undefined || columns <= 0
      ? MAX_ROWS
      : Math.max(0, Math.min(MAX_ROWS, Math.floor(budget.remaining / columns)));

  const range = {
    s: declared.s,
    e: {
      r: Math.min(declared.e.r, declared.s.r + affordableRows - 1),
      c: Math.min(declared.e.c, declared.s.c + MAX_COLS - 1),
    },
  };

  if (budget) {
    const rows = Math.max(0, range.e.r - range.s.r + 1);
    budget.remaining -= rows * columns;
  }
  const grid: Grid = [];

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const cells: Cell[] = [];
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const raw = sheet[XLSX.utils.encode_cell({ r: row, c: col })] as XLSX.CellObject | undefined;
      cells.push(raw ? readCell(raw) : EMPTY_CELL);
    }
    grid.push(cells);
  }

  return grid;
}

function readCell(raw: XLSX.CellObject): Cell {
  const value = raw.v === undefined || raw.v === null ? null : normalizeRaw(raw.v);
  const link = typeof raw.l?.Target === 'string' ? raw.l.Target : null;
  const formula = typeof raw.f === 'string' ? raw.f : null;
  const format = typeof raw.z === 'string' ? raw.z : null;
  return { value, link, formula, format };
}

function normalizeRaw(value: XLSX.CellObject['v']): string | number | boolean | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  return null;
}

/** The cell at `(row, col)`, or an empty cell when out of bounds. */
export function cellAt(grid: Grid, row: number, col: number): Cell {
  return grid[row]?.[col] ?? EMPTY_CELL;
}

/** Trimmed text of a cell. Empty string when the cell has no content. */
export function text(grid: Grid, row: number, col: number): string {
  const { value } = cellAt(grid, row, col);
  if (value === null || value === false) return '';
  return String(value).trim();
}

/**
 * Numeric value of a cell, or `null` when blank or non-numeric.
 *
 * Templates in the wild store the same column as numbers in some rows and as
 * text in others, so text that looks like a number is accepted. A comma is
 * treated as a decimal separator, which is how Spanish-locale sheets export.
 */
export function numberAt(grid: Grid, row: number, col: number): number | null {
  const cell = cellAt(grid, row, col);
  return recoverMangledDate(cell) ?? toNumber(cell.value);
}

/**
 * Undoes Excel's autocorrect on a rep count.
 *
 * Typing "10-10" into a reps cell — ten per side — is silently turned into the
 * date 10/10 and stored as a serial number, so the app read 46305 reps and
 * every volume and 1RM built on it went with it. The cell still carries its
 * date format, which is what gives the mangling away.
 *
 * The number the user typed first is recovered: the day for a `d/m` format,
 * the month for `m/d`. Nothing else in a training template is legitimately a
 * date, so a date-formatted number is always this bug rather than data.
 */
export function recoverMangledDate(cell: Cell): number | null {
  if (typeof cell.value !== 'number' || !Number.isFinite(cell.value)) return null;

  const order = dateFieldOrder(cell.format);
  if (order === null) return null;

  const parsed = XLSX.SSF.parse_date_code(cell.value) as { d?: number; m?: number } | null;
  if (!parsed) return null;

  const first = order === 'month-first' ? parsed.m : parsed.d;
  return typeof first === 'number' && Number.isFinite(first) ? first : null;
}

/**
 * Whether a number format is a date one, and which field it prints first.
 *
 * Literals (`"kg"`, `\-`) and condition blocks (`[Red]`, `[$-C0A]`) are
 * stripped before looking for field codes, so `#,##0" kg"` is not mistaken for
 * a format containing a day.
 */
function dateFieldOrder(format: string | null): 'day-first' | 'month-first' | null {
  if (!format) return null;

  const codes = format
    .replace(/\[[^\]]*\]/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .toLowerCase();

  // A year or a day is what makes it a date; `m` alone is minutes.
  if (!/[dy]/.test(codes)) return null;

  const day = codes.indexOf('d');
  const month = codes.indexOf('m');
  if (day === -1) return null;
  return month !== -1 && month < day ? 'month-first' : 'day-first';
}

export function toNumber(value: string | number | boolean | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const cleaned = value.trim().replace(',', '.');
  if (cleaned === '') return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Case- and accent-insensitive comparison key.
 *
 * The template's labels carry emoji, accents and stray whitespace ("📹 Vídeo",
 * "Nº", "DÍA 1"), and hand-edited copies vary. Normalizing once keeps every
 * label match in the parser readable.
 */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Normalized text of a cell — the usual way the parser reads a label. */
export function label(grid: Grid, row: number, col: number): string {
  return normalize(text(grid, row, col));
}

/** Index of the first column in `row` whose normalized text matches. */
export function findColumn(
  grid: Grid,
  row: number,
  predicate: (labelText: string) => boolean,
): number | null {
  const cells = grid[row];
  if (!cells) return null;

  for (let col = 0; col < cells.length; col += 1) {
    const value = label(grid, row, col);
    if (value !== '' && predicate(value)) return col;
  }
  return null;
}

/** True when no cell in the row holds any content. */
export function isRowEmpty(grid: Grid, row: number): boolean {
  const cells = grid[row];
  if (!cells) return true;
  return cells.every((cell) => cell.value === null || String(cell.value).trim() === '');
}
