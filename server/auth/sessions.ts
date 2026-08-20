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

export const SESSION_COOKIE = 'kilaje_session';

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

    const raw = part.slice(separator + 1).trim();
    let value: string;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // A stray `%` throws URIError. This runs before any authentication, on
      // every /api request, so letting it escape turns a truncated or tampered
      // cookie into a 500 on every route — and because it is not a 401 the app
      // never clears the cookie, leaving that browser stuck. An undecodable
      // cookie is simply not a session.
      return null;
    }

    return value === '' ? null : value;
  }
  return null;
}

/**
 * `httpOnly` keeps the token away from any script on the page, `sameSite:
 * lax` stops another site from riding the cookie on a cross-site request,
 * and `secure` is set on every production response.
 *
 * Not `req.secure` alone: that is derived from `x-forwarded-proto`, so any
 * request reaching Node without the header — a misconfigured proxy, a probe on
 * the internal port — would mint a session cookie a plain-HTTP page could
 * carry. In production the answer is always yes.
 */
function isSecure(req: Request): boolean {
  return process.env.NODE_ENV === 'production' || req.secure;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(req),
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(req),
    path: '/',
  });
}
