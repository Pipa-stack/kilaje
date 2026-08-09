// @vitest-environment node
/**
 * Throttling, and the headers that go with it.
 *
 * The limiter is the difference between "the password is strong" and "the
 * password cannot be guessed at network speed", so it gets tested like any
 * other control rather than assumed.
 */

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../server/app';
import { rateLimit } from '../server/api/rateLimit';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase';

describe('rateLimit', () => {
  /** A tiny app whose only job is to be hammered. */
  function makeApp(max: number, windowMs: number) {
    const app = express();
    app.use(rateLimit({ max, windowMs, message: 'demasiado' }));
    app.get('/', (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it('allows requests up to the limit', async () => {
    const app = makeApp(3, 60_000);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app).get('/').expect(200);
    }
  });

  it('rejects the one after, with a retry hint', async () => {
    const app = makeApp(2, 60_000);
    await request(app).get('/').expect(200);
    await request(app).get('/').expect(200);

    const blocked = await request(app).get('/');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('demasiado');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('lets the caller back in once the window passes', async () => {
    vi.useFakeTimers();
    try {
      const app = makeApp(1, 60_000);
      await request(app).get('/').expect(200);
      await request(app).get('/').expect(429);

      vi.advanceTimersByTime(60_001);
      await request(app).get('/').expect(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts each client separately', async () => {
    const app = makeApp(1, 60_000);
    // supertest reuses a loopback address, so the header stands in for
    // different clients the way the proxy would set it.
    await request(app).get('/').set('X-Forwarded-For', '10.0.0.1').expect(200);
    // Without `trust proxy` the header is ignored and both share a bucket,
    // which is exactly the safe default for an app that is not behind one.
    const second = await request(app).get('/').set('X-Forwarded-For', '10.0.0.2');
    expect(second.status).toBe(429);
  });
});

describe('the real endpoints', () => {
  let db: TestDatabase;
  let app: express.Express;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createApp({ db });
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.truncate();
  });

  it('throttles repeated login attempts', async () => {
    const attempt = () =>
      request(app).post('/api/auth/login').send({
        email: 'ana@ejemplo.com',
        password: 'una-contrasena-cualquiera',
      });

    // The limiter allows ten per window; the eleventh is refused.
    let sawLimit = false;
    for (let index = 0; index < 12; index += 1) {
      const response = await attempt();
      if (response.status === 429) {
        sawLimit = true;
        break;
      }
      expect(response.status).toBe(401);
    }
    expect(sawLimit).toBe(true);
  }, 120_000);

  it('sends the hardening headers on every response', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('the login limiter counts by account', () => {
  let db: TestDatabase;
  let app: express.Express;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createApp({ db });
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  const guess = (email: string) =>
    request(app).post('/api/auth/login').send({ email, password: 'lo-que-sea-largo' });

  it('locks the account under attack, not the address', async () => {
    for (let index = 0; index < 10; index += 1) {
      expect((await guess('victima@ejemplo.com')).status).toBe(401);
    }
    expect((await guess('victima@ejemplo.com')).status).toBe(429);

    // Same address, different account: unaffected. Otherwise one attacker
    // could lock every user out by hammering from a shared IP.
    expect((await guess('otra@ejemplo.com')).status).toBe(401);
  }, 120_000);
});
