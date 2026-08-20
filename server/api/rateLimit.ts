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

      // An attacker inventing a fresh key per request — a new email each time —
      // produces entries that are all still live, so the sweep above frees
      // nothing and the map grows until the heap does. Past this point, evict
      // the oldest regardless: dropping a counter only forgives requests, and
      // the per-IP limiter in front is what actually holds the line.
      if (windows.size > 10_000) {
        const excess = windows.size - 10_000;
        let dropped = 0;
        for (const key of windows.keys()) {
          windows.delete(key);
          if (++dropped >= excess) break;
        }
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

/**
 * A ceiling on how much unauthenticated work one address can ask for.
 *
 * The per-account limiter above cannot see this attack: every request carries
 * a different invented email, so no key ever repeats and the window never
 * fills. Meanwhile each `/login` runs scrypt (N=2^15) before it can know the
 * account does not exist — deliberately, so a missing account is not
 * detectable by timing — and a hundred concurrent requests ask for gigabytes.
 *
 * Deliberately loose. It is not there to stop a person getting their own
 * password wrong; it is there so one address cannot conscript the whole
 * container.
 */
export function createAuthIpLimiter() {
  return rateLimit({
    max: 60,
    windowMs: 15 * 60 * 1000,
    message: 'Demasiadas peticiones desde esta conexión. Espera unos minutos.',
  });
}

/**
 * Structural writes: creating and deleting weeks, editing the plan.
 *
 * Cloning a week inserts a row per day, per exercise and per reference set, so
 * a loop of these is a cheap way to make the database do a lot of work. The
 * 52-week ceiling bounds one program; nothing bounds how many programs a
 * client can hammer at once. Loose enough that a person reorganising their
 * plan never meets it.
 */
export function createPlanLimiter() {
  return rateLimit({
    max: 200,
    windowMs: 60 * 60 * 1000,
    message: 'Demasiados cambios seguidos en el plan. Prueba dentro de un rato.',
  });
}

/**
 * The two reads that fan out into whole-history queries.
 *
 * `GET /api/profile` runs six queries in parallel, five of them four-table
 * joins over every set ever logged, and `GET /api/history` returns up to
 * twenty thousand rows and groups them in JS. The connection pool holds ten
 * connections: four concurrent profile requests take six each, and everything
 * else — including the healthcheck Railway uses to decide the service is
 * alive — queues behind a ten second connect timeout. One signed-in account
 * was enough to do it, and nothing counted the attempt.
 *
 * Keyed by account, not address: the cost is per user's data.
 */
export function createReadLimiter(keyBy: (req: Request) => string) {
  return rateLimit({
    max: 120,
    windowMs: 60 * 60 * 1000,
    message: 'Demasiadas consultas seguidas. Espera un momento.',
    keyBy,
  });
}

/**
 * Everything that writes training.
 *
 * Each is only three or four queries, so this is not about one request being
 * expensive — it is that nothing at all bounded how many of them one client
 * could have in flight against the same pool.
 */
export function createWriteLimiter(keyBy: (req: Request) => string) {
  return rateLimit({
    max: 3_000,
    windowMs: 60 * 60 * 1000,
    message: 'Demasiados cambios seguidos. Espera un momento y vuelve a probar.',
    keyBy,
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
