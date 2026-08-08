/**
 * `npm run db:seed`
 *
 * Imports the reference workbook so a fresh database has a program to show.
 * Skips silently when programs already exist, unless `--force` is passed.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPostgresDatabase } from '../db/database';
import { migrate } from '../db/migrate';
import { seedReferenceProgram } from '../db/seed';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Falta DATABASE_URL.');
    process.exit(1);
  }

  const workbook = process.env.SEED_WORKBOOK ?? join(ROOT, 'Ejemplo/ejemplo.xlsx');
  const force = process.argv.includes('--force');

  const db = createPostgresDatabase(connectionString);
  try {
    await migrate(db);
    console.log(await seedReferenceProgram(db, workbook, !force));
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('Fallo en el seed:', error);
  process.exit(1);
});
