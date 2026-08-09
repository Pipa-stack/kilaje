/**
 * Registration, login, logout and "who am I".
 *
 * Everything under `/api` except these endpoints and `/api/health` requires a
 * session, enforced by {@link requireUser}.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import type { Database } from '../db/database';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  readSessionCookie,
  resolveSession,
  setSessionCookie,
} from '../auth/sessions';
import { MAX_PASSWORD_LENGTH } from '../auth/passwords';
import { MIN_PASSWORD_LENGTH } from '../../src/domain/upload';
import {
  EmailTakenError,
  WrongPasswordError,
  authenticate,
  changePassword,
  claimOrphanPrograms,
  countUsers,
  createUser,
  findUserById,
} from '../repositories/users';
import { hashToken } from '../repositories/sessionTokens';
import { createAuthLimiter } from './rateLimit';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `attachUser`; present only for authenticated requests. */
      userId?: number;
    }
  }
}

const credentials = z
  .object({
    email: z.string().trim().email('Introduce un correo válido').max(254),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`)
      .max(MAX_PASSWORD_LENGTH),
  })
  .strict();

const passwordChange = z
  .object({
    currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`)
      .max(MAX_PASSWORD_LENGTH),
  })
  .strict();

/** Used when throttling is switched off; changes nothing about the route. */
const passThrough = (_req: Request, _res: Response, next: NextFunction): void => next();

function handle(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/**
 * Reads the session cookie and records who the request belongs to.
 *
 * This is middleware, not an endpoint: it must call `next()` on every path,
 * including the one where there is no cookie at all. (`handle` above is for
 * handlers that end the response and deliberately does not continue the
 * chain — using it here would hang every request.)
 */
export function attachUser(db: Database) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = readSessionCookie(req);
    if (!token) {
      next();
      return;
    }

    resolveSession(db, token)
      .then((userId) => {
        if (userId !== null) req.userId = userId;
        next();
      })
      .catch(next);
  };
}

/** Rejects anything without a valid session. */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (req.userId === undefined) {
    res.status(401).json({ error: 'Necesitas iniciar sesión.' });
    return;
  }
  next();
}

/** The authenticated user id. Only call behind {@link requireUser}. */
export function currentUserId(req: Request): number {
  if (req.userId === undefined) throw new Error('Ruta sin autenticar');
  return req.userId;
}

export function createAuthRouter(db: Database, rateLimits = true): Router {
  const router = Router();
  const authLimiter = rateLimits ? createAuthLimiter() : passThrough;

  /**
   * Registers an account.
   *
   * The first account created adopts any program that has no owner — the
   * seeded reference plan — so a fresh deployment opens with something to
   * look at instead of an empty app.
   */
  router.post(
    '/register',
    authLimiter,
    handle(async (req, res) => {
      const { email, password } = credentials.parse(req.body);

      try {
        const isFirstAccount = (await countUsers(db)) === 0;
        const user = await createUser(db, email, password);
        if (isFirstAccount) await claimOrphanPrograms(db, user.id);

        const token = await createSession(db, user.id);
        setSessionCookie(req, res, token);
        res.status(201).json({ user: { id: user.id, email: user.email } });
      } catch (error) {
        if (error instanceof EmailTakenError) {
          res.status(409).json({ error: error.message });
          return;
        }
        throw error;
      }
    }),
  );

  router.post(
    '/login',
    authLimiter,
    handle(async (req, res) => {
      const { email, password } = credentials.parse(req.body);
      const user = await authenticate(db, email, password);

      if (!user) {
        // One message for both cases: saying which half was wrong would
        // turn this endpoint into a way of checking who has an account.
        res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        return;
      }

      const token = await createSession(db, user.id);
      setSessionCookie(req, res, token);
      res.json({ user: { id: user.id, email: user.email } });
    }),
  );

  router.post(
    '/logout',
    handle(async (req, res) => {
      const token = readSessionCookie(req);
      if (token) await destroySession(db, token);
      clearSessionCookie(req, res);
      res.status(204).end();
    }),
  );

  /**
   * Changes the password.
   *
   * Requires the current one, so a session left open on a shared phone
   * cannot be used to lock the owner out.
   */
  router.post(
    '/password',
    authLimiter,
    handle(async (req, res) => {
      if (req.userId === undefined) {
        res.status(401).json({ error: 'Necesitas iniciar sesión.' });
        return;
      }

      const { currentPassword, newPassword } = passwordChange.parse(req.body);
      if (currentPassword === newPassword) {
        res.status(400).json({ error: 'La contraseña nueva es igual que la actual.' });
        return;
      }

      const token = readSessionCookie(req);
      try {
        await changePassword(
          db,
          req.userId,
          currentPassword,
          newPassword,
          token ? hashToken(token) : null,
        );
        res.status(204).end();
      } catch (error) {
        if (error instanceof WrongPasswordError) {
          res.status(403).json({ error: error.message });
          return;
        }
        throw error;
      }
    }),
  );

  /** Who the browser is logged in as, for the app to decide what to render. */
  router.get(
    '/me',
    handle(async (req, res) => {
      if (req.userId === undefined) {
        res.status(401).json({ error: 'Necesitas iniciar sesión.' });
        return;
      }
      const user = await findUserById(db, req.userId);
      if (!user) {
        res.status(401).json({ error: 'Necesitas iniciar sesión.' });
        return;
      }
      res.json({ user: { id: user.id, email: user.email } });
    }),
  );

  return router;
}
