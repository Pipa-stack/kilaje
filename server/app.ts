/**
 * Express application: the API plus the built frontend, in one service.
 *
 * Keeping both in a single process is the simplest thing that satisfies
 * "frontend → backend → PostgreSQL": one Railway service, one origin, no CORS
 * and no proxy configuration.
 */

import { existsSync } from 'node:fs';

import express, { type Express } from 'express';

import { MAX_FILE_BYTES } from '../src/domain/upload';
import { ping, type Database } from './db/database';
import { createApiErrorHandler, createApiRouter } from './api/router';
import { attachUser, createAuthRouter, requireUser } from './api/authRouter';
import { createProfileRouter } from './api/profileRouter';
import { createClassesRouter } from './api/classesRouter';
import { createAdminRouter } from './api/adminRouter';
import { createAnnouncementsRouter } from './api/announcementsRouter';
import { createPublicPagesRouter, type PublicPagesOptions } from './api/publicPages';
import { ownerSet, requireAdmin } from './auth/roles';
import type { EmailSender } from './email/sender';
import { SILENT_ALERTER, type Alerter } from './email/alerts';

export interface AppOptions {
  db: Database;
  /** Absolute path to the Vite build. Omitted in tests. */
  staticDir?: string;
  /**
   * Throttling on the login and import endpoints. On by default, and only
   * turned off by the browser-test harness, which drives one long-lived app
   * through more sign-ins than a real client ever would. The limiter itself
   * is covered by `tests/rateLimit.test.ts`.
   */
  rateLimits?: boolean;
  /** Absent in tests and where mail is not configured. */
  email?: EmailSender;
  /** Origin used to build absolute links in emails. */
  appUrl?: string;
  /** Raises the alarm on a 500. Silent unless the server wires one up. */
  alerter?: Alerter;
  /** Correos de quienes administran las clases del gimnasio. */
  adminEmails?: readonly string[];
  /** El reloj de las reservas. Solo lo cambian los tests. */
  clock?: () => Date;
  /** Privacidad y verificación de la app de Android: ver `api/publicPages.ts`. */
  publicPages?: Pick<PublicPagesOptions, 'privacyOwner' | 'privacyContact' | 'twaPackage' | 'twaFingerprints'>;
}

export function createApp({
  db,
  staticDir,
  rateLimits = true,
  email,
  appUrl,
  alerter = SILENT_ALERTER,
  adminEmails,
  clock,
  publicPages = {},
}: AppOptions): Express {
  const app = express();
  const owners = ownerSet(adminEmails);

  // Behind Railway's proxy; needed for correct protocol detection.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(securityHeaders);

  // Railway probes this; it must not require a session.
  app.get('/api/health', (_req, res) => {
    ping(db)
      .then(() => res.json({ status: 'ok' }))
      .catch(() => res.status(503).json({ status: 'sin base de datos' }));
  });

  // Privacidad, borrar la cuenta sin la app y la verificación de Android:
  // públicas, sin sesión, y antes que la app de una sola página, que si no
  // contestaría a todo con su index.html.
  app.use(createPublicPagesRouter(db, { rateLimits, email, appUrl, ...publicPages }));

  // Identify the caller before anything reads a body, so an unauthenticated
  // request is answered without buffering what it sent.
  app.use('/api', attachUser(db));

  app.use(express.json({ limit: '64kb' }));

  // Workbook uploads arrive as raw bytes, and 10 MB of them is the largest
  // thing this server will hold in memory for one request. `requireUser` runs
  // first on purpose: without it, anyone at all could park 10 MB per
  // connection in the heap and only then be told to log in.
  app.use(
    '/api/programs',
    requireUser,
    express.raw({ type: 'application/octet-stream', limit: MAX_FILE_BYTES }),
  );

  // Lo mismo para los planes que quien administra sube a un socio, y aquí
  // además se comprueba el rol antes de leer nada: un socio no tiene por qué
  // poder aparcar 10 MB en memoria para que luego se le diga que no.
  app.use(
    '/api/admin',
    requireUser,
    requireAdmin(db, owners),
    express.raw({ type: 'application/octet-stream', limit: MAX_FILE_BYTES }),
  );

  app.use('/api/auth', createAuthRouter(db, { rateLimits, email, appUrl, owners }));
  app.use('/api/admin', createAdminRouter(db, { rateLimits, owners, email, appUrl }));
  app.use('/api/announcements', requireUser, createAnnouncementsRouter(db, { rateLimits, owners }));
  app.use('/api/profile', requireUser, createProfileRouter(db, rateLimits));
  app.use(
    '/api/classes',
    requireUser,
    createClassesRouter(db, { rateLimits, adminEmails, email, appUrl, clock }),
  );
  app.use('/api', requireUser, createApiRouter(db, rateLimits));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado.' });
  });
  app.use('/api', createApiErrorHandler(alerter));

  if (staticDir && existsSync(staticDir)) {
    app.use(
      express.static(staticDir, {
        // Hashed asset filenames can be cached hard; index.html cannot.
        setHeaders: (res, path) => {
          if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
          // The worker decides what every other request is allowed to serve
          // from cache, so a stale copy of it would pin the whole app to an
          // old deploy. It is the one file that must always be revalidated.
          else if (path.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
          else if (path.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );

    // Single-page app: any non-API route renders the client.
    app.get(/.*/, (_req, res) => {
      res.sendFile('index.html', { root: staticDir });
    });
  }

  return app;
}

/**
 * The same protections the static `index.html` declared, applied at the edge
 * so they also cover API responses.
 */
function securityHeaders(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      'frame-ancestors \'none\'',
    ].join('; '),
  );
  // Once a browser has seen this, it refuses to talk to the app over plain
  // HTTP at all, which closes the downgrade window on a hostile network.
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // Isolates the browsing context: nothing this page opens (or that opens it)
  // shares an agent cluster with it, and no other origin can embed its
  // responses as a subresource.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}
