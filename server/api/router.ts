/**
 * The HTTP API.
 *
 * Deliberately small: list programs, read one, import a workbook, and record
 * what was lifted. Every handler validates its input before touching the
 * database and returns a plain `{ error }` object on failure.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';

import { MAX_FILE_BYTES, TemplateError } from '../../src/domain/upload';
import { parseWorkbook } from '../parser/excelParser';
import type { Database } from '../db/database';
import {
  deleteProgram,
  getProgram,
  hashSource,
  importProgram,
  listPrograms,
  findLatestProgramId,
} from '../repositories/programs';
import {
  NotFoundError,
  deleteSet,
  resetSession,
  saveSet,
  updateSession,
} from '../repositories/sessions';
import { deleteSetBody, idParam, sanitizeFileName, saveSetBody, sessionPatchBody } from './schemas';
import { currentUserId } from './authRouter';
import { loadHistory } from '../repositories/history';
import { createImportLimiter } from './rateLimit';

/** Wraps an async handler so rejections reach the error middleware. */
function handle(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function createApiRouter(db: Database, rateLimits = true): Router {
  const router = Router();
  const importLimiter = rateLimits
    ? createImportLimiter()
    : (_req: Request, _res: Response, next: NextFunction): void => next();

  router.get(
    '/programs',
    handle(async (req, res) => {
      res.json({ programs: await listPrograms(db, currentUserId(req)) });
    }),
  );

  /** The program to open on load: the most recently imported one. */
  router.get(
    '/programs/latest',
    handle(async (req, res) => {
      const id = await findLatestProgramId(db, currentUserId(req));
      if (id === null) {
        res.status(404).json({ error: 'Todavía no hay ningún programa importado.' });
        return;
      }
      res.json({ program: await getProgram(db, id, currentUserId(req)) });
    }),
  );

  router.get(
    '/programs/:programId',
    handle(async (req, res) => {
      const programId = idParam.parse(req.params.programId);
      const program = await getProgram(db, programId, currentUserId(req));
      if (!program) {
        res.status(404).json({ error: 'El programa no existe.' });
        return;
      }
      res.json({ program });
    }),
  );

  /**
   * Imports a workbook.
   *
   * The raw bytes are posted as `application/octet-stream`; parsing happens
   * here, on the server, so the database is never fed a program object built
   * by the client. Excel formulas are read as text and never evaluated.
   */
  router.post(
    '/programs',
    importLimiter,
    handle(async (req, res) => {
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
      const fileName = sanitizeFileName(rawName);
      const bytes = new Uint8Array(body);

      const parsed = parseWorkbook(bytes, fileName);
      const { program, created } = await importProgram(
        db,
        parsed,
        hashSource(bytes),
        currentUserId(req),
      );

      res.status(created ? 201 : 200).json({ program, created });
    }),
  );

  /** Deletes a program and all the training logged against it. */
  router.delete(
    '/programs/:programId',
    handle(async (req, res) => {
      const programId = idParam.parse(req.params.programId);
      const removed = await deleteProgram(db, programId, currentUserId(req));
      if (!removed) {
        res.status(404).json({ error: 'El programa no existe.' });
        return;
      }
      res.status(204).end();
    }),
  );

  /**
   * Everything ever logged, grouped by exercise name.
   *
   * Spans programs on purpose: a mesocycle is one import, and progress is
   * the thing that runs across them.
   */
  router.get(
    '/history',
    handle(async (req, res) => {
      res.json({ exercises: await loadHistory(db, currentUserId(req)) });
    }),
  );

  /** Records one set of one exercise within a day. */
  router.put(
    '/days/:dayId/sets',
    handle(async (req, res) => {
      const dayId = idParam.parse(req.params.dayId);
      const { exerciseId, setIndex, weight, reps, rir } = saveSetBody.parse(req.body);
      await saveSet(db, dayId, exerciseId, setIndex, { weight, reps, rir }, currentUserId(req));
      res.status(204).end();
    }),
  );

  router.delete(
    '/days/:dayId/sets',
    handle(async (req, res) => {
      const dayId = idParam.parse(req.params.dayId);
      const { exerciseId, setIndex } = deleteSetBody.parse(req.body);
      await deleteSet(db, dayId, exerciseId, setIndex, currentUserId(req));
      res.status(204).end();
    }),
  );

  /** Session notes and the completed flag. */
  router.patch(
    '/days/:dayId/session',
    handle(async (req, res) => {
      const dayId = idParam.parse(req.params.dayId);
      await updateSession(db, dayId, sessionPatchBody.parse(req.body), currentUserId(req));
      res.status(204).end();
    }),
  );

  /** Clears the work logged for a day, leaving the template intact. */
  router.delete(
    '/days/:dayId/session',
    handle(async (req, res) => {
      const dayId = idParam.parse(req.params.dayId);
      await resetSession(db, dayId, currentUserId(req));
      res.status(204).end();
    }),
  );

  return router;
}

/**
 * Turns known failures into status codes and hides everything else.
 *
 * Internal errors are logged server-side but never returned: a stack trace or
 * a driver message can disclose schema and connection details.
 */
export function apiErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Datos inválidos.',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (error instanceof TemplateError) {
    res.status(422).json({ error: error.message });
    return;
  }

  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }

  console.error('[api] error no controlado:', error);
  res.status(500).json({ error: 'Error interno del servidor.' });
}
