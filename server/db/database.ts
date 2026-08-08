/**
 * Database access.
 *
 * One tiny interface (`query` / `transaction`) covers both backends:
 *
 *   - production: `pg` against Railway's PostgreSQL via `DATABASE_URL`
 *   - tests:      PGlite, which is real PostgreSQL compiled to WASM
 *
 * PGlite means the test suite exercises actual Postgres semantics — identity
 * columns, `ON CONFLICT`, `NUMERIC`, CHECK constraints — with no server and no
 * Docker, and the same migrations that run in production.
 */

import { Pool, types } from 'pg';

export interface QueryResult<Row> {
  rows: Row[];
  rowCount: number;
}

export interface Database {
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
  /**
   * Runs a script that may contain several statements, such as a migration
   * file. Takes no parameters, so it is never used with untrusted input.
   */
  exec(sql: string): Promise<void>;
  /** Runs `work` inside a transaction, rolling back if it throws. */
  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// `pg` hands back NUMERIC as a string to avoid precision loss. Weights here
// are at most 100000.00, well inside a double, and the app wants numbers.
const NUMERIC_OID = 1700;
types.setTypeParser(NUMERIC_OID, (value) => (value === null ? null : Number.parseFloat(value)));
// BIGINT likewise: our ids fit comfortably in a JS number.
const INT8_OID = 20;
types.setTypeParser(INT8_OID, (value) => (value === null ? null : Number.parseInt(value, 10)));

/** Cheapest possible round trip, for the health endpoint. */
export async function ping(db: Database): Promise<void> {
  await db.query('SELECT 1');
}

/** Connects to PostgreSQL using `DATABASE_URL`. */
export function createPostgresDatabase(connectionString: string): Database {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Railway's managed Postgres presents a certificate the container does not
    // have a CA bundle for. The connection is still TLS-encrypted.
    ssl: requiresSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });

  const wrap = (runner: Pick<Pool, 'query'>): Database => ({
    async query(sql, params) {
      const result = await runner.query(sql, params as never[]);
      return { rows: result.rows as never[], rowCount: result.rowCount ?? 0 };
    },
    async exec(sql) {
      await runner.query(sql);
    },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await work(wrap(client));
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  });

  return wrap(pool);
}

/**
 * Local sockets and Railway's internal network do not use TLS; anything else
 * (including the public proxy host) does.
 */
function requiresSsl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    if (url.searchParams.get('sslmode') === 'disable') return false;
    const host = url.hostname;
    return !(
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.railway.internal')
    );
  } catch {
    return true;
  }
}
