/**
 * `npm run db:migrate`
 *
 * Applies pending migrations against `DATABASE_URL`. Safe to run repeatedly;
 * the server also runs this on boot, so a deploy never needs it manually.
 */

import { createPostgresDatabase } from '../db/database';
import { migrate } from '../db/migrate';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Falta DATABASE_URL.');
    process.exit(1);
  }

  const db = createPostgresDatabase(connectionString);
  try {
    const applied = await migrate(db);
    console.log(
      applied.length > 0 ? `Aplicadas: ${applied.join(', ')}` : 'Sin migraciones pendientes.',
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('Fallo en la migración:', error);
  process.exit(1);
});
