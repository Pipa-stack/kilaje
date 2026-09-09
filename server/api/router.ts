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
import { buildWorkbook, exportFileName } from '../parser/excelExporter';
import type { Database } from '../db/database';
import {
  createBlankProgram,
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
  saveExerciseNote,
  saveExerciseSetup,
  saveSet,
  updateSession,
} from '../repositories/sessions';
import { appendWeek, removeWeek, WeekLimitError } from '../repositories/weeks';
import { addDay, removeDay } from '../repositories/days';
import {
  addExercise,
  moveExercise,
  PlanLimitError,
  removeExercise,
  updateExercise,
} from '../repositories/exercises';
import {
  appendWeekBody,
  blankProgramBody,
  deleteSetBody,
  exerciseFieldsBody,
  exerciseNoteBody,
  idParam,
  moveExerciseBody,
  newExerciseBody,
  sanitizeFileName,
  saveSetBody,
  sessionPatchBody,
} from './schemas';
import { currentUserId } from './authRouter';
import { SILENT_ALERTER, type Alerter } from '../email/alerts';
import { loadHistory } from '../repositories/history';
import { listLifts } from '../repositories/profile';
import {
  createImportLimiter,
  createPlanLimiter,
  createProgramReadLimiter,
  createReadLimiter,
  createWriteLimiter,
} from './rateLimit';

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
  const passThrough = (_req: Request, _res: Response, next: NextFunction): void => next();
  const byUser = (req: Request): string => `user:${currentUserId(req)}`;
  const importLimiter = rateLimits ? createImportLimiter() : passThrough;
  const planLimiter = rateLimits ? createPlanLimiter() : passThrough;
  const readLimiter = rateLimits ? createReadLimiter(byUser) : passThrough;
  const programReadLimiter = rateLimits ? createProgramReadLimiter(byUser) : passThrough;
  const writeLimiter = rateLimits ? createWriteLimiter(byUser) : passThrough;

  router.get(
    '/programs',
    programReadLimiter,
    handle(async (req, res) => {
      res.json({ programs: await listPrograms(db, currentUserId(req)) });
    }),
  );

  /** The program to open on load: the most recently imported one. */
  router.get(
    '/programs/latest',
    programReadLimiter,
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
    programReadLimiter,
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

  /**
   * Starts an empty plan, for somebody who has no spreadsheet to import.
   *
   * The app was unusable without a coach's `.xlsx`: the first screen offered
   * one door and no other. This creates the week and its days; the exercises
   * go in through the plan editor that already exists.
   */
  router.post(
    '/programs/blank',
    planLimiter,
    handle(async (req, res) => {
      const { days } = blankProgramBody.parse(req.body ?? {});
      const program = await createBlankProgram(db, currentUserId(req), days);
      res.status(201).json({ program });
    }),
  );

  /**
   * Starts the next week of a program.
   *
   * The plan is cloned from the last week and the sets are left empty, so a
   * mesocycle can run past the weeks the workbook happened to contain without
   * anyone having to edit the spreadsheet and upload it again.
   */
  router.post(
    '/programs/:programId/weeks',
    planLimiter,
    handle(async (req, res) => {
      const programId = idParam.parse(req.params.programId);
      const { copyWeights } = appendWeekBody.parse(req.body ?? {});
      const program = await appendWeek(db, programId, currentUserId(req), { copyWeights });
      if (!program) {
        res.status(404).json({ error: 'El programa no existe.' });
        return;
      }
      res.status(201).json({ program });
    }),
  );

  /**
   * Deletes a week nobody has trained.
   *
   * Refuses rather than cascades when there is work logged against it: the
   * button that created the week is one tap, and one tap must not be able to
   * erase a session.
   */
  router.delete(
    '/programs/:programId/weeks/:weekNumber',
    planLimiter,
    handle(async (req, res) => {
      const programId = idParam.parse(req.params.programId);
      const weekNumber = idParam.parse(req.params.weekNumber);
      const { outcome, program } = await removeWeek(
        db,
        programId,
        weekNumber,
        currentUserId(req),
      );

      if (outcome === 'no existe') {
        res.status(404).json({ error: 'Esa semana no existe.' });
        return;
      }
      if (outcome === 'es la unica') {
        res.status(409).json({
          error: 'Es la única semana del programa. Borra el programa entero si es lo que quieres.',
        });
        return;
      }
      if (outcome === 'no es la ultima') {
        res.status(409).json({
          error: 'Solo se puede borrar la última semana del programa.',
        });
        return;
      }
      if (outcome === 'tiene trabajo anotado') {
        res.status(409).json({
          error: 'Esa semana tiene entrenamiento anotado. Vacía sus días antes de borrarla.',
        });
        return;
      }

      res.json({ program });
    }),
  );

  /* ------------------------------------------------------------------ */
  /* Editing the plan                                                    */
  /* ------------------------------------------------------------------ */

  /** Adds a session to the end of a week. */
  router.post(
    '/programs/:programId/weeks/:weekNumber/days',
    planLimiter,
    handle(async (req, res) => {
      const programId = idParam.parse(req.params.programId);
      const weekNumber = idParam.parse(req.params.weekNumber);
      const { outcome, program } = await addDay(db, programId, weekNumber, currentUserId(req));

      if (outcome === 'no existe') {
        res.status(404).json({ error: 'Esa semana no existe.' });
        return;
      }
      if (outcome === 'semana llena') {
        res.status(409).json({ error: 'Una semana no puede tener más de 7 sesiones.' });
        return;
      }
      res.status(201).json({ program });
    }),
  );

  /**
   * Removes a session nobody has trained.
   *
   * Refuses rather than cascades when there is work logged against it: one tap
   * created the day and one tap must not be able to erase a session.
   */
  router.delete(
    '/days/:dayId',
    planLimiter,
    handle(async (req, res) => {
      const dayId = idParam.parse(req.params.dayId);
      const userId = currentUserId(req);
      const { outcome, programId } = await removeDay(db, dayId, userId);

      if (outcome === 'no existe') {
        res.status(404).json({ error: 'Ese día no existe.' });
        return;
      }
      if (outcome === 'es el unico') {
        res.status(409).json({ error: 'Es la única sesión de la semana.' });
        return;
      }
      if (outcome === 'tiene trabajo anotado') {
        res.status(409).json({
          error: 'Ese día tiene entrenamiento anotado. Vacíalo antes de borrarlo.',
        });
        return;
      }

      res.json({ program: await getProgram(db, programId!, userId) });
    }),
  );

  router.post(
    '/days/:dayId/exercises',
    planLimiter,
    handle(async (req, res) => {
      const dayId = idParam.parse(req.params.dayId);
      const input = newExerciseBody.parse(req.body);
      const program = await addExercise(db, dayId, currentUserId(req), input);
      if (!program) {
        res.status(404).json({ error: 'Ese día no existe.' });
        return;
      }
      res.status(201).json({ program });
    }),
  );

  /** Renames an exercise, or changes its protocol, note or video. */
  router.put(
    '/exercises/:exerciseId',
    planLimiter,
    handle(async (req, res) => {
      const exerciseId = idParam.parse(req.params.exerciseId);
      const fields = exerciseFieldsBody.parse(req.body);
      const updated = await updateExercise(db, exerciseId, currentUserId(req), fields);
      if (!updated) {
        res.status(404).json({ error: 'Ese ejercicio no existe.' });
        return;
      }
      res.status(204).end();
    }),
  );

  /** Moves an exercise one place up or down within its day. */
  router.post(
    '/exercises/:exerciseId/move',
    planLimiter,
    handle(async (req, res) => {
      const exerciseId = idParam.parse(req.params.exerciseId);
      const { offset } = moveExerciseBody.parse(req.body);
      const program = await moveExercise(db, exerciseId, currentUserId(req), offset);
      if (!program) {
        res.status(404).json({ error: 'Ese ejercicio no existe.' });
        return;
      }
      res.json({ program });
    }),
  );

  /** Deletes an exercise and every set logged against it. */
  router.delete(
    '/exercises/:exerciseId',
    planLimiter,
    handle(async (req, res) => {
      const exerciseId = idParam.parse(req.params.exerciseId);
      const program = await removeExercise(db, exerciseId, currentUserId(req));
      if (!program) {
        res.status(404).json({ error: 'Ese ejercicio no existe.' });
        return;
      }
      res.json({ program });
    }),
  );

  /**
   * Downloads a program as a workbook.
   *
   * The layout is the one the importer reads, so this file is a real backup
   * rather than a souvenir: it can be uploaded back into this app, or into a
   * different deployment of it, and produce the same training. Continuous
   * backups cost money; this costs nothing and lives wherever the user puts it.
   */
  router.get(
    '/programs/:programId/export',
    readLimiter,
    handle(async (req, res) => {
      const programId = idParam.parse(req.params.programId);
      const program = await getProgram(db, programId, currentUserId(req));
      if (!program) {
        res.status(404).json({ error: 'El programa no existe.' });
        return;
      }

      const bytes = buildWorkbook(program);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      // RFC 5987 as well as the plain form: the name carries accents.
      const name = exportFileName(program);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="entrenamiento.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      );
      res.send(Buffer.from(bytes));
    }),
  );

  /** Deletes a program and all the training logged against it. */
  router.delete(
    '/programs/:programId',
    planLimiter,
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
    readLimiter,
    handle(async (req, res) => {
      res.json({ exercises: await loadHistory(db, currentUserId(req)) });
    }),
  );

  /**
   * Every movement you have trained, with its best set and where it is going.
   *
   * Spans programs, like `/history`, because "how much do I press" is not a
   * question about one spreadsheet.
   */
  router.get(
    '/profile/lifts',
    readLimiter,
    handle(async (req, res) => {
      res.json({ lifts: await listLifts(db, currentUserId(req)) });
    }),
  );

  /** Records one set of one exercise within a day. */
  router.put(
    '/days/:dayId/sets',
    writeLimiter,
    handle(async (req, res) => {
      const dayId = idParam.parse(req.params.dayId);
      const { exerciseId, setIndex, weight, reps, rir } = saveSetBody.parse(req.body);
      await saveSet(db, dayId, exerciseId, setIndex, { weight, reps, rir }, currentUserId(req));
      res.status(204).end();
    }),
  );

  router.delete(
    '/days/:dayId/sets',
    writeLimiter,
    handle(async (req, res) => {
      const dayId = idParam.parse(req.params.dayId);
      const { exerciseId, setIndex } = deleteSetBody.parse(req.body);
      await deleteSet(db, dayId, exerciseId, setIndex, currentUserId(req));
      res.status(204).end();
    }),
  );

  /**
   * The permanent setup note for a movement: "banco pin 4, agarre ancho".
   *
   * Written against one exercise but stored per lineage, so it lands on every
   * week of the program at once. Answers 204: the client already has the text.
   */
  router.put(
    '/exercises/:exerciseId/setup',
    writeLimiter,
    handle(async (req, res) => {
      const exerciseId = idParam.parse(req.params.exerciseId);
      const { note } = exerciseNoteBody.parse(req.body);
      const saved = await saveExerciseSetup(db, exerciseId, note, currentUserId(req));
      if (!saved) {
        res.status(404).json({ error: 'Ese ejercicio no existe.' });
        return;
      }
      res.status(204).end();
    }),
  );

  /** What happened today on one exercise. Belongs to the session. */
  router.put(
    '/days/:dayId/exercises/:exerciseId/note',
    writeLimiter,
    handle(async (req, res) => {
      const dayId = idParam.parse(req.params.dayId);
      const exerciseId = idParam.parse(req.params.exerciseId);
      const { note } = exerciseNoteBody.parse(req.body);
      await saveExerciseNote(db, dayId, exerciseId, note, currentUserId(req));
      res.status(204).end();
    }),
  );

  /** Session notes, the completed flag and the clock. */
  router.patch(
    '/days/:dayId/session',
    writeLimiter,
    handle(async (req, res) => {
      const dayId = idParam.parse(req.params.dayId);
      await updateSession(db, dayId, sessionPatchBody.parse(req.body), currentUserId(req));
      res.status(204).end();
    }),
  );

  /** Clears the work logged for a day, leaving the template intact. */
  router.delete(
    '/days/:dayId/session',
    writeLimiter,
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
/** Identifies the errors `express.json` / `express.raw` throw, by their type tag. */
function isBodyError(error: unknown, type: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === type
  );
}

/**
 * Builds the error middleware, wired to whatever raises the alarm.
 *
 * A parameter rather than an import so tests get silence for free and no
 * network call can escape from a suite.
 */
export function createApiErrorHandler(alerter: Alerter = SILENT_ALERTER) {
  return (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    apiErrorHandler(error, req, res, next, alerter);
  };
}

export function apiErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
  alerter: Alerter = SILENT_ALERTER,
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

  if (error instanceof WeekLimitError || error instanceof PlanLimitError) {
    res.status(409).json({ error: error.message });
    return;
  }

  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }

  // Body parsers reject before any handler runs, so these never reach the
  // checks inside the routes. Without them a file over the limit and a
  // truncated JSON body both answer 500, which tells the client the server
  // broke when in fact it refused a bad request.
  if (isBodyError(error, 'entity.too.large')) {
    res.status(413).json({ error: 'El archivo supera el límite de 10 MB.' });
    return;
  }

  if (isBodyError(error, 'entity.parse.failed')) {
    res.status(400).json({ error: 'Datos inválidos.' });
    return;
  }

  // Everything above is a request the server understood and refused. Reaching
  // here means the server itself is wrong, which is the only class of failure
  // worth waking somebody for.
  console.error('[api] error no controlado:', error);
  alerter.report({ method: req.method, path: req.path, error });
  res.status(500).json({ error: 'Error interno del servidor.' });
}
