/**
 * Clases: ver la semana, reservar y anular. Y, para quien administra, el
 * horario, la lista de apuntados y anular una fecha.
 *
 * Quién administra lo decide `auth/roles.ts`: el rol de la cuenta, o ser uno
 * de los propietarios de `ADMIN_EMAILS`.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import type { Database } from '../db/database';
import { currentUserId } from './authRouter';
import { idParam } from './schemas';
import { createReadLimiter, createWriteLimiter } from './rateLimit';
import { ownerSet, requireAdmin as adminGuard, resolveAccess } from '../auth/roles';
import {
  BOOKING_DAYS,
  CANCEL_DEADLINE_MINUTES,
  bookClass,
  cancelBooking,
  cancelOccurrence,
  createClass,
  deleteClass,
  listSchedule,
  listUpcoming,
  removeBooking,
  restoreOccurrence,
  updateClass,
  type OccurrenceLabel,
  type Recipient,
} from '../repositories/classes';
import { buildCancelledEmail, buildPromotedEmail } from '../email/classEmail';
import type { Email, EmailSender } from '../email/sender';

function handle(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Fecha inválida');

const bookingBody = z.object({ date: dateParam }).strict();

const classBody = z
  .object({
    name: z.string().trim().min(1, 'Ponle un nombre').max(60),
    coach: z
      .string()
      .trim()
      .max(60)
      .nullable()
      .transform((value) => (value ? value : null)),
    weekday: z.number().int().min(1).max(7),
    startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida'),
    durationMinutes: z.number().int().min(10).max(240),
    capacity: z.number().int().min(1).max(200),
  })
  .strict();

export interface ClassesRouterOptions {
  rateLimits?: boolean;
  /** Propietarios: administradores siempre. */
  adminEmails?: readonly string[];
  email?: EmailSender;
  appUrl?: string;
  /** El reloj. Solo lo cambian los tests. */
  clock?: () => Date;
}

export function createClassesRouter(
  db: Database,
  {
    rateLimits = true,
    adminEmails = [],
    email,
    appUrl = '',
    clock = () => new Date(),
  }: ClassesRouterOptions = {},
): Router {
  const router = Router();
  const owners = ownerSet(adminEmails);

  const passThrough = (_req: Request, _res: Response, next: NextFunction): void => next();
  const byUser = (req: Request): string => `user:${currentUserId(req)}`;
  const readLimiter = rateLimits ? createReadLimiter(byUser) : passThrough;
  const writeLimiter = rateLimits ? createWriteLimiter(byUser) : passThrough;

  const isAdmin = async (req: Request): Promise<boolean> =>
    (await resolveAccess(db, currentUserId(req), owners))?.role === 'admin';
  const requireAdmin = adminGuard(db, owners);

  /**
   * Manda correos después de haber respondido.
   *
   * Un proveedor lento o caído no puede retrasar ni tumbar la reserva, que ya
   * está hecha. Como en `/forgot`, los fallos se quedan en el log.
   */
  const notify = (build: () => Email[]): void => {
    if (!email?.configured) return;
    void (async () => {
      for (const message of build()) {
        try {
          await email.send(message);
        } catch (cause) {
          console.error('[classes] no se ha podido enviar un aviso:', cause);
        }
      }
    })();
  };

  const notifyPromoted = (promoted: Recipient | null, label: OccurrenceLabel): void => {
    if (promoted) notify(() => [buildPromotedEmail(promoted.email, label, appUrl)]);
  };

  router.get(
    '/',
    readLimiter,
    handle(async (req, res) => {
      const admin = await isAdmin(req);
      const [days, schedule] = await Promise.all([
        listUpcoming(db, currentUserId(req), clock(), { withAttendees: admin }),
        admin ? listSchedule(db) : Promise.resolve(undefined),
      ]);
      res.json({
        days,
        isAdmin: admin,
        bookingDays: BOOKING_DAYS,
        cancelDeadlineMinutes: CANCEL_DEADLINE_MINUTES,
        ...(schedule ? { schedule } : {}),
      });
    }),
  );

  router.post(
    '/:classId/bookings',
    writeLimiter,
    handle(async (req, res) => {
      const classId = idParam.parse(req.params.classId);
      const { date } = bookingBody.parse(req.body);
      const result = await bookClass(db, currentUserId(req), classId, date, clock());
      res.status(201).json(result);
    }),
  );

  router.delete(
    '/:classId/bookings/:date',
    writeLimiter,
    handle(async (req, res) => {
      const classId = idParam.parse(req.params.classId);
      const date = dateParam.parse(req.params.date);
      const { promoted, label } = await cancelBooking(db, currentUserId(req), classId, date, clock());
      res.status(204).end();
      notifyPromoted(promoted, label);
    }),
  );

  /* ---------------------------------------------------- administración */

  const admin = Router();

  admin.post(
    '/schedule',
    handle(async (req, res) => {
      const gymClass = await createClass(db, classBody.parse(req.body));
      res.status(201).json({ class: gymClass });
    }),
  );

  admin.put(
    '/schedule/:classId',
    handle(async (req, res) => {
      const classId = idParam.parse(req.params.classId);
      const gymClass = await updateClass(db, classId, classBody.parse(req.body), clock());
      res.json({ class: gymClass });
    }),
  );

  admin.delete(
    '/schedule/:classId',
    handle(async (req, res) => {
      await deleteClass(db, idParam.parse(req.params.classId));
      res.status(204).end();
    }),
  );

  admin.put(
    '/:classId/cancellations/:date',
    handle(async (req, res) => {
      const classId = idParam.parse(req.params.classId);
      const date = dateParam.parse(req.params.date);
      const { affected, label } = await cancelOccurrence(db, classId, date, clock());
      res.status(204).end();
      notify(() => affected.map((person) => buildCancelledEmail(person.email, label, appUrl)));
    }),
  );

  admin.delete(
    '/:classId/cancellations/:date',
    handle(async (req, res) => {
      const classId = idParam.parse(req.params.classId);
      await restoreOccurrence(db, classId, dateParam.parse(req.params.date));
      res.status(204).end();
    }),
  );

  admin.delete(
    '/bookings/:bookingId',
    handle(async (req, res) => {
      const { promoted, label } = await removeBooking(
        db,
        idParam.parse(req.params.bookingId),
        clock(),
      );
      res.status(204).end();
      notifyPromoted(promoted, label);
    }),
  );

  // Después de las rutas de socio: lo que no han atendido ellas es de
  // administración, y ahí solo se entra pasando el guardia.
  router.use(writeLimiter, requireAdmin, admin);

  return router;
}
