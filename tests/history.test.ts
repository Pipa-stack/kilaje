// @vitest-environment node
/**
 * History across programs, and changing the password.
 *
 * The history question the app has to answer is "is my bench going up?",
 * which spans several imports of the spreadsheet. Exercises are matched by
 * name because ids are per-program.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server/app';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase';

const REFERENCE_FILE = resolve(process.cwd(), 'Ejemplo/ejemplo.xlsx');
const workbook = () => readFileSync(REFERENCE_FILE);
const BENCH = 'PRESS DE BANCA PLANO CON BARRA LIBRE';
const PASSWORD = 'contrasena-de-prueba';

let db: TestDatabase;
let app: express.Express;
let agent: ReturnType<typeof request.agent>;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.truncate();
  // A fresh app per test, so one test's login attempts do not spend the
  // rate-limit window of the next one. The database is shared; only the
  // in-memory counters are reset.
  app = createApp({ db });
  agent = request.agent(app);
  await agent
    .post('/api/auth/register')
    .send({ email: 'ana@ejemplo.com', password: PASSWORD })
    .expect(201);
}, 30_000);

/** Imports the workbook; `extra` bytes make it a distinct file. */
async function importWorkbook(extra = 0) {
  const bytes = extra > 0 ? Buffer.concat([workbook(), Buffer.alloc(extra)]) : workbook();
  const response = await agent
    .post('/api/programs?filename=ejemplo.xlsx')
    .set('Content-Type', 'application/octet-stream')
    .send(bytes)
    .expect(201);
  return response.body.program;
}

async function history() {
  const { body } = await agent.get('/api/history').expect(200);
  return body.exercises as {
    name: string;
    sessions: number;
    programs: number;
    totalVolume: number;
    bestOneRepMax: number | null;
    bestWeight: number | null;
    entries: { programName: string; oneRepMax: number | null; volume: number }[];
  }[];
}

describe('GET /api/history', () => {
  it('is empty before anything is logged', async () => {
    expect(await history()).toEqual([]);
  });

  it('reports what the workbook already carried', async () => {
    await importWorkbook();

    const bench = (await history()).find((exercise) => exercise.name === BENCH);
    expect(bench).toBeDefined();
    expect(bench?.sessions).toBe(1);
    expect(bench?.programs).toBe(1);
    // 82.5 kg x 4 reps was recorded in the sheet.
    expect(bench?.totalVolume).toBe(330);
    expect(bench?.bestOneRepMax).toBe(93.5);
    expect(bench?.bestWeight).toBe(82.5);
  }, 40_000);

  it('joins the same exercise across two programs', async () => {
    const first = await importWorkbook();
    const dayId = first.weeks[0].days[0].id;
    const exerciseId = Number(first.weeks[0].days[0].exercises[0].id);

    await agent
      .put(`/api/days/${dayId}/sets`)
      .send({ exerciseId, setIndex: 1, weight: 90, reps: 3, rir: 0 })
      .expect(204);

    // A second mesocycle: a different file, the same exercise names.
    await importWorkbook(1);

    const bench = (await history()).find((exercise) => exercise.name === BENCH);
    expect(bench?.programs).toBe(2);
    expect(bench?.sessions).toBe(2);
    // 90 x 3 -> Epley 99, better than the 93.5 of the first session.
    expect(bench?.bestOneRepMax).toBe(99);
    expect(bench?.bestWeight).toBe(90);
  }, 60_000);

  it('orders each exercise oldest first, so a chart reads left to right', async () => {
    await importWorkbook();
    await importWorkbook(1);

    const bench = (await history()).find((exercise) => exercise.name === BENCH);
    expect(bench?.entries).toHaveLength(2);
    expect(bench?.entries[0]?.programName).toBe('ejemplo');
    expect(bench?.entries[1]?.programName).toContain('v2');
  }, 60_000);

  it('puts the most trained exercise first', async () => {
    await importWorkbook();
    const exercises = await history();
    // Only the bench has data in the reference workbook.
    expect(exercises[0]?.name).toBe(BENCH);
  }, 40_000);

  it('ignores exercises with no name', async () => {
    await importWorkbook();
    expect((await history()).every((exercise) => exercise.name !== '')).toBe(true);
  }, 40_000);

  it('never shows another account\'s history', async () => {
    await importWorkbook();

    const bruno = request.agent(app);
    await bruno
      .post('/api/auth/register')
      .send({ email: 'bruno@ejemplo.com', password: PASSWORD })
      .expect(201);

    const { body } = await bruno.get('/api/history').expect(200);
    expect(body.exercises).toEqual([]);
  }, 60_000);

  it('requires a session', async () => {
    await request(app).get('/api/history').expect(401);
  });
});

describe('POST /api/auth/password', () => {
  const NEW_PASSWORD = 'una-contrasena-nueva';

  it('changes the password and lets the new one in', async () => {
    await agent
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(204);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@ejemplo.com', password: NEW_PASSWORD })
      .expect(200);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@ejemplo.com', password: PASSWORD })
      .expect(401);
  }, 60_000);

  it('refuses without the current password', async () => {
    await agent
      .post('/api/auth/password')
      .send({ currentPassword: 'me-la-invento-entera', newPassword: NEW_PASSWORD })
      .expect(403);

    // And the old one still works.
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@ejemplo.com', password: PASSWORD })
      .expect(200);
  }, 60_000);

  it('refuses a new password that is too short', async () => {
    await agent
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: 'corta' })
      .expect(400);
  }, 30_000);

  it('refuses reusing the same password', async () => {
    await agent
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD })
      .expect(400);
  }, 30_000);

  it('revokes other sessions but keeps the one that made the change', async () => {
    // A second device signed into the same account.
    const otherDevice = request.agent(app);
    await otherDevice
      .post('/api/auth/login')
      .send({ email: 'ana@ejemplo.com', password: PASSWORD })
      .expect(200);
    await otherDevice.get('/api/auth/me').expect(200);

    await agent
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(204);

    // If the reason to change it was that somebody else got in, leaving
    // their session alive would defeat the point.
    await otherDevice.get('/api/auth/me').expect(401);
    // The device that made the change stays signed in.
    await agent.get('/api/auth/me').expect(200);
  }, 90_000);

  it('requires a session', async () => {
    await request(app)
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);
  });
});
