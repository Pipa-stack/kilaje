/**
 * Optional seed: imports the reference workbook so the app has something to
 * show on a fresh database without anyone having to upload a file first.
 *
 * It is idempotent through the same `source_hash` check that guards the
 * import endpoint, and it only contains exercise names and protocols — no
 * personal data.
 */

import { readFileSync } from 'node:fs';

import { parseWorkbook } from '../parser/excelParser';
import type { Database } from './database';
import { hashSource, importProgram, listPrograms } from '../repositories/programs';

export type SeedOutcome =
  | 'importado'
  | 'ya existía'
  | 'omitido: ya hay programas'
  | 'omitido: no se encuentra el archivo';

/**
 * @param onlyWhenEmpty Skip when the database already holds programs, so a
 *   redeploy cannot bury the user's own imports under the sample plan.
 */
export async function seedReferenceProgram(
  db: Database,
  workbookPath: string,
  onlyWhenEmpty = true,
): Promise<SeedOutcome> {
  if (onlyWhenEmpty) {
    const existing = await listPrograms(db);
    if (existing.length > 0) return 'omitido: ya hay programas';
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(workbookPath));
  } catch {
    return 'omitido: no se encuentra el archivo';
  }

  const parsed = parseWorkbook(bytes, 'ejemplo.xlsx');
  const { created } = await importProgram(db, parsed, hashSource(bytes));
  return created ? 'importado' : 'ya existía';
}
