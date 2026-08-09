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
  findUserByEmail,
  findUserById,
  setPassword,
} from '../repositories/users';
import { hashToken } from '../repositories/sessionTokens';
import { RESET_TTL_MINUTES, consumeResetToken, createResetToken } from '../repositories/passwordResets';
import { buildResetEmail } from '../email/resetEmail';
import type { EmailSender } from '../email/sender';
import { createAuthIpLimiter, createAuthLimiter } from './rateLimit';

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

const forgotBody = z
  .object({ email: z.string().trim().email('Introduce un correo válido').max(254) })
  .strict();

const resetBody = z
  .object({
    token: z.string().min(10).max(200),
    newPassword: z
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

export interface AuthRouterOptions {
  rateLimits?: boolean;
  email?: EmailSender;
  /** Absolute origin used to build the reset link, e.g. https://kilaje.up.railway.app */
  appUrl?: string;
}

export function createAuthRouter(
  db: Database,
  { rateLimits = true, email, appUrl = '' }: AuthRouterOptions = {},
): Router {
  const router = Router();

  // One counter per surface, not one shared by all of them. Sharing let
  // `/forgot` — which anyone can call, needs no session and always answers
  // 204 — burn the window for an address and lock its owner out of `/login`
  // for fifteen minutes, for free and on repeat.
  const loginLimiter = rateLimits ? createAuthLimiter() : passThrough;
  const registerLimiter = rateLimits ? createAuthLimiter() : passThrough;
  const forgotLimiter = rateLimits ? createAuthLimiter() : passThrough;
  const passwordLimiter = rateLimits ? createAuthLimiter() : passThrough;

  // Counts every unauthenticated attempt from one address whatever account it
  // names, which is the only thing that sees an attacker rotating emails.
  const ipLimiter = rateLimits ? createAuthIpLimiter() : passThrough;

  /**
   * Registers an account.
   *
   * The first account created adopts any program that has no owner — the
   * seeded reference plan — so a fresh deployment opens with something to
   * look at instead of an empty app.
   */
  router.post(
    '/register',
    ipLimiter,
    registerLimiter,
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
    ipLimiter,
    loginLimiter,
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
    passwordLimiter,
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

  /**
   * Starts a reset.
   *
   * Always answers 204, whether or not the address has an account. Saying
   * "no such user" here would turn this into a free membership check, and it
   * is the one endpoint anybody can call without a session.
   */
  router.post(
    '/forgot',
    ipLimiter,
    forgotLimiter,
    handle(async (req, res) => {
      const { email: address } = forgotBody.parse(req.body);
      res.status(204).end();

      // Everything past this point is best-effort and must not change the
      // answer, so it runs after the response has gone out. It also has to
      // catch its own failures: the response is already closed, so letting one
      // reach the error handler would try to write a 500 onto a finished
      // response — Express destroys the socket and the real error is never
      // logged, hiding a broken mail provider completely.
      try {
        const user = await findUserByEmail(db, address);
        if (!user) return;

        const token = await createResetToken(db, user.id);
        const link = `${appUrl}/?reset=${encodeURIComponent(token)}`;

        if (!email?.configured) {
          console.warn('[auth] reset solicitado pero el correo no está configurado');
          return;
        }
        await email.send(buildResetEmail({ to: user.email, link, minutesValid: RESET_TTL_MINUTES }));
      } catch (cause) {
        console.error('[auth] fallo al preparar el reset:', cause);
      }
    }),
  );

  /**
   * Finishes a reset.
   *
   * Every session is revoked, including any the attacker may have opened:
   * that is the whole point of resetting.
   */
  router.post(
    '/reset',
    ipLimiter,
    forgotLimiter,
    handle(async (req, res) => {
      const { token, newPassword } = resetBody.parse(req.body);

      const userId = await consumeResetToken(db, token);
      if (userId === null) {
        res.status(400).json({ error: 'El enlace ya no es válido. Pide otro.' });
        return;
      }

      await setPassword(db, userId, newPassword);
      res.status(204).end();
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
