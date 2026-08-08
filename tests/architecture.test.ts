/**
 * Executable version of the architecture rule in SPEC.md §5.
 *
 * The value of this project is that the UI survives a change to the
 * spreadsheet layout. That only holds while cell knowledge stays inside the
 * parser, so the boundary is asserted rather than documented.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const ALL_FILES = sourceFiles(SRC);
const OUTSIDE_PARSER = ALL_FILES.filter((file) => !relative(SRC, file).startsWith('parser'));

/** Reads a file with comments stripped — prose about a rule is not a breach of it. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('layer boundaries', () => {
  it('has files to check', () => {
    expect(OUTSIDE_PARSER.length).toBeGreaterThan(5);
  });

  it('keeps spreadsheet cell addressing inside src/parser', () => {
    // e.g. "AK5", "X12" used as a cell reference.
    const cellReference = /['"`][A-Z]{1,2}\d{1,4}['"`]/;
    const offenders = OUTSIDE_PARSER.filter((file) => cellReference.test(code(file)));
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('keeps the xlsx dependency inside src/parser', () => {
    const offenders = OUTSIDE_PARSER.filter((file) =>
      /from\s+['"]xlsx['"]/.test(code(file)),
    );
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('keeps localStorage access inside src/storage', () => {
    const offenders = ALL_FILES.filter(
      (file) =>
        !relative(SRC, file).startsWith('storage') &&
        /localStorage/.test(code(file)),
    );
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('keeps React out of the domain, parser and storage layers', () => {
    const offenders = ALL_FILES.filter(
      (file) =>
        /^(domain|parser|storage)/.test(relative(SRC, file)) &&
        /from\s+['"]react['"]/.test(code(file)),
    );
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('never injects raw HTML from the spreadsheet', () => {
    const offenders = ALL_FILES.filter((file) =>
      /dangerouslySetInnerHTML/.test(code(file)),
    );
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('never hardcodes an exercise name', () => {
    // A regression here would mean the parser stopped being template-driven.
    const suspicious = /PRESS DE BANCA|SENTADILLA|DOMINADAS|CURL DE B/i;
    const offenders = ALL_FILES.filter((file) => suspicious.test(code(file)));
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });
});
