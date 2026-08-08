/**
 * Session rows.
 *
 * The SQL lives here rather than next to the cookie helpers so that queries
 * stay in the repository layer, which is the boundary the architecture test
 * enforces.
 *
 * Only the SHA-256 of the token is ever stored: a dump of this table does not
 * hand anybody a working login.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { Database } from '../db/database';

const SESSION_DAYS = 30;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a session row and returns the raw token, which is never stored. */
export async function insertSession(db: Database, userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
    userId,
    hashToken(token),
    expiresAt.toISOString(),
  ]);

  // Opportunistic cleanup; cheap, and keeps the table from growing forever.
  await db.query('DELETE FROM sessions WHERE expires_at < now()');

  return token;
}

/** The user behind a token, or `null` when it is unknown or expired. */
export async function findSessionUser(db: Database, token: string): Promise<number | null> {
  const { rows } = await db.query<{ user_id: number }>(
    'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()',
    [hashToken(token)],
  );
  return rows[0]?.user_id ?? null;
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export const SESSION_MAX_AGE_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
