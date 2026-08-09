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
}

const EMPTY_CELL: Cell = { value: null, link: null, formula: null };

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

/** Reads a worksheet into a dense grid, so the parser never re-derives addresses. */
export function toGrid(sheet: XLSX.WorkSheet): Grid {
  const ref = sheet['!ref'];
  if (!ref) return [];

  const declared = XLSX.utils.decode_range(ref);
  const range = {
    s: declared.s,
    e: {
      r: Math.min(declared.e.r, declared.s.r + MAX_ROWS - 1),
      c: Math.min(declared.e.c, declared.s.c + MAX_COLS - 1),
    },
  };
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
  return { value, link, formula };
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
  const { value } = cellAt(grid, row, col);
  return toNumber(value);
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
