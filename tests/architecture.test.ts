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
const SERVER = resolve(process.cwd(), 'server');

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

const SERVER_FILES = sourceFiles(SERVER);

describe('server boundaries', () => {
  it('has server files to check', () => {
    expect(SERVER_FILES.length).toBeGreaterThan(5);
  });

  it('never hardcodes a credential or connection string', () => {
    // Everything comes from the environment; a literal here would ship a secret.
    const literalUrl = /postgres(ql)?:\/\/[^'"$\s]*:[^'"$\s]*@/i;
    const offenders = SERVER_FILES.filter((file) => literalUrl.test(code(file)));
    expect(offenders.map((file) => relative(SERVER, file))).toEqual([]);
  });

  it('reads DATABASE_URL only where the connection is created', () => {
    const offenders = SERVER_FILES.filter(
      (file) =>
        /DATABASE_URL/.test(code(file)) &&
        // Entry points only: the server itself and the CLI scripts.
        ![
          'index.ts',
          'scripts\\migrate.ts',
          'scripts\\seed.ts',
          'scripts\\seedDemo.ts',
          'scripts/migrate.ts',
          'scripts/seed.ts',
          'scripts/seedDemo.ts',
        ].includes(relative(SERVER, file)),
    );
    expect(offenders.map((file) => relative(SERVER, file))).toEqual([]);
  });

  it('keeps raw SQL inside db/ and repositories/', () => {
    const sqlKeyword = /\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/;
    const offenders = SERVER_FILES.filter((file) => {
      const location = relative(SERVER, file).replace(/\\/g, '/');
      if (location.startsWith('db/') || location.startsWith('repositories/')) return false;
      return sqlKeyword.test(code(file));
    });
    expect(offenders.map((file) => relative(SERVER, file))).toEqual([]);
  });

  it('never interpolates a request value into SQL', () => {
    // Parameterised queries only: `$1`, `$2`... Template literals carrying a
    // variable into a query string would be an injection waiting to happen.
    const offenders = SERVER_FILES.filter((file) =>
      /(SELECT|INSERT|UPDATE|DELETE)[^`'"]*\$\{/i.test(code(file)),
    );
    expect(offenders.map((file) => relative(SERVER, file))).toEqual([]);
  });

  it('never uses eval or the Function constructor', () => {
    const offenders = [...ALL_FILES, ...SERVER_FILES].filter((file) =>
      /\beval\s*\(|new Function\s*\(/.test(code(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the frontend free of the xlsx bundle — parsing moved server-side', () => {
    const offenders = ALL_FILES.filter((file) => /from\s+['"]xlsx['"]/.test(code(file)));
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });
});

describe('the service worker', () => {
  const worker = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

  /**
   * The one rule that cannot be got wrong.
   *
   * The app keeps its own cache of the program and its own queue of writes,
   * and both assume the API answers with the truth or not at all. A set served
   * from the worker's cache would be a stale number the app has no way to
   * detect — worse than the error it replaced.
   */
  it('never serves the API from cache', () => {
    expect(worker).toMatch(/url\.pathname\.startsWith\('\/api\/'\)/);
    // The bail-out has to come before anything that could respond.
    const bailOut = worker.indexOf("startsWith('/api/')");
    const firstRespond = worker.indexOf('event.respondWith');
    expect(bailOut).toBeGreaterThan(-1);
    expect(bailOut).toBeLessThan(firstRespond);
  });

  it('only handles GET, and only same-origin', () => {
    expect(worker).toMatch(/request\.method !== 'GET'/);
    expect(worker).toMatch(/url\.origin !== self\.location\.origin/);
  });

  it('drops the previous version’s caches on activate', () => {
    // Without this every deploy leaves its assets behind for ever.
    expect(worker).toMatch(/caches\.delete/);
  });

  it('is linked from the page together with the manifest', () => {
    const page = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(page).toMatch(/rel="manifest" href="\/manifest\.webmanifest"/);
    expect(page).toMatch(/rel="apple-touch-icon"/);
  });

  it('declares a manifest the browser can install', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/manifest.webmanifest'), 'utf8'),
    );
    const parsed = manifest as {
      start_url?: string;
      display?: string;
      icons?: { sizes: string; purpose: string }[];
    };

    expect(parsed.start_url).toBe('/');
    expect(parsed.display).toBe('standalone');
    // Android needs a 512 and a maskable one, or it refuses to install.
    expect(parsed.icons?.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual(
      expect.arrayContaining(['512x512 any', '512x512 maskable']),
    );
  });
});

describe('duplicated constants', () => {
  /**
   * `public/theme.js` runs before the bundle to avoid a flash of the wrong
   * theme, so it cannot import anything. That makes the storage key exist in
   * two places, and a silent drift between them would leave the preference
   * saved under one name and read under another.
   */
  it('keeps the theme key identical in the pre-paint script and in storage', () => {
    const script = readFileSync(resolve(process.cwd(), 'public/theme.js'), 'utf8');
    const module = readFileSync(resolve(SRC, 'storage/theme.ts'), 'utf8');

    const keyIn = (source: string) => /'([a-z0-9.]+\.theme\.v\d+)'/.exec(source)?.[1];

    expect(keyIn(script)).toBeDefined();
    expect(keyIn(script)).toBe(keyIn(module));
  });
});
