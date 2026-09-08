// @vitest-environment node
/**
 * Per-exercise notes, the session clock, and the rankings they feed.
 *
 * Against PGlite with the production migrations, like the rest of the API
 * suite: the constraints that matter here — one setup note per lineage, one
 * session note per exercise, a bounded clock — live in the schema, so a test
 * that stubbed the database would prove nothing about them.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server/app';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase';
import type { StoredProgram } from '../src/api/client';

const REFERENCE_FILE = resolve(process.cwd(), 'Ejemplo/ejemplo.xlsx');
const workbook = () => readFileSync(REFERENCE_FILE);

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
  app = createApp({ db });
  agent = request.agent(app);
  await agent
    .post('/api/auth/register')
    .send({ email: 'test@ejemplo.com', password: 'contrasena-de-prueba' })
    .expect(201);
});

/**
 * Imports the reference workbook.
 *
 * `extra` pads the bytes so the source hash differs: an identical file is
 * de-duplicated into the program that already exists, which is right for the
 * app and useless when a test needs two separate programs.
 */
async function importReference(filename = 'ejemplo.xlsx', extra = 0): Promise<StoredProgram> {
  const bytes = extra > 0 ? Buffer.concat([workbook(), Buffer.alloc(extra)]) : workbook();
  const { body } = await agent
    .post(`/api/programs?filename=${encodeURIComponent(filename)}`)
    .set('Content-Type', 'application/octet-stream')
    .send(bytes)
    .expect(201);
  return body.program as StoredProgram;
}

async function reload(programId: number): Promise<StoredProgram> {
  const { body } = await agent.get(`/api/programs/${programId}`).expect(200);
  return body.program as StoredProgram;
}

/** Adds a second week, cloned from the first, so lineage can be exercised. */
async function addWeek(programId: number): Promise<StoredProgram> {
  const { body } = await agent.post(`/api/programs/${programId}/weeks`).send({}).expect(201);
  return body.program as StoredProgram;
}

function firstExercise(program: StoredProgram, weekIndex = 0) {
  const week = program.weeks[weekIndex];
  const day = week?.days[0];
  const exercise = day?.exercises[0];
  if (!week || !day || !exercise) throw new Error('el programa de prueba no tiene ejercicios');
  return { week, day, exercise };
}

describe('the setup note', () => {
  it('is the same in every week of the program', async () => {
    const imported = await importReference();
    const withTwoWeeks = await addWeek(imported.id);

    const { exercise } = firstExercise(withTwoWeeks, 0);
    await agent
      .put(`/api/exercises/${exercise.id}/setup`)
      .send({ note: 'Banco pin 4, agarre ancho' })
      .expect(204);

    const loaded = await reload(imported.id);
    // Written against week 1's copy; read back from both, because the note
    // describes the movement rather than the week.
    expect(firstExercise(loaded, 0).exercise.setup).toBe('Banco pin 4, agarre ancho');
    expect(firstExercise(loaded, 1).exercise.setup).toBe('Banco pin 4, agarre ancho');
  }, 60_000);

  it('does not leak into another program that reuses the same lineage', async () => {
    // Lineage is 'd1:e1' in every import, so without the program in the key
    // this note would surface in every other plan the user owns.
    const first = await importReference('uno.xlsx');
    const second = await importReference('dos.xlsx', 1);

    await agent
      .put(`/api/exercises/${firstExercise(first).exercise.id}/setup`)
      .send({ note: 'Solo del primer programa' })
      .expect(204);

    expect(firstExercise(await reload(second.id)).exercise.setup).toBeNull();
  }, 60_000);

  it('is removed when the text is cleared', async () => {
    const imported = await importReference();
    const { exercise } = firstExercise(imported);

    await agent.put(`/api/exercises/${exercise.id}/setup`).send({ note: 'algo' }).expect(204);
    await agent.put(`/api/exercises/${exercise.id}/setup`).send({ note: '  ' }).expect(204);

    expect(firstExercise(await reload(imported.id)).exercise.setup).toBeNull();
  }, 60_000);

  it('refuses a note longer than the column allows', async () => {
    const imported = await importReference();
    const { exercise } = firstExercise(imported);

    await agent
      .put(`/api/exercises/${exercise.id}/setup`)
      .send({ note: 'x'.repeat(1001) })
      .expect(400);
  }, 60_000);

  it("is not writable against another account's exercise", async () => {
    const imported = await importReference();
    const { exercise } = firstExercise(imported);

    const stranger = request.agent(app);
    await stranger
      .post('/api/auth/register')
      .send({ email: 'otra@ejemplo.com', password: 'otra-contrasena-larga' })
      .expect(201);

    await stranger.put(`/api/exercises/${exercise.id}/setup`).send({ note: 'mía' }).expect(404);
  }, 60_000);
});

describe("the session's note on one exercise", () => {
  it('belongs to that week and does not follow the movement', async () => {
    const imported = await importReference();
    const withTwoWeeks = await addWeek(imported.id);

    const week1 = firstExercise(withTwoWeeks, 0);
    await agent
      .put(`/api/days/${week1.day.id}/exercises/${week1.exercise.id}/note`)
      .send({ note: 'hombro tocado' })
      .expect(204);

    const loaded = await reload(imported.id);
    expect(firstExercise(loaded, 0).exercise.notes).toBe('hombro tocado');
    expect(firstExercise(loaded, 1).exercise.notes).toBe('');
  }, 60_000);

  it('is removed when the text is cleared', async () => {
    const imported = await importReference();
    const { day, exercise } = firstExercise(imported);
    const path = `/api/days/${day.id}/exercises/${exercise.id}/note`;

    await agent.put(path).send({ note: 'algo' }).expect(204);
    await agent.put(path).send({ note: '' }).expect(204);

    expect(firstExercise(await reload(imported.id)).exercise.notes).toBe('');
  }, 60_000);

  it('refuses an exercise that is not in that day', async () => {
    const imported = await importReference();
    const withTwoWeeks = await addWeek(imported.id);

    const week1 = firstExercise(withTwoWeeks, 0);
    const week2 = firstExercise(withTwoWeeks, 1);

    await agent
      .put(`/api/days/${week1.day.id}/exercises/${week2.exercise.id}/note`)
      .send({ note: 'no' })
      .expect(404);
  }, 60_000);
});

describe('the session clock', () => {
  it('stores the seconds the device counted', async () => {
    const imported = await importReference();
    const { day } = firstExercise(imported);

    await agent
      .patch(`/api/days/${day.id}/session`)
      .send({ elapsedSeconds: 4320, timerRunning: false })
      .expect(204);

    const loaded = await reload(imported.id);
    expect(loaded.weeks[0]?.days[0]?.elapsedSeconds).toBe(4320);
    expect(loaded.weeks[0]?.days[0]?.timerStartedAt).toBeNull();
  }, 60_000);

  it('records that it is running, so another device sees the same clock', async () => {
    const imported = await importReference();
    const { day } = firstExercise(imported);

    await agent
      .patch(`/api/days/${day.id}/session`)
      .send({ elapsedSeconds: 60, timerRunning: true })
      .expect(204);

    expect((await reload(imported.id)).weeks[0]?.days[0]?.timerStartedAt).not.toBeNull();
  }, 60_000);

  it('refuses a duration longer than a day', async () => {
    const imported = await importReference();
    const { day } = firstExercise(imported);

    await agent.patch(`/api/days/${day.id}/session`).send({ elapsedSeconds: 86_401 }).expect(400);
    await agent.patch(`/api/days/${day.id}/session`).send({ elapsedSeconds: -1 }).expect(400);
  }, 60_000);

  it('is cleared, along with the exercise notes, when the day is emptied', async () => {
    const imported = await importReference();
    const { day, exercise } = firstExercise(imported);

    await agent
      .patch(`/api/days/${day.id}/session`)
      .send({ elapsedSeconds: 3600, timerRunning: true })
      .expect(204);
    await agent
      .put(`/api/days/${day.id}/exercises/${exercise.id}/note`)
      .send({ note: 'algo' })
      .expect(204);

    await agent.delete(`/api/days/${day.id}/session`).expect(204);

    const cleared = firstExercise(await reload(imported.id));
    expect(cleared.day.elapsedSeconds).toBe(0);
    expect(cleared.day.timerStartedAt).toBeNull();
    expect(cleared.exercise.notes).toBe('');
  }, 60_000);

  it('leaves the setup note alone: it describes the movement, not the session', async () => {
    const imported = await importReference();
    const { day, exercise } = firstExercise(imported);

    await agent
      .put(`/api/exercises/${exercise.id}/setup`)
      .send({ note: 'Banco pin 4' })
      .expect(204);
    await agent.delete(`/api/days/${day.id}/session`).expect(204);

    expect(firstExercise(await reload(imported.id)).exercise.setup).toBe('Banco pin 4');
  }, 60_000);
});

describe('GET /api/profile/lifts', () => {
  it('is empty before anything is logged', async () => {
    const { body } = await agent.get('/api/profile/lifts').expect(200);
    expect(body.lifts).toEqual([]);
  });

  it('reports the best set and where the exercise is going', async () => {
    const imported = await importReference();
    const { day, exercise } = firstExercise(imported);

    // The workbook already carries 82.5 x 4 on the bench; add a heavier set.
    await agent
      .put(`/api/days/${day.id}/sets`)
      .send({ exerciseId: Number(exercise.id), setIndex: 1, weight: 90, reps: 5, rir: 1 })
      .expect(204);

    const { body } = await agent.get('/api/profile/lifts').expect(200);
    const lifts = body.lifts as {
      exercise: string;
      best: { weight: number; reps: number | null };
      gainKg: number | null;
      sessions: number;
    }[];

    const bench = lifts.find((lift) => lift.exercise.startsWith('PRESS DE BANCA'));
    expect(bench?.best).toMatchObject({ weight: 90, reps: 5 });
    // One session, so there is no trend to report yet.
    expect(bench?.gainKg).toBeNull();
    expect(bench?.sessions).toBe(1);
  }, 60_000);

  it('averages the duration of the sessions that were timed', async () => {
    const imported = await importReference();
    const { day } = firstExercise(imported);

    await agent
      .patch(`/api/days/${day.id}/session`)
      .send({ elapsedSeconds: 3600, completed: true })
      .expect(204);

    const { body } = await agent.get('/api/profile').expect(200);
    expect(body.profile.stats.averageSessionSeconds).toBe(3600);
  }, 60_000);

  it('has no average when nothing has been timed', async () => {
    await importReference();
    const { body } = await agent.get('/api/profile').expect(200);
    // Not zero: an average over no data is no answer, not "no time trained".
    expect(body.profile.stats.averageSessionSeconds).toBeNull();
  }, 60_000);
});
