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
  ADMIN_DAYS_AHEAD,
  BOOKING_DAYS,
  GYM_TIME_ZONE,
  cancelDay,
  findPaidUntil,
  listClassHistory,
  restoreDay,
  setAttendance,
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
import {
  buildBookedForYouEmail,
  buildCancelledEmail,
  buildClassNoticeEmail,
  buildPromotedEmail,
} from '../email/classEmail';
import { findUserById } from '../repositories/users';
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

const attendanceBody = z.object({ attended: z.boolean().nullable() }).strict();

const attendeeBody = z.object({ date: dateParam, userId: z.number().int().positive() }).strict();

/** Días entre dos fechas `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

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
      const now = clock();
      // Quien administra puede mirar otra semana: una atrás, para ver quién
      // vino, o hasta tres meses adelante, para preparar un festivo.
      let from: string | null = null;
      if (admin && typeof req.query.from === 'string') {
        from = dateParam.parse(req.query.from);
        const today = now.toLocaleDateString('sv-SE', { timeZone: GYM_TIME_ZONE });
        const offset = daysBetween(today, from);
        if (offset < -7 || offset > ADMIN_DAYS_AHEAD) {
          res.status(400).json({ error: 'Esa fecha queda fuera de lo que se puede consultar.' });
          return;
        }
      }
      const [days, schedule, paidUntil] = await Promise.all([
        listUpcoming(db, currentUserId(req), now, { withAttendees: admin, from }),
        admin ? listSchedule(db) : Promise.resolve(undefined),
        findPaidUntil(db, currentUserId(req)),
      ]);
      res.json({
        days,
        isAdmin: admin,
        bookingDays: BOOKING_DAYS,
        cancelDeadlineMinutes: CANCEL_DEADLINE_MINUTES,
        adminDaysAhead: ADMIN_DAYS_AHEAD,
        paidUntil,
        ...(schedule ? { schedule } : {}),
      });
    }),
  );

  /** Las clases a las que ha ido quien pregunta. */
  router.get(
    '/history',
    readLimiter,
    handle(async (req, res) => {
      res.json({ history: await listClassHistory(db, currentUserId(req), clock()) });
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

  /**
   * Apunta a un socio a una clase. Mismas reglas que si se apuntara él —
   * plaza o espera por orden de llegada —, con más margen de fechas, y se le
   * avisa por correo.
   */
  admin.post(
    '/:classId/attendees',
    handle(async (req, res) => {
      const classId = idParam.parse(req.params.classId);
      const { date, userId } = attendeeBody.parse(req.body);
      const member = await findUserById(db, userId);
      if (!member) {
        res.status(404).json({ error: 'Ese socio no existe.' });
        return;
      }
      const result = await bookClass(db, userId, classId, date, clock(), { byAdmin: true });
      res.status(201).json(result);

      if (userId !== currentUserId(req)) {
        const gymClass = (await listSchedule(db)).find((candidate) => candidate.id === classId);
        if (gymClass) {
          notify(() => [
            buildBookedForYouEmail(
              member.email,
              { name: gymClass.name, date, startsAt: gymClass.startsAt },
              result.status === 'waiting' ? result.waitPosition : null,
              appUrl,
            ),
          ]);
        }
      }
    }),
  );

  /** Pasar lista: vino, no vino, o sin marcar. */
  admin.put(
    '/bookings/:bookingId/attendance',
    handle(async (req, res) => {
      const { attended } = attendanceBody.parse(req.body);
      await setAttendance(db, idParam.parse(req.params.bookingId), attended);
      res.status(204).end();
    }),
  );

  /** Anula todo un día — un festivo — y avisa a quien estuviera apuntado. */
  admin.put(
    '/days/:date/cancellation',
    handle(async (req, res) => {
      const { cancelled, affected } = await cancelDay(db, dateParam.parse(req.params.date), clock());
      res.json({ cancelled, notified: affected.length });
      notify(() => affected.map((person) => buildCancelledEmail(person.email, person.label, appUrl)));
    }),
  );

  admin.delete(
    '/days/:date/cancellation',
    handle(async (req, res) => {
      const restored = await restoreDay(db, dateParam.parse(req.params.date));
      res.json({ restored });
    }),
  );

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
      const { gymClass, notices } = await updateClass(db, classId, classBody.parse(req.body), clock());
      res.json({ class: gymClass, notified: notices.length });
      notify(() => notices.map((notice) => buildClassNoticeEmail(notice, appUrl)));
    }),
  );

  admin.delete(
    '/schedule/:classId',
    handle(async (req, res) => {
      const notices = await deleteClass(db, idParam.parse(req.params.classId), clock());
      res.status(204).end();
      notify(() => notices.map((notice) => buildClassNoticeEmail(notice, appUrl)));
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
