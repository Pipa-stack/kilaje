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
import type { Database } from './db/database';
import { apiErrorHandler, createApiRouter } from './api/router';

export interface AppOptions {
  db: Database;
  /** Absolute path to the Vite build. Omitted in tests. */
  staticDir?: string;
}

export function createApp({ db, staticDir }: AppOptions): Express {
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

  app.use('/api', createApiRouter(db));
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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}
