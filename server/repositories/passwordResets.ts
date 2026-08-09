/**
 * Password reset tokens.
 *
 * Same discipline as sessions: the token goes to the inbox, only its SHA-256
 * reaches the database, and it works exactly once. A link found later in a
 * mailbox, a proxy log or a browser history is worthless.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { Database } from '../db/database';

/** Long enough to be useful, short enough that a stale inbox is not a way in. */
const TTL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issues a reset token.
 *
 * Any token already outstanding for the account is dropped: asking again
 * should invalidate the previous link, not accumulate live ones.
 */
export async function createResetToken(db: Database, userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');

  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
    await tx.query(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, hashToken(token), new Date(Date.now() + TTL_MS).toISOString()],
    );
  });

  // Cheap housekeeping so expired rows do not pile up forever.
  await db.query('DELETE FROM password_resets WHERE expires_at < now()');

  return token;
}

/**
 * Spends a token.
 *
 * Marking it used and reading the owner happen in one statement, so two
 * requests racing with the same link cannot both succeed.
 *
 * @returns the user id, or `null` when the token is unknown, expired or spent.
 */
export async function consumeResetToken(db: Database, token: string): Promise<number | null> {
  const { rows } = await db.query<{ user_id: number }>(
    `UPDATE password_resets
        SET used_at = now()
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      RETURNING user_id`,
    [hashToken(token)],
  );
  return rows[0]?.user_id ?? null;
}

/** Minutes a link stays valid, for the copy in the email. */
export const RESET_TTL_MINUTES = TTL_MS / 60_000;
