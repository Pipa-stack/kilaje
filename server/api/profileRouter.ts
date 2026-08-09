/**
 * Profile and body weight. Everything here is scoped to the signed-in user.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import type { Database } from '../db/database';
import { currentUserId } from './authRouter';
import {
  deleteBodyWeight,
  getProfile,
  recordBodyWeight,
  updateProfile,
} from '../repositories/profile';

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
    displayName: z.string().trim().max(60).nullable().optional(),
    gym: z.string().trim().max(80).nullable().optional(),
    weightUnit: z.enum(['kg', 'lb']).optional(),
  })
  .strict()
  .refine(
    (body) => Object.keys(body).length > 0,
    'Indica al menos un campo',
  );

/** A calendar day, not a timestamp: one weigh-in per day. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Fecha inválida');

const bodyWeightBody = z
  .object({
    // The database stores kilos; the unit preference is display only.
    weightKg: z.number().positive().max(500),
    measuredOn: isoDate.optional(),
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

  router.put(
    '/weight',
    handle(async (req, res) => {
      const { weightKg, measuredOn } = bodyWeightBody.parse(req.body);
      await recordBodyWeight(
        db,
        currentUserId(req),
        weightKg,
        measuredOn ?? new Date().toISOString().slice(0, 10),
      );
      res.status(204).end();
    }),
  );

  router.delete(
    '/weight/:measuredOn',
    handle(async (req, res) => {
      const measuredOn = isoDate.parse(req.params.measuredOn);
      await deleteBodyWeight(db, currentUserId(req), measuredOn);
      res.status(204).end();
    }),
  );

  return router;
}
