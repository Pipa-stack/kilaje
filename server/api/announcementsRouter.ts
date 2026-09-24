/**
 * Avisos: todos los leen, solo quien administra los escribe y los quita.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import type { Database } from '../db/database';
import { currentUserId } from './authRouter';
import { idParam } from './schemas';
import { createReadLimiter, createWriteLimiter } from './rateLimit';
import { requireAdmin } from '../auth/roles';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
} from '../repositories/announcements';

function handle(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

const announcementBody = z
  .object({ message: z.string().trim().min(1, 'Escribe el aviso').max(500) })
  .strict();

export function createAnnouncementsRouter(
  db: Database,
  { rateLimits = true, owners }: { rateLimits?: boolean; owners: ReadonlySet<string> },
): Router {
  const router = Router();
  const passThrough = (_req: Request, _res: Response, next: NextFunction): void => next();
  const byUser = (req: Request): string => `user:${currentUserId(req)}`;
  const readLimiter = rateLimits ? createReadLimiter(byUser) : passThrough;
  const writeLimiter = rateLimits ? createWriteLimiter(byUser) : passThrough;
  const adminOnly = requireAdmin(db, owners);

  router.get(
    '/',
    readLimiter,
    handle(async (_req, res) => {
      res.json({ announcements: await listAnnouncements(db) });
    }),
  );

  router.post(
    '/',
    writeLimiter,
    adminOnly,
    handle(async (req, res) => {
      const { message } = announcementBody.parse(req.body);
      res.status(201).json({ announcement: await createAnnouncement(db, message, currentUserId(req)) });
    }),
  );

  router.delete(
    '/:id',
    writeLimiter,
    adminOnly,
    handle(async (req, res) => {
      const deleted = await deleteAnnouncement(db, idParam.parse(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Ese aviso ya no existe.' });
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}
