/**
 * A real PostgreSQL for tests, with no server and no Docker.
 *
 * PGlite is PostgreSQL compiled to WASM, so the suite runs the production
 * migrations and exercises genuine Postgres behaviour — identity columns,
 * `ON CONFLICT`, `NUMERIC`, CHECK constraints, transactions. An in-memory
 * fake would have let schema bugs through.
 */

import { PGlite } from '@electric-sql/pglite';

import type { Database } from '../../server/db/database';
import { migrate } from '../../server/db/migrate';

export interface TestDatabase extends Database {
  /** Removes all data but keeps the schema, for isolation between tests. */
  truncate(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  await client.waitReady;

  const db: Database = {
    async query(sql, params) {
      const result = await client.query(sql, params as unknown[]);
      return { rows: (result.rows ?? []) as never[], rowCount: result.rows?.length ?? 0 };
    },
    async exec(sql) {
      await client.exec(sql);
    },
    // PGlite is single-connection, so a transaction is just BEGIN/COMMIT on it.
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
    async truncate() {
      await client.exec(`
        TRUNCATE programs, weeks, workout_days, exercises,
                 reference_sets, workout_sessions, session_sets
        RESTART IDENTITY CASCADE
      `);
    },
  };
}
