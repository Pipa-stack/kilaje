/**
 * `npm run db:seed:demo`
 *
 * Creates — or repairs — the account for trying the app out, and prints the
 * credentials to sign in with. Safe to run as many times as you like.
 *
 * Credentials come from `DEMO_EMAIL` / `DEMO_PASSWORD` when they are set. The
 * server can do the same on every boot with `DEMO_ACCOUNT=true`.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPostgresDatabase } from '../db/database';
import { migrate } from '../db/migrate';
import { DEFAULT_DEMO_PASSWORD, seedDemoAccount } from '../db/demoAccount';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Falta DATABASE_URL.');
    process.exit(1);
  }

  const password = process.env.DEMO_PASSWORD;
  const db = createPostgresDatabase(connectionString);
  try {
    await migrate(db);
    const result = await seedDemoAccount(db, {
      email: process.env.DEMO_EMAIL,
      password,
      workbookPath: process.env.SEED_WORKBOOK ?? join(ROOT, 'Ejemplo/ejemplo.xlsx'),
    });

    console.log(`Cuenta de prueba: ${result.account}, programa: ${result.program}`);
    console.log(`  correo:     ${result.email}`);
    console.log(`  contraseña: ${password ?? DEFAULT_DEMO_PASSWORD}`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('Fallo creando la cuenta de prueba:', error);
  process.exit(1);
});
