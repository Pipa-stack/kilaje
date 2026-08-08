/**
 * Password hashing with scrypt.
 *
 * scrypt ships with Node, so there is no native module to compile on
 * deploy, and it is a memory-hard KDF designed for exactly this: it makes a
 * stolen `password_hash` column expensive to attack with GPUs, which a plain
 * SHA of any speed does not.
 *
 * The stored string carries its own parameters, so the cost can be raised
 * later without invalidating existing hashes.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** ~64 MB of memory per hash: painful to parallelise, fine for one login. */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export { MIN_PASSWORD_LENGTH } from '../../src/domain/upload';
/** scrypt reads the whole input; a cap stops a huge body burning CPU. */
export const MAX_PASSWORD_LENGTH = 200;

/** Produces `scrypt$N$r$p$salt$key`, all base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * Checks a password against a stored hash.
 *
 * Never throws on a malformed hash: it returns false, so a corrupted row
 * fails the login rather than crashing the endpoint.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, n, r, p, salt, key] = stored.split('$');
    if (scheme !== 'scrypt' || !n || !r || !p || !salt || !key) return false;

    const expected = Buffer.from(key, 'base64url');
    const actual = await scryptAsync(
      password.normalize('NFKC'),
      Buffer.from(salt, 'base64url'),
      expected.length,
      {
        N: Number.parseInt(n, 10),
        r: Number.parseInt(r, 10),
        p: Number.parseInt(p, 10),
        maxmem: PARAMS.maxmem,
      },
    );

    // Constant time: a length-aware early exit would leak how much matched.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
