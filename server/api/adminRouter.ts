/**
 * Administración de socios.
 *
 * Todo pasa por `requireAdmin`. Quien administra ve a cada socio, cambia su
 * rol, le sube el planning con la misma plantilla de Excel que usa cualquiera
 * para sí mismo, descarga su progreso en esa misma plantilla y borra un plan.
 *
 * Nada de esto duplica lógica: importar, exportar y listar son las funciones
 * de siempre, llamadas con el id del socio en vez del de quien pregunta.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { MAX_FILE_BYTES } from '../../src/domain/upload';
import type { Database } from '../db/database';
import { parseWorkbook } from '../parser/excelParser';
import { buildWorkbook, exportFileName } from '../parser/excelExporter';
import { currentUserId } from './authRouter';
import { idParam, sanitizeFileName } from './schemas';
import { createImportLimiter, createReadLimiter, createWriteLimiter } from './rateLimit';
import { requireAdmin } from '../auth/roles';
import {
  deleteProgram,
  getProgram,
  hashSource,
  importProgram,
  listPrograms,
} from '../repositories/programs';
import { getMember, listMembers, markAssigned, setRole } from '../repositories/members';
import { buildPlanAssignedEmail } from '../email/planEmail';
import type { EmailSender } from '../email/sender';

function handle(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

const roleBody = z.object({ role: z.enum(['member', 'admin']) }).strict();

export interface AdminRouterOptions {
  rateLimits?: boolean;
  owners: ReadonlySet<string>;
  email?: EmailSender;
  appUrl?: string;
}

export function createAdminRouter(
  db: Database,
  { rateLimits = true, owners, email, appUrl = '' }: AdminRouterOptions,
): Router {
  const router = Router();

  const passThrough = (_req: Request, _res: Response, next: NextFunction): void => next();
  const byUser = (req: Request): string => `user:${currentUserId(req)}`;
  const readLimiter = rateLimits ? createReadLimiter(byUser) : passThrough;
  const writeLimiter = rateLimits ? createWriteLimiter(byUser) : passThrough;
  const importLimiter = rateLimits ? createImportLimiter() : passThrough;

  router.use(requireAdmin(db, owners));

  /** El socio de la ruta, o un 404 ya respondido. */
  const loadMember = async (req: Request, res: Response) => {
    const member = await getMember(db, owners, idParam.parse(req.params.userId));
    if (!member) res.status(404).json({ error: 'Ese socio no existe.' });
    return member;
  };

  router.get(
    '/members',
    readLimiter,
    handle(async (_req, res) => {
      res.json({ members: await listMembers(db, owners) });
    }),
  );

  router.get(
    '/members/:userId',
    readLimiter,
    handle(async (req, res) => {
      const member = await loadMember(req, res);
      if (!member) return;
      res.json({ member, programs: await listPrograms(db, member.id) });
    }),
  );

  router.patch(
    '/members/:userId',
    writeLimiter,
    handle(async (req, res) => {
      const member = await loadMember(req, res);
      if (!member) return;
      const { role } = roleBody.parse(req.body);
      await setRole(db, currentUserId(req), member, role);
      res.json({ member: await getMember(db, owners, member.id) });
    }),
  );

  /**
   * Sube un planning a un socio.
   *
   * El mismo camino que la importación de siempre — el mismo parser, los
   * mismos límites, el mismo antiduplicado — con el socio como dueño. Pasa a
   * ser el plan que se le abre al entrar, y se le avisa por correo.
   */
  router.post(
    '/members/:userId/programs',
    importLimiter,
    handle(async (req, res) => {
      const member = await loadMember(req, res);
      if (!member) return;

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.byteLength === 0) {
        res.status(400).json({ error: 'No se ha recibido ningún archivo.' });
        return;
      }
      if (body.byteLength > MAX_FILE_BYTES) {
        res.status(413).json({ error: 'El archivo supera el límite de 10 MB.' });
        return;
      }

      const rawName = typeof req.query.filename === 'string' ? req.query.filename : '';
      const bytes = new Uint8Array(body);
      const parsed = parseWorkbook(bytes, sanitizeFileName(rawName));
      const { program, created } = await importProgram(db, parsed, hashSource(bytes), member.id);

      const adminId = currentUserId(req);
      if (created && adminId !== member.id) await markAssigned(db, program.id, adminId);

      res.status(created ? 201 : 200).json({ programId: program.id, name: program.name, created });

      if (created && adminId !== member.id && email?.configured) {
        const admin = await getMember(db, owners, adminId).catch(() => null);
        const message = buildPlanAssignedEmail(
          member.email,
          program.name,
          admin?.displayName ?? 'Tu gimnasio',
          appUrl,
        );
        // Después de responder y sin propagar: el plan ya está subido, y un
        // proveedor de correo caído no lo deshace.
        email.send(message).catch((cause: unknown) => {
          console.error('[admin] no se ha podido avisar del plan nuevo:', cause);
        });
      }
    }),
  );

  /** El plan del socio con todo lo que ha anotado, en la plantilla de siempre. */
  router.get(
    '/members/:userId/programs/:programId/export',
    readLimiter,
    handle(async (req, res) => {
      const member = await loadMember(req, res);
      if (!member) return;
      const program = await getProgram(db, idParam.parse(req.params.programId), member.id);
      if (!program) {
        res.status(404).json({ error: 'El programa no existe.' });
        return;
      }

      const name = exportFileName(program);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="entrenamiento.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      );
      res.send(Buffer.from(buildWorkbook(program)));
    }),
  );

  router.delete(
    '/members/:userId/programs/:programId',
    writeLimiter,
    handle(async (req, res) => {
      const member = await loadMember(req, res);
      if (!member) return;
      const deleted = await deleteProgram(db, idParam.parse(req.params.programId), member.id);
      if (!deleted) {
        res.status(404).json({ error: 'El programa no existe.' });
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}
