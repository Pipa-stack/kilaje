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
import { apiErrorHandler, createApiRouter } from './api/router';
import { attachUser, createAuthRouter, requireUser } from './api/authRouter';
import { createProfileRouter } from './api/profileRouter';
import type { EmailSender } from './email/sender';

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
}

export function createApp({ db, staticDir, rateLimits = true, email, appUrl }: AppOptions): Express {
  const app = express();

  // Behind Railway's proxy; needed for correct protocol detection.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(securityHeaders);

  // Workbook uploads arrive as raw bytes. The limit is enforced here as well
  // as in the handler so oversized bodies are rejected before buffering.
  app.use(
    '/api/programs',
    express.raw({ type: 'application/octet-stream', limit: MAX_FILE_BYTES }),
  );
  app.use(express.json({ limit: '64kb' }));

  // Identify the caller for every API request, then gate everything that is
  // not a login or a health probe.
  // Railway probes this; it must not require a session.
  app.get('/api/health', (_req, res) => {
    ping(db)
      .then(() => res.json({ status: 'ok' }))
      .catch(() => res.status(503).json({ status: 'sin base de datos' }));
  });

  app.use('/api', attachUser(db));
  app.use('/api/auth', createAuthRouter(db, { rateLimits, email, appUrl }));
  app.use('/api/profile', requireUser, createProfileRouter(db));
  app.use('/api', requireUser, createApiRouter(db, rateLimits));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado.' });
  });
  app.use('/api', apiErrorHandler);

  if (staticDir && existsSync(staticDir)) {
    app.use(
      express.static(staticDir, {
        // Hashed asset filenames can be cached hard; index.html cannot.
        setHeaders: (res, path) => {
          if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
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
  next();
}
