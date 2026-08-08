/**
 * The database used by the server-side test suites.
 *
 * Two backends, same production migrations:
 *
 *   - **PGlite** by default — PostgreSQL compiled to WASM. Real Postgres
 *     semantics (identity columns, `ON CONFLICT`, `NUMERIC`, CHECK
 *     constraints, transactions) with no server and no Docker, so `npm test`
 *     works on a laptop straight after `npm install`.
 *   - **A real PostgreSQL server** when `TEST_DATABASE_URL` is set. CI runs
 *     the suite this way as well, which is what catches any divergence
 *     between the WASM build and the server the app actually deploys against.
 */

import { PGlite } from '@electric-sql/pglite';

import { createPostgresDatabase, type Database } from '../../server/db/database';
import { migrate } from '../../server/db/migrate';

const TABLES = [
  // Users first: everything else cascades from it, and leaving accounts
  // behind would make a second test fail on a duplicate email.
  'users',
  'sessions',
  'programs',
  'weeks',
  'workout_days',
  'exercises',
  'reference_sets',
  'workout_sessions',
  'session_sets',
];

export interface TestDatabase extends Database {
  /** Removes all data but keeps the schema, for isolation between tests. */
  truncate(): Promise<void>;
  /** Which backend is in use, so tests can report it. */
  readonly backend: 'pglite' | 'postgres';
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const connectionString = process.env.TEST_DATABASE_URL;
  return connectionString ? await openPostgresServer(connectionString) : await openPGlite();
}

const TRUNCATE_SQL = `TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`;

async function openPGlite(): Promise<TestDatabase> {
  const client = new PGlite();
  await client.waitReady;

  const db: Database = {
    async query(sql, params) {
      const result = await client.query(sql, params as unknown[]);
      return {
        rows: (result.rows ?? []) as never[],
        // DELETE/UPDATE return no rows, so the count has to come from
        // `affectedRows`; using `rows.length` would report every write as
        // having changed nothing.
        rowCount: result.affectedRows ?? result.rows?.length ?? 0,
      };
    },
    async exec(sql) {
      await client.exec(sql);
    },
    // PGlite is single-connection, so a transaction is BEGIN/COMMIT on it.
    async transaction(work) {
      await client.exec('BEGIN');
      try {
        const value = await work(db);
        await client.exec('COMMIT');
        return value;
      } catch (error) {
        await client.exec('ROLLBACK').catch(() => undefined);
        throw error;
      }
    },
    async close() {
      await client.close();
    },
  };

  await migrate(db);

  return {
    ...db,
    backend: 'pglite',
    async truncate() {
      await client.exec(TRUNCATE_SQL);
    },
  };
}

let schemaCounter = 0;

async function openPostgresServer(connectionString: string): Promise<TestDatabase> {
  // Vitest runs test files in parallel. Against a shared server they would
  // truncate each other's tables, so each database gets its own schema.
  const schema = `test_${process.pid}_${Date.now().toString(36)}_${schemaCounter++}`;

  const admin = createPostgresDatabase(connectionString);
  try {
    await admin.exec(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  } finally {
    await admin.close();
  }

  const db = createPostgresDatabase(connectionString, { schema });
  await migrate(db);

  return {
    ...db,
    backend: 'postgres',
    async truncate() {
      await db.exec(TRUNCATE_SQL);
    },
    async close() {
      const cleaner = createPostgresDatabase(connectionString);
      try {
        await cleaner.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await cleaner.close();
      }
      await db.close();
    },
  };
}
