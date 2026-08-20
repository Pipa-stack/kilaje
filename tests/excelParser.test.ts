/**
 * Parser tests run against the REAL reference workbook in `Ejemplo/`.
 *
 * Synthetic fixtures would only prove the parser agrees with itself. The whole
 * risk here is that the actual file disagrees with our reading of it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as XLSX from 'xlsx';
import { beforeAll, describe, expect, it } from 'vitest';

import { MAX_FILE_BYTES, TemplateError, parseWorkbook, sanitizeUrl } from '../server/parser/excelParser';
import {
  createCellBudget,
  MAX_WORKBOOK_CELLS,
  normalize,
  toGrid,
  toNumber,
} from '../server/parser/cells';
import { exercise1RM, exerciseVolume } from '../src/domain/calculations';
import { TEMPLATE_SET_COUNT, type Program } from '../src/domain/types';

/** The jsdom test environment has no file-scheme `import.meta.url`. */
const REFERENCE_FILE = resolve(process.cwd(), 'Ejemplo/ejemplo.xlsx');

/**
 * A second real template, laid out by a different person: seven `Semana N`
 * sheets, no instructions sheet, four days a week, and reps typed in ways
 * Excel autocorrected. Nothing about the parser is tuned to either file, and
 * this is what proves it.
 */
const SECOND_FILE = resolve(process.cwd(), 'Ejemplo/ejemplo 2.xlsx');

function readReference(): Uint8Array {
  return new Uint8Array(readFileSync(REFERENCE_FILE));
}

function readSecond(): Uint8Array {
  return new Uint8Array(readFileSync(SECOND_FILE));
}

describe('parseWorkbook against the real template', () => {
  let program: Program;

  beforeAll(() => {
    program = parseWorkbook(readReference(), 'ejemplo.xlsx');
  });

  it('records the source file and schema version', () => {
    expect(program.sourceFileName).toBe('ejemplo.xlsx');
    expect(program.schemaVersion).toBe(1);
    expect(Number.isNaN(Date.parse(program.importedAt))).toBe(false);
  });

  it('finds exactly the "Semana 1" sheet and ignores the rest', () => {
    expect(program.weeks).toHaveLength(1);
    expect(program.weeks[0]?.number).toBe(1);
    expect(program.weeks[0]?.sheetName).toBe('Semana 1');
  });

  it('parses the five days that actually have exercises', () => {
    // The template pre-numbers seven day blocks; days 6 and 7 are empty
    // placeholders in this file and are dropped rather than shown as blanks.
    const days = program.weeks[0]?.days ?? [];
    expect(days.map((day) => day.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it('reads each day type from the sheet, tolerating the missing ones', () => {
    const types = program.weeks[0]?.days.map((day) => day.type);
    expect(types).toEqual([
      'PUSH',
      'PULL',
      'LEG (CADENA ANTERIOR)',
      'UPPER',
      'LEG 2 (CADENA POSTERIOR)',
    ]);
  });

  it('keeps only the exercise rows that were filled in', () => {
    const counts = program.weeks[0]?.days.map((day) => day.exercises.length);
    expect(counts).toEqual([7, 7, 7, 7, 7]);
  });

  it('reads exercise names and numbers verbatim, without any hardcoded list', () => {
    const first = program.weeks[0]?.days[0];
    expect(first?.exercises[0]).toMatchObject({
      number: 1,
      name: 'PRESS DE BANCA PLANO CON BARRA LIBRE',
      id: 'w1:d1:e1',
    });
    expect(first?.exercises[6]).toMatchObject({
      number: 7,
      name: 'EXTENSIÓN DE TRÍCEPS UNILATERAL EN POLEA',
    });
  });

  it('reads protocols', () => {
    const first = program.weeks[0]?.days[0]?.exercises[0];
    expect(first?.protocol).toBe('3 SETS X 4-6 / 6-8 / 8-10 REPS (RIR 0)');
  });

  it('reads the data actually seeded in the workbook', () => {
    // Semana 1 / Día 1 / exercise 1 / set 1 = 82.5 kg x 4 reps.
    const set = program.weeks[0]?.days[0]?.exercises[0]?.currentWeek[0];
    expect(set).toEqual({ weight: 82.5, reps: 4, rir: null });
  });

  it('gives every exercise the template\'s four set slots', () => {
    for (const week of program.weeks) {
      for (const day of week.days) {
        for (const exercise of day.exercises) {
          expect(exercise.currentWeek).toHaveLength(TEMPLATE_SET_COUNT);
          expect(exercise.previousWeek).toHaveLength(TEMPLATE_SET_COUNT);
        }
      }
    }
  });

  it('leaves the previous week empty — week 1 has no history', () => {
    const sets = program.weeks[0]?.days.flatMap((day) =>
      day.exercises.flatMap((exercise) => exercise.previousWeek),
    );
    expect(sets?.every((set) => set.weight === null && set.reps === null)).toBe(true);
  });

  it('starts every session uncompleted and without notes', () => {
    // The hint text sitting to the right of the answer cell must NOT be read
    // as a completed session.
    for (const day of program.weeks[0]?.days ?? []) {
      expect(day.completed).toBe(false);
      expect(day.notes).toBe('');
    }
  });

  it('has no video links in this file, and invents none', () => {
    const videos = program.weeks[0]?.days.flatMap((day) =>
      day.exercises.map((exercise) => exercise.video),
    );
    expect(videos?.every((video) => video === null)).toBe(true);
  });

  it('produces ids that are unique and stable', () => {
    const ids = program.weeks.flatMap((week) =>
      week.days.flatMap((day) => day.exercises.map((exercise) => exercise.id)),
    );
    expect(new Set(ids).size).toBe(ids.length);

    const again = parseWorkbook(readReference(), 'ejemplo.xlsx');
    const againIds = again.weeks.flatMap((week) =>
      week.days.flatMap((day) => day.exercises.map((exercise) => exercise.id)),
    );
    expect(againIds).toEqual(ids);
  });

  it('feeds the calculation layer correctly end to end', () => {
    const exercise = program.weeks[0]?.days[0]?.exercises[0];
    expect(exercise).toBeDefined();
    expect(exerciseVolume(exercise!.currentWeek)).toBe(82.5 * 4);
    expect(exercise1RM(exercise!)).toBe(93.5);
  });

  it('recomputes volume instead of importing the workbook\'s broken formulas', () => {
    // Rows 78-82 of the source sheet contain #REF! and off-by-one references.
    // Day 5 must still produce clean, finite numbers.
    const day5 = program.weeks[0]?.days[4];
    for (const exercise of day5?.exercises ?? []) {
      expect(Number.isFinite(exerciseVolume(exercise.currentWeek))).toBe(true);
    }
  });
});

describe('re-importing the same template', () => {
  it('produces an equivalent program, so imports are idempotent', () => {
    const first = parseWorkbook(readReference(), 'a.xlsx');
    const second = parseWorkbook(readReference(), 'b.xlsx');
    expect(second.weeks).toEqual(first.weeks);
  });
});

describe('multi-week workbooks', () => {
  /** Builds a copy of the reference file with `Semana 1` duplicated as `Semana 2`. */
  function withSecondWeek(): Uint8Array {
    const workbook = XLSX.read(readReference(), { type: 'array' });
    const source = workbook.Sheets['Semana 1'];
    expect(source).toBeDefined();
    XLSX.utils.book_append_sheet(workbook, source!, 'Semana 2');
    return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  }

  it('parses every "Semana N" sheet, in order', () => {
    const program = parseWorkbook(withSecondWeek(), 'dos-semanas.xlsx');
    expect(program.weeks.map((week) => week.number)).toEqual([1, 2]);
  });

  it('derives week 2 previous-week data from week 1 when the columns are blank', () => {
    const program = parseWorkbook(withSecondWeek(), 'dos-semanas.xlsx');
    const carried = program.weeks[1]?.days[0]?.exercises[0]?.previousWeek[0];
    expect(carried).toEqual({ weight: 82.5, reps: 4, rir: null });
  });

  it('keeps ids distinct between weeks', () => {
    const program = parseWorkbook(withSecondWeek(), 'dos-semanas.xlsx');
    expect(program.weeks[0]?.days[0]?.exercises[0]?.id).toBe('w1:d1:e1');
    expect(program.weeks[1]?.days[0]?.exercises[0]?.id).toBe('w2:d1:e1');
  });
});

describe('the second real template', () => {
  let program: Program;

  beforeAll(() => {
    program = parseWorkbook(readSecond(), 'ejemplo 2.xlsx');
  });

  it('parses all seven week sheets without an instructions sheet to anchor on', () => {
    expect(program.weeks.map((week) => week.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('reads the four days of each week and their types', () => {
    for (const week of program.weeks) {
      expect(week.days.map((day) => day.number)).toEqual([1, 2, 3, 4]);
    }
    expect(program.weeks[0]?.days.map((day) => day.type)).toEqual([
      'PIERNA (ENFOQUE GLÚTEO)',
      'PARTE DE ARRIBA 1',
      'PIERNA COMPLETA',
      'PARTE DE ARRIBA 2',
    ]);
  });

  it('recovers reps Excel autocorrected into dates', () => {
    // "10-10" — ten per side — was stored as the date 10/10, i.e. 46305.
    const sets = program.weeks[0]?.days[2]?.exercises[0]?.currentWeek ?? [];
    expect(sets.slice(0, 3)).toEqual([
      { weight: 70, reps: 10, rir: null },
      { weight: 70, reps: 10, rir: null },
      { weight: 70, reps: 10, rir: null },
    ]);
  });

  it('leaves no impossible value anywhere in the file', () => {
    // A date serial that slipped through would show up here as thousands of
    // reps, and would poison every volume and 1RM computed from it.
    const sets = program.weeks
      .flatMap((week) => week.days)
      .flatMap((day) => day.exercises)
      .flatMap((exercise) => [...exercise.currentWeek, ...exercise.previousWeek]);

    expect(sets.filter((set) => set.reps !== null && set.reps > 999)).toEqual([]);
    expect(sets.filter((set) => set.weight !== null && set.weight > 1000)).toEqual([]);
  });

  it('carries the work of each week into the next as its reference', () => {
    const first = program.weeks[0]?.days[0]?.exercises[0];
    const second = program.weeks[1]?.days[0]?.exercises[0];
    expect(first?.name).toBe(second?.name);
    expect(second?.previousWeek[0]).toEqual(first?.currentWeek[0]);
  });
});

describe('resilience to hand-edited copies', () => {
  /** Inserts a blank column before column A, shifting the whole sheet right. */
  function shiftedSheet(): Uint8Array {
    const workbook = XLSX.read(readReference(), { type: 'array' });
    const sheet = workbook.Sheets['Semana 1'];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet!, { header: 1, blankrows: true });
    const shifted = rows.map((row) => ['', ...row]);
    workbook.Sheets['Semana 1'] = XLSX.utils.aoa_to_sheet(shifted);
    return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  }

  it('still parses when every column is shifted right', () => {
    const program = parseWorkbook(shiftedSheet(), 'desplazado.xlsx');
    expect(program.weeks[0]?.days).toHaveLength(5);
    expect(program.weeks[0]?.days[0]?.exercises[0]?.name).toBe(
      'PRESS DE BANCA PLANO CON BARRA LIBRE',
    );
    expect(program.weeks[0]?.days[0]?.exercises[0]?.currentWeek[0]).toEqual({
      weight: 82.5,
      reps: 4,
      rir: null,
    });
  });
});

describe('rejecting bad input', () => {
  it('rejects an empty file', () => {
    expect(() => parseWorkbook(new Uint8Array(0), 'vacio.xlsx')).toThrow(TemplateError);
  });

  it('rejects a file above the size limit', () => {
    const oversized = new Uint8Array(MAX_FILE_BYTES + 1);
    expect(() => parseWorkbook(oversized, 'enorme.xlsx')).toThrow(/10 MB/);
  });

  it('rejects bytes that are not a workbook', () => {
    const garbage = new TextEncoder().encode('esto no es un excel'.repeat(20));
    expect(() => parseWorkbook(garbage, 'texto.xlsx')).toThrow(TemplateError);
  });

  it('rejects a valid workbook with no "Semana N" sheet', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['hola']]), 'Otra hoja');
    const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    expect(() => parseWorkbook(bytes, 'otra.xlsx')).toThrow(/Semana N/);
  });
});

describe('sanitizeUrl', () => {
  it('accepts http and https', () => {
    expect(sanitizeUrl('https://youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(sanitizeUrl('http://example.com/v')).toBe('http://example.com/v');
  });

  it('rejects dangerous and relative schemes', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeUrl('mira este video')).toBeNull();
    expect(sanitizeUrl('')).toBeNull();
    expect(sanitizeUrl(null)).toBeNull();
  });
});

describe('cell helpers', () => {
  it('normalizes accents, emoji and case for label matching', () => {
    expect(normalize('📹 Vídeo')).toBe('video');
    expect(normalize('  DÍA   1 ')).toBe('dia 1');
    expect(normalize('← Semana anterior')).toBe('semana anterior');
    expect(normalize('✅ Sesión completada:')).toBe('sesion completada');
  });

  it('reads numbers stored as text, including comma decimals', () => {
    expect(toNumber(82.5)).toBe(82.5);
    expect(toNumber('82.5')).toBe(82.5);
    expect(toNumber('82,5')).toBe(82.5);
    expect(toNumber('')).toBeNull();
    expect(toNumber('  ')).toBeNull();
    expect(toNumber('n/a')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(true)).toBeNull();
  });
});

describe('a sheet that lies about its own size', () => {
  it('reads a bounded window instead of the range the file declares', () => {
    // `!ref` comes from the <dimension> element of the sheet XML, which the
    // uploader controls and SheetJS reports verbatim. Declaring the full Excel
    // canvas asks the dense grid for ~17 thousand million cells: the heap dies
    // and the single Node thread stops serving everyone. A tiny file is enough.
    const sheet: XLSX.WorkSheet = { '!ref': 'A1:XFD1048576', A1: { t: 's', v: 'hola' } };

    const started = Date.now();
    const grid = toGrid(sheet);
    const elapsed = Date.now() - started;

    expect(grid.length).toBeLessThanOrEqual(5_000);
    expect(grid[0]?.length).toBeLessThanOrEqual(200);
    expect(grid[0]?.[0]?.value).toBe('hola');
    expect(elapsed).toBeLessThan(5_000);
  });

  it('still reads a sheet smaller than the cap in full', () => {
    const sheet: XLSX.WorkSheet = { '!ref': 'A1:B2', B2: { t: 'n', v: 42 } };
    const grid = toGrid(sheet);
    expect(grid).toHaveLength(2);
    expect(grid[1]?.[1]?.value).toBe(42);
  });
});


describe('a workbook that lies about how much of it there is', () => {
  /**
   * `n` sheets named "Semana i".
   *
   * Deliberately small sheets: SheetJS *writes* the whole declared range, so
   * building the real attack file here would hang the test rather than the
   * server. What this checks is the other half of the attack — the number of
   * sheets — and the budget test below covers the size of each one.
   */
  function manySheets(count: number): Uint8Array {
    const workbook = XLSX.utils.book_new();
    for (let index = 1; index <= count; index += 1) {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([['DÍA 1', 'PUSH'], ['Nº', 'Ejercicio']]),
        `Semana ${index}`,
      );
    }
    return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  }

  it('reads at most 52 week sheets, whatever the file contains', () => {
    // A sheet costs ~550 bytes in the upload and, if it declares the full
    // Excel canvas, ~0.9 s of blocked event loop to read. Thousands of them
    // fit under the 10 MB limit, which turned one upload into an hour of a
    // completely unresponsive server.
    const bytes = manySheets(300);
    expect(bytes.byteLength).toBeLessThan(MAX_FILE_BYTES);

    // No exercise rows, so nothing parses — the point is that it gave up
    // early instead of walking three hundred grids.
    const started = Date.now();
    expect(() => parseWorkbook(bytes, 'muchas-hojas.xlsx')).toThrow(TemplateError);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);

  it('spends one cell budget across sheets instead of a fresh one per sheet', () => {
    const budget = createCellBudget(1_000);
    const sheet: XLSX.WorkSheet = { '!ref': 'A1:J1048576', A1: { t: 's', v: 'x' } };

    const first = toGrid(sheet, budget);
    const second = toGrid(sheet, budget);

    expect(first).toHaveLength(100); // 1000 cells / 10 columns
    expect(second).toHaveLength(0); // nothing left to spend
    expect(budget.remaining).toBeLessThanOrEqual(0);
  });

  it('leaves a real workbook far below the ceiling', () => {
    const program = parseWorkbook(readSecond(), 'ejemplo 2.xlsx');
    expect(program.weeks).toHaveLength(7);
    expect(MAX_WORKBOOK_CELLS).toBeGreaterThan(7 * 1000 * 40);
  });
});

describe('a workbook that unzips to far more than it weighs', () => {
  it('refuses an archive whose entries claim an absurd inflated size', () => {
    // The 10 MB limit measures compressed bytes; SheetJS inflates eagerly.
    // Here the central directory is edited to claim each entry inflates to
    // 40 MB, which is what an ordinary zip bomb looks like from outside.
    const honest = Buffer.from(readReference());
    const eocd = honest.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocd).toBeGreaterThan(-1);

    const entries = honest.readUInt16LE(eocd + 10);
    let offset = honest.readUInt32LE(eocd + 16);
    for (let index = 0; index < entries; index += 1) {
      honest.writeUInt32LE(40 * 1024 * 1024, offset + 24);
      offset +=
        46 +
        honest.readUInt16LE(offset + 28) +
        honest.readUInt16LE(offset + 30) +
        honest.readUInt16LE(offset + 32);
    }

    expect(() => parseWorkbook(new Uint8Array(honest), 'bomba.xlsx')).toThrow(
      /se descomprime/i,
    );
  });

  it('lets an ordinary workbook through untouched', () => {
    expect(() => parseWorkbook(readReference(), 'ejemplo.xlsx')).not.toThrow();
  });
});
