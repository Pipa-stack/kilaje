/**
 * Migration runner.
 *
 * Migrations are plain `.sql` files applied in filename order and recorded in
 * `schema_migrations`, so the database can always be rebuilt from zero and no
 * step is ever applied twice. Nothing is changed by hand in the Railway UI.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Database } from './database';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface Migration {
  name: string;
  sql: string;
}

/** Every migration on disk, in the order they must be applied. */
export function loadMigrations(directory = MIGRATIONS_DIR): Migration[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({ name: file, sql: readFileSync(join(directory, file), 'utf8') }));
}

/**
 * Applies every migration that has not run yet.
 *
 * @returns the names actually applied during this call.
 */
export async function migrate(db: Database, migrations = loadMigrations()): Promise<string[]> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));
  const performed: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;

    // Each migration is atomic: a failure halfway leaves nothing behind.
    await db.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
    });
    performed.push(migration.name);
  }

  return performed;
}
