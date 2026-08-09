/**
 * Production entry point.
 *
 * Runs migrations, optionally seeds the reference workbook, then serves the
 * API and the built frontend. Configuration comes from the environment only —
 * there are no credentials anywhere in the repository.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app';
import { createSenderFromEnv } from './email/sender';
import { createPostgresDatabase } from './db/database';
import { migrate } from './db/migrate';
import { seedReferenceProgram } from './db/seed';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      '[server] Falta DATABASE_URL. Añade el servicio PostgreSQL y expón la variable.',
    );
    process.exit(1);
  }

  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const db = createPostgresDatabase(connectionString);

  const applied = await migrate(db);
  console.log(
    applied.length > 0
      ? `[server] migraciones aplicadas: ${applied.join(', ')}`
      : '[server] esquema ya actualizado',
  );

  // Opt-in so a redeploy never re-imports on top of real training data.
  if (process.env.SEED_REFERENCE_PROGRAM === 'true') {
    const result = await seedReferenceProgram(db, join(ROOT, 'Ejemplo/ejemplo.xlsx'));
    console.log(`[server] seed: ${result}`);
  }

  // Falls back to the Gmail account itself when sending over SMTP, which is
  // the only From address Gmail will accept from that account anyway.
  const from = process.env.EMAIL_FROM ?? process.env.SMTP_USER ?? 'Kilaje <onboarding@resend.dev>';
  const email = createSenderFromEnv(process.env, from);
  if (!email.configured) {
    console.warn(
      '[server] sin SMTP_* ni RESEND_API_KEY: la recuperación de contraseña no enviará correos',
    );
  }

  const app = createApp({
    db,
    staticDir: join(ROOT, 'dist'),
    email,
    appUrl: process.env.APP_URL ?? '',
  });

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[server] escuchando en http://0.0.0.0:${port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} recibido, cerrando`);
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('[server] fallo al arrancar:', error);
  process.exit(1);
});
