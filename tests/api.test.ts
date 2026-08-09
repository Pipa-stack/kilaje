// @vitest-environment node
/**
 * API and persistence tests.
 *
 * They run against PGlite — real PostgreSQL in WASM — using the production
 * migrations, so schema mistakes and constraint violations surface here
 * instead of in Railway.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server/app';
import { migrate, loadMigrations } from '../server/db/migrate';
import { seedReferenceProgram } from '../server/db/seed';
import { sanitizeFileName } from '../server/api/schemas';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase';

const REFERENCE_FILE = resolve(process.cwd(), 'Ejemplo/ejemplo.xlsx');
const workbook = () => readFileSync(REFERENCE_FILE);

let db: TestDatabase;
let app: express.Express;
/** Every endpoint now needs a session, so each test gets a fresh account. */
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
    .send({ email: 'test@ejemplo.com', password: 'contrasena-de-prueba' })
    .expect(201);
});

/** Imports the reference workbook through the HTTP API. */
async function importReference(filename = 'ejemplo.xlsx') {
  return agent
    .post(`/api/programs?filename=${encodeURIComponent(filename)}`)
    .set('Content-Type', 'application/octet-stream')
    .send(workbook());
}

describe('migrations', () => {
  it('creates every table the model needs', async () => {
    // `current_schema()` rather than 'public': against a shared PostgreSQL
    // server each test database lives in its own schema (see testDatabase.ts).
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() ORDER BY table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'body_weights',
      'exercises',
      'password_resets',
      'programs',
      'reference_sets',
      'schema_migrations',
      'session_sets',
      'sessions',
      'users',
      'weeks',
      'workout_days',
      'workout_sessions',
    ]);
  });

  it('is idempotent — running again applies nothing', async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it('rebuilds the schema from zero', async () => {
    const fresh = await createTestDatabase();
    try {
      const applied = await migrate(fresh, loadMigrations());
      // createTestDatabase already migrated, so a second run is a no-op.
      expect(applied).toEqual([]);
      const { rows } = await fresh.query('SELECT * FROM programs');
      expect(rows).toEqual([]);
    } finally {
      await fresh.close();
    }
  }, 60_000);
});

describe('GET /api/health', () => {
  it('reports the database is reachable', async () => {
    const response = await agent.get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('POST /api/programs — importing a workbook', () => {
  it('parses and stores the real template', async () => {
    const response = await importReference();

    expect(response.status).toBe(201);
    expect(response.body.created).toBe(true);

    const { program } = response.body;
    expect(program.sourceFileName).toBe('ejemplo.xlsx');
    expect(program.version).toBe(1);
    expect(program.weeks).toHaveLength(1);
    expect(program.weeks[0].days.map((day: { number: number }) => day.number)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(program.weeks[0].days[0].type).toBe('PUSH');
    expect(program.weeks[0].days[0].exercises).toHaveLength(7);
    expect(program.weeks[0].days[0].exercises[0].name).toBe(
      'PRESS DE BANCA PLANO CON BARRA LIBRE',
    );
    expect(program.weeks[0].days[0].exercises[0].protocol).toBe(
      '3 SETS X 4-6 / 6-8 / 8-10 REPS (RIR 0)',
    );
  });

  it('seeds the values that were already in the workbook as performed work', async () => {
    const { body } = await importReference();
    // 82.5 kg x 4 reps was recorded in the sheet, so it belongs to the
    // execution side, not to the template.
    expect(body.program.weeks[0].days[0].exercises[0].currentWeek[0]).toEqual({
      weight: 82.5,
      reps: 4,
      rir: null,
    });

    const { rows } = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM session_sets',
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('keeps template and execution in separate tables', async () => {
    await importReference();

    const counts = async (table: string) => {
      const { rows } = await db.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM ${table}`,
      );
      return rows[0]?.count ?? 0;
    };

    expect(await counts('programs')).toBe(1);
    expect(await counts('weeks')).toBe(1);
    expect(await counts('workout_days')).toBe(5);
    expect(await counts('exercises')).toBe(35);
    // Week 1 has no previous week, so no imported history.
    expect(await counts('reference_sets')).toBe(0);
    // One session per day, created eagerly at import.
    expect(await counts('workout_sessions')).toBe(5);
  });

  it('does not duplicate when the identical file is uploaded twice', async () => {
    const first = await importReference();
    const second = await importReference();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.program.id).toBe(first.body.program.id);

    const { rows } = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM programs',
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('rejects an empty body', async () => {
    const response = await agent
      .post('/api/programs')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(0));
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/archivo/i);
  });

  it('rejects a file that is not the training template', async () => {
    const response = await agent
      .post('/api/programs?filename=presupuesto.xlsx')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('esto no es un excel'));
    expect(response.status).toBe(422);
  });

  it('sanitises the filename it echoes back', async () => {
    const response = await importReference('../../etc/<script>passwd');
    expect(response.status).toBe(201);
    expect(response.body.program.sourceFileName).not.toContain('..');
    expect(response.body.program.sourceFileName).not.toContain('<');
    expect(response.body.program.sourceFileName).not.toContain('/');
  });
});

describe('re-importing keeps history intact', () => {
  it('creates a new version without touching the previous program', async () => {
    const first = await importReference();
    const firstId = first.body.program.id;
    const dayId = first.body.program.weeks[0].days[0].id;
    const exerciseId = first.body.program.weeks[0].days[0].exercises[0].id;

    // Train on the first program.
    await agent
      .put(`/api/days/${dayId}/sets`)
      .send({ exerciseId: Number(exerciseId), setIndex: 1, weight: 80, reps: 8, rir: 1 })
      .expect(204);
    await agent
      .patch(`/api/days/${dayId}/session`)
      .send({ notes: 'buenas sensaciones', completed: true })
      .expect(204);

    // A different file (different bytes) of the same template.
    const modified = Buffer.concat([workbook(), Buffer.from([0])]);
    const second = await agent
      .post('/api/programs?filename=ejemplo.xlsx')
      .set('Content-Type', 'application/octet-stream')
      .send(modified);

    expect(second.status).toBe(201);
    expect(second.body.program.id).not.toBe(firstId);
    expect(second.body.program.version).toBe(2);
    expect(second.body.program.name).toContain('v2');

    // The old program still has its history.
    const reloaded = await agent.get(`/api/programs/${firstId}`).expect(200);
    const oldDay = reloaded.body.program.weeks[0].days[0];
    expect(oldDay.notes).toBe('buenas sensaciones');
    expect(oldDay.completed).toBe(true);
    expect(oldDay.exercises[0].currentWeek[1]).toEqual({ weight: 80, reps: 8, rir: 1 });

    // The new program starts from the workbook only.
    const newDay = second.body.program.weeks[0].days[0];
    expect(newDay.notes).toBe('');
    expect(newDay.completed).toBe(false);
    expect(newDay.exercises[0].currentWeek[1]).toEqual({ weight: null, reps: null, rir: null });
  });

  it('lists both programs, newest first', async () => {
    await importReference();
    await agent
      .post('/api/programs?filename=ejemplo.xlsx')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.concat([workbook(), Buffer.from([0])]));

    const { body } = await agent.get('/api/programs').expect(200);
    expect(body.programs).toHaveLength(2);
    expect(body.programs[0].version).toBe(2);
    expect(body.programs[0].weekCount).toBe(1);
    expect(body.programs[0].dayCount).toBe(5);
  });
});

describe('DELETE /api/programs/:id', () => {
  it('removes the program and everything logged against it', async () => {
    const { body } = await importReference();
    const programId = body.program.id;
    const dayId = Number(body.program.weeks[0].days[0].id);
    const exerciseId = Number(body.program.weeks[0].days[0].exercises[0].id);

    await agent
      .put(`/api/days/${dayId}/sets`)
      .send({ exerciseId, setIndex: 1, weight: 80, reps: 8, rir: 1 })
      .expect(204);

    await agent.delete(`/api/programs/${programId}`).expect(204);

    await agent.get(`/api/programs/${programId}`).expect(404);

    // The cascade left nothing orphaned.
    for (const table of ['weeks', 'workout_days', 'exercises', 'workout_sessions', 'session_sets']) {
      const { rows } = await db.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM ${table}`,
      );
      expect(rows[0]?.count).toBe(0);
    }
  });

  it('leaves other programs untouched', async () => {
    const first = await importReference();
    const second = await agent
      .post('/api/programs?filename=ejemplo.xlsx')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.concat([workbook(), Buffer.from([0])]));

    const keptId = second.body.program.id;
    const keptDay = Number(second.body.program.weeks[0].days[0].id);
    await agent.patch(`/api/days/${keptDay}/session`).send({ notes: 'no me borres' }).expect(204);

    await agent.delete(`/api/programs/${first.body.program.id}`).expect(204);

    const { body } = await agent.get(`/api/programs/${keptId}`).expect(200);
    expect(body.program.weeks[0].days[0].notes).toBe('no me borres');
    expect(body.program.weeks[0].days[0].exercises).toHaveLength(7);
  });

  it('404s for a program that does not exist', async () => {
    await agent.delete('/api/programs/999999').expect(404);
  });

  it('rejects a non-numeric id', async () => {
    await agent.delete('/api/programs/abc').expect(400);
  });
});

describe('GET /api/programs', () => {
  it('returns an empty list on a fresh database', async () => {
    const { body } = await agent.get('/api/programs').expect(200);
    expect(body.programs).toEqual([]);
  });

  it('404s for a program that does not exist', async () => {
    const response = await agent.get('/api/programs/999999');
    expect(response.status).toBe(404);
  });

  it('rejects a non-numeric id instead of querying', async () => {
    const response = await agent.get('/api/programs/abc');
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Datos inválidos.');
  });

  it('404s on /latest when nothing is imported, and returns it afterwards', async () => {
    await agent.get('/api/programs/latest').expect(404);
    const imported = await importReference();
    const { body } = await agent.get('/api/programs/latest').expect(200);
    expect(body.program.id).toBe(imported.body.program.id);
  });
});

describe('recording sets', () => {
  let dayId: number;
  let exerciseId: number;
  let otherDayId: number;

  beforeEach(async () => {
    const { body } = await importReference();
    const week = body.program.weeks[0];
    dayId = Number(week.days[0].id);
    exerciseId = Number(week.days[0].exercises[0].id);
    otherDayId = Number(week.days[1].id);
  });

  it('saves and reads back a set', async () => {
    await agent
      .put(`/api/days/${dayId}/sets`)
      .send({ exerciseId, setIndex: 1, weight: 80, reps: 8, rir: 1 })
      .expect(204);

    const { body } = await agent.get('/api/programs/latest').expect(200);
    expect(body.program.weeks[0].days[0].exercises[0].currentWeek[1]).toEqual({
      weight: 80,
      reps: 8,
      rir: 1,
    });
  });

  it('overwrites a set rather than duplicating it', async () => {
    const payload = { exerciseId, setIndex: 1, weight: 80, reps: 8, rir: 1 };
    await agent.put(`/api/days/${dayId}/sets`).send(payload).expect(204);
    await agent
      .put(`/api/days/${dayId}/sets`)
      .send({ ...payload, weight: 85 })
      .expect(204);

    const { rows } = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM session_sets WHERE exercise_id = $1 AND set_index = 1',
      [exerciseId],
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('stores sets added beyond the template\'s four slots', async () => {
    await agent
      .put(`/api/days/${dayId}/sets`)
      .send({ exerciseId, setIndex: 5, weight: 60, reps: 12, rir: 0 })
      .expect(204);

    const { body } = await agent.get('/api/programs/latest').expect(200);
    const sets = body.program.weeks[0].days[0].exercises[0].currentWeek;
    expect(sets).toHaveLength(6);
    expect(sets[5]).toEqual({ weight: 60, reps: 12, rir: 0 });
  });

  it('clears a set when every value is null', async () => {
    await agent
      .put(`/api/days/${dayId}/sets`)
      .send({ exerciseId, setIndex: 1, weight: 80, reps: 8, rir: 1 })
      .expect(204);
    await agent
      .put(`/api/days/${dayId}/sets`)
      .send({ exerciseId, setIndex: 1, weight: null, reps: null, rir: null })
      .expect(204);

    const { rows } = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM session_sets WHERE exercise_id = $1 AND set_index = 1',
      [exerciseId],
    );
    expect(rows[0]?.count).toBe(0);
  });

  it('deletes a set', async () => {
    await agent
      .put(`/api/days/${dayId}/sets`)
      .send({ exerciseId, setIndex: 4, weight: 60, reps: 12, rir: 0 })
      .expect(204);
    await agent
      .delete(`/api/days/${dayId}/sets`)
      .send({ exerciseId, setIndex: 4 })
      .expect(204);

    const { body } = await agent.get('/api/programs/latest').expect(200);
    expect(body.program.weeks[0].days[0].exercises[0].currentWeek).toHaveLength(4);
  });

  describe('data isolation', () => {
    it('refuses to write a set into a day the exercise does not belong to', async () => {
      const response = await agent
        .put(`/api/days/${otherDayId}/sets`)
        .send({ exerciseId, setIndex: 0, weight: 100, reps: 5, rir: 0 });

      expect(response.status).toBe(404);
      // The seeded 82.5 kg must still be there, untouched by the rejected write.
      const { rows } = await db.query<{ weight: number }>(
        'SELECT weight FROM session_sets WHERE exercise_id = $1 AND set_index = 0',
        [exerciseId],
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]?.weight)).toBe(82.5);

      // And nothing was attached to the other day either.
      const { rows: otherRows } = await db.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM session_sets ss
           JOIN workout_sessions s ON s.id = ss.session_id
          WHERE s.day_id = $1 AND ss.exercise_id = $2`,
        [otherDayId, exerciseId],
      );
      expect(otherRows[0]?.count).toBe(0);
    });

    it('does not leak sets between programs', async () => {
      await agent
        .put(`/api/days/${dayId}/sets`)
        .send({ exerciseId, setIndex: 0, weight: 100, reps: 5, rir: 0 })
        .expect(204);

      const second = await agent
        .post('/api/programs?filename=ejemplo.xlsx')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.concat([workbook(), Buffer.from([0])]));

      const newSets = second.body.program.weeks[0].days[0].exercises[0].currentWeek;
      expect(newSets[0]).toEqual({ weight: 82.5, reps: 4, rir: null });
    });
  });

  describe('validation', () => {
    it('rejects an unknown exercise', async () => {
      const response = await agent
        .put(`/api/days/${dayId}/sets`)
        .send({ exerciseId: 999999, setIndex: 0, weight: 80, reps: 8, rir: 1 });
      expect(response.status).toBe(404);
    });

    it.each([
      ['negative weight', { weight: -5, reps: 8, rir: 1 }],
      ['absurd weight', { weight: 999999, reps: 8, rir: 1 }],
      ['fractional reps', { weight: 80, reps: 8.5, rir: 1 }],
      ['RIR out of range', { weight: 80, reps: 8, rir: 99 }],
      ['weight as text', { weight: '80', reps: 8, rir: 1 }],
    ])('rejects %s', async (_label, values) => {
      const response = await agent
        .put(`/api/days/${dayId}/sets`)
        .send({ exerciseId, setIndex: 0, ...values });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Datos inválidos.');
    });

    it('rejects unknown fields instead of ignoring them', async () => {
      const response = await agent
        .put(`/api/days/${dayId}/sets`)
        .send({ exerciseId, setIndex: 0, weight: 80, reps: 8, rir: 1, isAdmin: true });
      expect(response.status).toBe(400);
    });

    it('rejects a negative set index', async () => {
      const response = await agent
        .put(`/api/days/${dayId}/sets`)
        .send({ exerciseId, setIndex: -1, weight: 80, reps: 8, rir: 1 });
      expect(response.status).toBe(400);
    });
  });
});

describe('sessions and notes', () => {
  let dayId: number;

  beforeEach(async () => {
    const { body } = await importReference();
    dayId = Number(body.program.weeks[0].days[0].id);
  });

  it('saves notes', async () => {
    await agent
      .patch(`/api/days/${dayId}/session`)
      .send({ notes: 'hombro derecho molesta' })
      .expect(204);

    const { body } = await agent.get('/api/programs/latest').expect(200);
    expect(body.program.weeks[0].days[0].notes).toBe('hombro derecho molesta');
  });

  it('marks a session completed and records when', async () => {
    await agent.patch(`/api/days/${dayId}/session`).send({ completed: true }).expect(204);

    const { rows } = await db.query<{ completed: boolean; completed_at: Date | null }>(
      'SELECT completed, completed_at FROM workout_sessions WHERE day_id = $1',
      [dayId],
    );
    expect(rows[0]?.completed).toBe(true);
    expect(rows[0]?.completed_at).not.toBeNull();

    const { body } = await agent.get('/api/programs/latest').expect(200);
    expect(body.program.weeks[0].days[0].completed).toBe(true);
  });

  it('un-completes a session and clears the timestamp', async () => {
    await agent.patch(`/api/days/${dayId}/session`).send({ completed: true }).expect(204);
    await agent.patch(`/api/days/${dayId}/session`).send({ completed: false }).expect(204);

    const { rows } = await db.query<{ completed_at: Date | null }>(
      'SELECT completed_at FROM workout_sessions WHERE day_id = $1',
      [dayId],
    );
    expect(rows[0]?.completed_at).toBeNull();
  });

  it('resets a day without destroying the template', async () => {
    const { body: before } = await agent.get('/api/programs/latest');
    const exerciseId = Number(before.program.weeks[0].days[0].exercises[0].id);

    await agent
      .put(`/api/days/${dayId}/sets`)
      .send({ exerciseId, setIndex: 1, weight: 80, reps: 8, rir: 1 })
      .expect(204);
    await agent
      .patch(`/api/days/${dayId}/session`)
      .send({ notes: 'x', completed: true })
      .expect(204);

    await agent.delete(`/api/days/${dayId}/session`).expect(204);

    const { body } = await agent.get('/api/programs/latest').expect(200);
    const day = body.program.weeks[0].days[0];
    expect(day.notes).toBe('');
    expect(day.completed).toBe(false);
    expect(day.exercises[0].currentWeek.every((set: unknown) => isEmpty(set))).toBe(true);
    // The plan survived.
    expect(day.exercises).toHaveLength(7);
    expect(day.exercises[0].name).toBe('PRESS DE BANCA PLANO CON BARRA LIBRE');
  });

  it('rejects an empty patch', async () => {
    const response = await agent.patch(`/api/days/${dayId}/session`).send({});
    expect(response.status).toBe(400);
  });

  it('rejects notes beyond the size limit', async () => {
    const response = await agent
      .patch(`/api/days/${dayId}/session`)
      .send({ notes: 'x'.repeat(5000) });
    expect(response.status).toBe(400);
  });

  it('404s for a day that does not exist', async () => {
    const response = await agent.patch('/api/days/999999/session').send({ notes: 'x' });
    expect(response.status).toBe(404);
  });
});

function isEmpty(set: unknown): boolean {
  const value = set as { weight: unknown; reps: unknown; rir: unknown };
  return value.weight === null && value.reps === null && value.rir === null;
}

describe('unknown endpoints', () => {
  it('404s as JSON, not as HTML', async () => {
    const response = await agent.get('/api/no-existe');
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Endpoint no encontrado.');
  });
});

describe('security headers', () => {
  it('sets a restrictive CSP and the usual hardening headers', async () => {
    const response = await agent.get('/api/health');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("object-src 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('seed', () => {
  it('imports the reference workbook into an empty database', async () => {
    // The account for this test already exists, so the seeded program stays
    // unowned and is invisible through the API; it is checked in the table.
    await db.query('DELETE FROM programs');
    expect(await seedReferenceProgram(db, REFERENCE_FILE)).toBe('importado');

    const { rows } = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM programs WHERE user_id IS NULL',
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('does not overwrite an existing program', async () => {
    await importReference();
    expect(await seedReferenceProgram(db, REFERENCE_FILE)).toBe('omitido: ya hay programas');
  });

  it('reports a missing workbook instead of throwing', async () => {
    expect(await seedReferenceProgram(db, '/no/existe.xlsx')).toBe(
      'omitido: no se encuentra el archivo',
    );
  });
});

describe('sanitizeFileName', () => {
  it('keeps a normal name', () => {
    expect(sanitizeFileName('mesociclo-2.xlsx')).toBe('mesociclo-2.xlsx');
  });

  it('strips paths, markup and control characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd.xlsx');
    expect(sanitizeFileName('<img src=x onerror=alert(1)>.xlsx')).not.toContain('<');
    expect(sanitizeFileName('C:\\Users\\x\\plan.xlsx')).toBe('plan.xlsx');
  });

  it('falls back when nothing usable is left', () => {
    expect(sanitizeFileName('')).toBe('entrenamiento.xlsx');
    expect(sanitizeFileName('///')).toBe('entrenamiento.xlsx');
  });

  it('forces a spreadsheet extension', () => {
    expect(sanitizeFileName('plan')).toBe('plan.xlsx');
  });
});
