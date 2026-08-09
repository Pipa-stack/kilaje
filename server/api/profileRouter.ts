/**
 * The profile. Everything here is scoped to the signed-in user.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import type { Database } from '../db/database';
import { currentUserId } from './authRouter';
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

export function createProfileRouter(db: Database): Router {
  const router = Router();

  router.get(
    '/',
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
