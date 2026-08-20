/**
 * The profile. Everything here is scoped to the signed-in user.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import type { Database } from '../db/database';
import { currentUserId } from './authRouter';
import { createReadLimiter } from './rateLimit';
import { getProfile, updateProfile } from '../repositories/profile';

function handle(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

const profilePatch = z
  .object({
    // Bounded and trimmed: it is rendered back, and a 10 kB "name" is not one.
    displayName: z.string().trim().max(60).nullable(),
  })
  .strict();

export function createProfileRouter(db: Database, rateLimits = true): Router {
  const router = Router();

  // Six queries in one Promise.all, five of them joins over every set ever
  // logged, against a pool of ten connections. Unthrottled, a handful of
  // concurrent requests from one account starved every other request —
  // including the healthcheck that tells Railway the service is alive.
  const readLimiter = rateLimits
    ? createReadLimiter((req) => `user:${currentUserId(req)}`)
    : (_req: Request, _res: Response, next: NextFunction): void => next();

  router.get(
    '/',
    readLimiter,
    handle(async (req, res) => {
      const profile = await getProfile(db, currentUserId(req));
      if (!profile) {
        res.status(404).json({ error: 'La cuenta no existe.' });
        return;
      }
      res.json({ profile });
    }),
  );

  router.patch(
    '/',
    handle(async (req, res) => {
      await updateProfile(db, currentUserId(req), profilePatch.parse(req.body));
      res.status(204).end();
    }),
  );

  return router;
}
