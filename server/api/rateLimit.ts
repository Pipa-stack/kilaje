/**
 * Request throttling for the endpoints worth attacking.
 *
 * Written here rather than pulled in as a dependency: it is forty lines, and
 * this is one small service where an in-memory counter is exactly right. The
 * trade-off is explicit — the window is **per instance**, so running more than
 * one container would multiply the allowance. If this ever scales out, the
 * counter has to move to PostgreSQL or Redis.
 *
 * Two surfaces need it for different reasons:
 *
 *   - **Login and registration**, because otherwise a password can be guessed
 *     at network speed.
 *   - **Importing a workbook**, because parsing a spreadsheet is the most
 *     expensive thing the server does, and a loop of uploads is a cheap way
 *     to keep it busy.
 */

import type { NextFunction, Request, Response } from 'express';

interface Window {
  count: number;
  /** Epoch ms when the count goes back to zero. */
  resetAt: number;
}

export interface RateLimitOptions {
  /** Requests allowed per window, per key. */
  max: number;
  windowMs: number;
  /** Shown to the caller; keep it free of internal detail. */
  message: string;
  /**
   * What to count by. Defaults to the client IP.
   *
   * IP is the wrong key for a login: behind a proxy it is not always stable,
   * and an attacker with more than one address defeats it anyway. Counting by
   * the account being attempted throttles the thing actually under attack.
   */
  keyBy?: (req: Request) => string;
}

/**
 * Fixed-window limiter keyed by client IP.
 *
 * `req.ip` is only trustworthy because `trust proxy` is set in `app.ts`;
 * without it every request behind Railway would share the proxy's address and
 * one attacker would lock everybody out.
 */
export function rateLimit({ max, windowMs, message, keyBy }: RateLimitOptions) {
  const windows = new Map<string, Window>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = keyBy ? keyBy(req) : (req.ip ?? 'desconocido');

    // Sweep expired entries so the map cannot grow without bound.
    if (windows.size > 10_000) {
      for (const [ip, window] of windows) {
        if (window.resetAt <= now) windows.delete(ip);
      }
    }

    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    current.count += 1;
    if (current.count > max) {
      const retryAfter = Math.ceil((current.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}

/**
 * Built per application rather than once per module.
 *
 * The counters are state, and state that outlives the app it guards is state
 * shared by every app in the process — which in tests means one suite's
 * requests locking out the next one's.
 */

/**
 * Guessing a password should not be possible at network speed.
 *
 * Counted per account, not per address. Credential stuffing rotates IPs as a
 * matter of course, and Railway's proxy does not present a stable one anyway;
 * what has to be protected is the account on the other end.
 */
export function createAuthLimiter() {
  return rateLimit({
    max: 10,
    windowMs: 15 * 60 * 1000,
    message: 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
    keyBy: (req) => {
      const body: unknown = req.body;
      const email =
        typeof body === 'object' && body !== null && 'email' in body
          ? String((body as { email: unknown }).email)
          : '';
      // Falls back to the address for endpoints that carry no email, such as
      // changing a password from an existing session.
      return email.trim().toLowerCase() || `ip:${req.ip ?? 'desconocido'}`;
    },
  });
}

/** Parsing a spreadsheet is the most expensive request the server serves. */
export function createImportLimiter() {
  return rateLimit({
    max: 20,
    windowMs: 60 * 60 * 1000,
    message: 'Has importado demasiados archivos seguidos. Prueba dentro de un rato.',
  });
}
