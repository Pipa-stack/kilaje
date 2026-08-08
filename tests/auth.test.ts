// @vitest-environment node
/**
 * Accounts, sessions, and the isolation between them.
 *
 * The isolation block is the important half: it proves that a signed-in user
 * cannot reach another user's programs, days or sets by guessing ids.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server/app';
import { hashPassword, verifyPassword } from '../server/auth/passwords';
import { seedReferenceProgram } from '../server/db/seed';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase';

const REFERENCE_FILE = resolve(process.cwd(), 'Ejemplo/ejemplo.xlsx');
const workbook = () => readFileSync(REFERENCE_FILE);

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

const PASSWORD = 'una-contrasena-larga';

/** Registers an account and returns an agent that keeps its cookie. */
async function signUp(email: string) {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/register').send({ email, password: PASSWORD });
  expect(response.status).toBe(201);
  return agent;
}

async function importWorkbook(agent: ReturnType<typeof request.agent>, extra = 0) {
  const bytes = extra > 0 ? Buffer.concat([workbook(), Buffer.alloc(extra)]) : workbook();
  const response = await agent
    .post('/api/programs?filename=ejemplo.xlsx')
    .set('Content-Type', 'application/octet-stream')
    .send(bytes);
  expect(response.status).toBe(201);
  return response.body.program;
}

describe('password hashing', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
  }, 20_000);

  it('rejects the wrong password', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword('otra-cosa-distinta', hash)).toBe(false);
  }, 20_000);

  it('never stores the password itself', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toContain(PASSWORD);
    expect(hash.startsWith('scrypt$')).toBe(true);
  }, 20_000);

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
  }, 30_000);

  it('returns false for a corrupted hash instead of throwing', async () => {
    expect(await verifyPassword(PASSWORD, 'basura')).toBe(false);
    expect(await verifyPassword(PASSWORD, '')).toBe(false);
    expect(await verifyPassword(PASSWORD, 'scrypt$x$y$z$q$w')).toBe(false);
  });
});

describe('registration', () => {
  it('creates an account and signs it in', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'Ana@Ejemplo.com', password: PASSWORD });

    expect(response.status).toBe(201);
    // Stored lower-cased, so case cannot split one person into two accounts.
    expect(response.body.user.email).toBe('ana@ejemplo.com');
    expect(response.headers['set-cookie']?.[0]).toMatch(/gimnasio_session=/);
    expect(response.headers['set-cookie']?.[0]).toMatch(/HttpOnly/i);
    expect(response.headers['set-cookie']?.[0]).toMatch(/SameSite=Lax/i);
  }, 20_000);

  it('never returns the password hash', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'ana@ejemplo.com', password: PASSWORD });
    expect(JSON.stringify(response.body)).not.toMatch(/scrypt|password/i);
  }, 20_000);

  it('refuses a duplicate email regardless of case', async () => {
    await signUp('ana@ejemplo.com');
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'ANA@ejemplo.com', password: PASSWORD });
    expect(response.status).toBe(409);
  }, 30_000);

  it('refuses a short password', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'ana@ejemplo.com', password: 'corta' });
    expect(response.status).toBe(400);
  });

  it('refuses an invalid email', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'no-es-un-correo', password: PASSWORD });
    expect(response.status).toBe(400);
  });

  it('hands the seeded program to the first account only', async () => {
    expect(await seedReferenceProgram(db, REFERENCE_FILE)).toBe('importado');

    const first = await signUp('primera@ejemplo.com');
    const second = await signUp('segunda@ejemplo.com');

    const forFirst = await first.get('/api/programs').expect(200);
    const forSecond = await second.get('/api/programs').expect(200);

    expect(forFirst.body.programs).toHaveLength(1);
    expect(forSecond.body.programs).toHaveLength(0);
  }, 60_000);
});

describe('login and logout', () => {
  it('signs in with the right credentials', async () => {
    await signUp('ana@ejemplo.com');
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@ejemplo.com', password: PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('ana@ejemplo.com');
  }, 40_000);

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await signUp('ana@ejemplo.com');

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@ejemplo.com', password: 'otra-contrasena-larga' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nadie@ejemplo.com', password: PASSWORD });

    // Different messages would turn this into a way of finding out who has
    // an account here.
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error).toBe(unknownEmail.body.error);
  }, 60_000);

  it('ends the session on logout', async () => {
    const agent = await signUp('ana@ejemplo.com');
    await agent.get('/api/auth/me').expect(200);
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
  }, 30_000);

  it('revokes the token server-side, not just in the browser', async () => {
    const agent = await signUp('ana@ejemplo.com');
    await agent.post('/api/auth/logout').expect(204);

    const { rows } = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM sessions',
    );
    expect(rows[0]?.count).toBe(0);
  }, 30_000);

  it('stores only a hash of the session token', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'ana@ejemplo.com', password: PASSWORD })
      .expect(201);

    const setCookie = response.headers['set-cookie'] as unknown as string[];
    const token = /gimnasio_session=([^;]+)/.exec(setCookie[0] ?? '')?.[1];
    expect(token).toBeTruthy();

    const { rows } = await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(rows[0]?.token_hash).toBeTruthy();
    expect(rows[0]?.token_hash).not.toBe(token);
  }, 30_000);

  it('ignores a made-up cookie', async () => {
    await request(app).get('/api/auth/me').set('Cookie', 'gimnasio_session=inventado').expect(401);
  });
});

describe('the API requires a session', () => {
  it.each([
    ['GET', '/api/programs'],
    ['GET', '/api/programs/latest'],
    ['GET', '/api/programs/1'],
    ['POST', '/api/programs'],
    ['DELETE', '/api/programs/1'],
    ['PUT', '/api/days/1/sets'],
    ['DELETE', '/api/days/1/sets'],
    ['PATCH', '/api/days/1/session'],
    ['DELETE', '/api/days/1/session'],
  ])('%s %s answers 401 without one', async (method, path) => {
    const response = await request(app)[method.toLowerCase() as 'get'](path);
    expect(response.status).toBe(401);
  });

  it('leaves the health probe open, because Railway calls it', async () => {
    await request(app).get('/api/health').expect(200);
  });
});

describe('isolation between accounts', () => {
  let ana: ReturnType<typeof request.agent>;
  let bruno: ReturnType<typeof request.agent>;
  let anaProgram: { id: number; weeks: { days: { id: string; exercises: { id: string }[] }[] }[] };

  beforeEach(async () => {
    ana = await signUp('ana@ejemplo.com');
    bruno = await signUp('bruno@ejemplo.com');
    anaProgram = await importWorkbook(ana);
  }, 60_000);

  it('does not list another account\'s programs', async () => {
    const { body } = await bruno.get('/api/programs').expect(200);
    expect(body.programs).toEqual([]);
  });

  it('404s when reading another account\'s program', async () => {
    await bruno.get(`/api/programs/${anaProgram.id}`).expect(404);
  });

  it('404s on /latest when the other account has nothing', async () => {
    await bruno.get('/api/programs/latest').expect(404);
  });

  it('refuses to delete another account\'s program', async () => {
    await bruno.delete(`/api/programs/${anaProgram.id}`).expect(404);
    // And it really is still there.
    await ana.get(`/api/programs/${anaProgram.id}`).expect(200);
  });

  it('refuses to write a set into another account\'s day', async () => {
    const dayId = anaProgram.weeks[0]!.days[0]!.id;
    const exerciseId = Number(anaProgram.weeks[0]!.days[0]!.exercises[0]!.id);

    await bruno
      .put(`/api/days/${dayId}/sets`)
      .send({ exerciseId, setIndex: 1, weight: 999, reps: 1, rir: 0 })
      .expect(404);

    // Ana's data is untouched.
    const { body } = await ana.get('/api/programs/latest').expect(200);
    expect(body.program.weeks[0].days[0].exercises[0].currentWeek[1]).toEqual({
      weight: null,
      reps: null,
      rir: null,
    });
  });

  it('refuses to touch another account\'s notes or completion', async () => {
    const dayId = anaProgram.weeks[0]!.days[0]!.id;

    await bruno.patch(`/api/days/${dayId}/session`).send({ notes: 'hola' }).expect(404);
    await bruno.delete(`/api/days/${dayId}/session`).expect(404);

    const { body } = await ana.get('/api/programs/latest').expect(200);
    expect(body.program.weeks[0].days[0].notes).toBe('');
  });

  it('lets both accounts import the same workbook independently', async () => {
    // The hash is unique per owner, not globally, so this must not collide.
    const brunoProgram = await importWorkbook(bruno);
    expect(brunoProgram.id).not.toBe(anaProgram.id);

    const forBruno = await bruno.get('/api/programs').expect(200);
    expect(forBruno.body.programs).toHaveLength(1);
  }, 40_000);

  it('still de-duplicates within one account', async () => {
    const again = await ana
      .post('/api/programs?filename=ejemplo.xlsx')
      .set('Content-Type', 'application/octet-stream')
      .send(workbook());
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
  }, 40_000);

  it('deletes a user\'s data with the account, and nobody else\'s', async () => {
    await importWorkbook(bruno);

    const { rows: before } = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM programs',
    );
    expect(before[0]?.count).toBe(2);

    await db.query('DELETE FROM users WHERE email = $1', ['ana@ejemplo.com']);

    const { rows: after } = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM programs',
    );
    expect(after[0]?.count).toBe(1);

    const stillThere = await bruno.get('/api/programs').expect(200);
    expect(stillThere.body.programs).toHaveLength(1);
  }, 60_000);
});
