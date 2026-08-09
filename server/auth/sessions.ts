/**
 * The cookie that carries a session token.
 *
 * The rows themselves live in `repositories/sessionTokens.ts`; this file only
 * deals with reading and writing the cookie.
 */

import type { Request, Response } from 'express';

import type { Database } from '../db/database';
import {
  SESSION_MAX_AGE_MS,
  deleteSession,
  findSessionUser,
  insertSession,
} from '../repositories/sessionTokens';

export const SESSION_COOKIE = 'barra_session';

export function createSession(db: Database, userId: number): Promise<string> {
  return insertSession(db, userId);
}

export function resolveSession(db: Database, token: string): Promise<number | null> {
  return findSessionUser(db, token);
}

export function destroySession(db: Database, token: string): Promise<void> {
  return deleteSession(db, token);
}

/**
 * Reads the session cookie.
 *
 * Parsed by hand rather than with a dependency: it is a handful of lines and
 * one less package with access to every request.
 */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    return value === '' ? null : value;
  }
  return null;
}

/**
 * `httpOnly` keeps the token away from any script on the page, `sameSite:
 * lax` stops another site from riding the cookie on a cross-site request,
 * and `secure` is set whenever the request arrived over HTTPS.
 */
export function setSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
  });
}
