/**
 * User accounts.
 */

import type { Database } from '../db/database';
import { hashPassword, verifyPassword } from '../auth/passwords';

export interface User {
  id: number;
  email: string;
  createdAt: string;
}

/** Raised when an email is already taken. */
export class EmailTakenError extends Error {
  constructor() {
    super('Ya existe una cuenta con ese correo.');
    this.name = 'EmailTakenError';
  }
}

/** Emails are compared lower-cased and trimmed, so case never splits a login. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createUser(db: Database, email: string, password: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const passwordHash = await hashPassword(password);

  try {
    const { rows } = await db.query<{ id: number; email: string; created_at: Date | string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, created_at`,
      [normalized, passwordHash],
    );
    const row = rows[0];
    if (!row) throw new Error('No se ha podido crear la cuenta');
    return { id: row.id, email: row.email, createdAt: toIso(row.created_at) };
  } catch (error) {
    if (isUniqueViolation(error)) throw new EmailTakenError();
    throw error;
  }
}

/**
 * Checks credentials.
 *
 * When the email is unknown a hash is still computed against a dummy value,
 * so a wrong email and a wrong password take the same time and the endpoint
 * cannot be used to find out which addresses are registered.
 */
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export async function authenticate(
  db: Database,
  email: string,
  password: string,
): Promise<User | null> {
  const { rows } = await db.query<{
    id: number;
    email: string;
    password_hash: string;
    created_at: Date | string;
  }>('SELECT id, email, password_hash, created_at FROM users WHERE email = $1', [
    normalizeEmail(email),
  ]);

  const row = rows[0];
  const matches = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !matches) return null;

  return { id: row.id, email: row.email, createdAt: toIso(row.created_at) };
}

/** Raised when the current password does not match. */
export class WrongPasswordError extends Error {
  constructor() {
    super('La contraseña actual no es correcta.');
    this.name = 'WrongPasswordError';
  }
}

/**
 * Changes a password.
 *
 * Every other session is revoked: if the reason for changing it is that
 * somebody else got in, leaving their session alive would defeat the point.
 * The caller's own session is spared so they are not logged out mid-workout.
 */
export async function changePassword(
  db: Database,
  userId: number,
  currentPassword: string,
  newPassword: string,
  keepTokenHash: string | null,
): Promise<void> {
  const { rows } = await db.query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId],
  );

  const stored = rows[0]?.password_hash;
  if (!stored || !(await verifyPassword(currentPassword, stored))) {
    throw new WrongPasswordError();
  }

  const passwordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    await tx.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
    await tx.query(
      'DELETE FROM sessions WHERE user_id = $1 AND token_hash IS DISTINCT FROM $2',
      [userId, keepTokenHash],
    );
  });
}

/** Looks up an account by address. Used only where enumeration is guarded. */
export async function findUserByEmail(db: Database, email: string): Promise<User | null> {
  const { rows } = await db.query<{ id: number; email: string; created_at: Date | string }>(
    'SELECT id, email, created_at FROM users WHERE email = $1',
    [normalizeEmail(email)],
  );
  const row = rows[0];
  return row ? { id: row.id, email: row.email, createdAt: toIso(row.created_at) } : null;
}

/**
 * Sets a password without asking for the old one.
 *
 * Only reachable after a reset token has been spent, so the proof of identity
 * happened before this call. Every session is revoked — including any the
 * attacker opened, which is the point of resetting.
 */
export async function setPassword(
  db: Database,
  userId: number,
  newPassword: string,
): Promise<void> {
  const passwordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    await tx.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  });
}

export async function findUserById(db: Database, id: number): Promise<User | null> {
  const { rows } = await db.query<{ id: number; email: string; created_at: Date | string }>(
    'SELECT id, email, created_at FROM users WHERE id = $1',
    [id],
  );
  const row = rows[0];
  return row ? { id: row.id, email: row.email, createdAt: toIso(row.created_at) } : null;
}

export async function countUsers(db: Database): Promise<number> {
  const { rows } = await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users');
  return rows[0]?.count ?? 0;
}

/**
 * Hands programs with no owner to a user.
 *
 * The seeded reference plan, and anything imported before accounts existed,
 * has `user_id IS NULL` and is invisible to every query. The first account
 * created adopts it, so a fresh deployment still opens with a program to
 * look at instead of an empty app.
 */
export async function claimOrphanPrograms(db: Database, userId: number): Promise<number> {
  const { rowCount } = await db.query(
    'UPDATE programs SET user_id = $1 WHERE user_id IS NULL',
    [userId],
  );
  return rowCount;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  // 23505 is PostgreSQL's unique_violation.
  return code === '23505' || /duplicate key|unique constraint/i.test(String(error));
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
