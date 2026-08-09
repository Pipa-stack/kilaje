// @vitest-environment node
/**
 * Password recovery and the profile.
 *
 * The recovery half is security work, so the tests are about what an attacker
 * gets: no way to learn which addresses have accounts, no link that works
 * twice, no session left alive afterwards.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server/app';
import { buildResetEmail } from '../server/email/resetEmail';
import { createEmailSender, type Email, type EmailSender } from '../server/email/sender';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase';

const REFERENCE_FILE = resolve(process.cwd(), 'Ejemplo/ejemplo.xlsx');
const PASSWORD = 'contrasena-de-prueba';

let db: TestDatabase;
let app: express.Express;
let agent: ReturnType<typeof request.agent>;
let sent: Email[];

/** Captures what would have gone out, without a network call. */
function fakeSender(): EmailSender {
  return {
    configured: true,
    async send(email) {
      sent.push(email);
      return true;
    },
  };
}

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.truncate();
  sent = [];
  app = createApp({ db, email: fakeSender(), appUrl: 'https://barra.test' });
  agent = request.agent(app);
  await agent
    .post('/api/auth/register')
    .send({ email: 'ana@ejemplo.com', password: PASSWORD })
    .expect(201);
}, 30_000);

/** Runs the whole flow and returns the token from the emailed link. */
async function requestReset(email = 'ana@ejemplo.com'): Promise<string | null> {
  await request(app).post('/api/auth/forgot').send({ email }).expect(204);
  // The endpoint answers before sending, so give the send a tick to land.
  await new Promise((done) => setTimeout(done, 50));
  const link = sent.at(-1)?.text.match(/https:\/\/\S+/)?.[0];
  return link ? new URL(link).searchParams.get('reset') : null;
}

describe('asking for a reset', () => {
  it('sends a link to an address that has an account', async () => {
    const token = await requestReset();
    expect(token).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('ana@ejemplo.com');
    expect(sent[0]?.subject).toMatch(/contraseña/i);
  }, 30_000);

  it('answers exactly the same for an address that has none', async () => {
    const known = await request(app)
      .post('/api/auth/forgot')
      .send({ email: 'ana@ejemplo.com' });
    const unknown = await request(app)
      .post('/api/auth/forgot')
      .send({ email: 'nadie@ejemplo.com' });

    // Anything else here turns the endpoint into a free membership check,
    // and it is the one endpoint that needs no session.
    expect(known.status).toBe(204);
    expect(unknown.status).toBe(204);
    expect(known.body).toEqual(unknown.body);
  }, 30_000);

  it('sends nothing for an address that has no account', async () => {
    await request(app).post('/api/auth/forgot').send({ email: 'nadie@ejemplo.com' }).expect(204);
    await new Promise((done) => setTimeout(done, 50));
    expect(sent).toHaveLength(0);
  }, 30_000);

  it('invalidates the previous link when asked again', async () => {
    const first = await requestReset();
    const second = await requestReset();
    expect(first).not.toBe(second);

    await request(app)
      .post('/api/auth/reset')
      .send({ token: first, newPassword: 'una-contrasena-nueva' })
      .expect(400);
  }, 40_000);

  it('rejects an address that is not one', async () => {
    await request(app).post('/api/auth/forgot').send({ email: 'no-es-correo' }).expect(400);
  });
});

describe('using the link', () => {
  const NEW_PASSWORD = 'una-contrasena-nueva';

  it('sets the password and lets the new one in', async () => {
    const token = await requestReset();

    await request(app).post('/api/auth/reset').send({ token, newPassword: NEW_PASSWORD }).expect(204);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@ejemplo.com', password: NEW_PASSWORD })
      .expect(200);
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@ejemplo.com', password: PASSWORD })
      .expect(401);
  }, 60_000);

  it('works exactly once', async () => {
    const token = await requestReset();
    await request(app).post('/api/auth/reset').send({ token, newPassword: NEW_PASSWORD }).expect(204);

    // A link found later in an inbox or a proxy log has to be worthless.
    await request(app)
      .post('/api/auth/reset')
      .send({ token, newPassword: 'otra-contrasena-mas' })
      .expect(400);
  }, 60_000);

  it('kills every session, including one an attacker had open', async () => {
    // Somebody else was already signed in as Ana.
    const intruder = request.agent(app);
    await intruder
      .post('/api/auth/login')
      .send({ email: 'ana@ejemplo.com', password: PASSWORD })
      .expect(200);
    await intruder.get('/api/auth/me').expect(200);

    const token = await requestReset();
    await request(app).post('/api/auth/reset').send({ token, newPassword: NEW_PASSWORD }).expect(204);

    // Resetting is what you do when someone got in; leaving them in defeats it.
    await intruder.get('/api/auth/me').expect(401);
    await agent.get('/api/auth/me').expect(401);
  }, 60_000);

  it('refuses a made-up token', async () => {
    await request(app)
      .post('/api/auth/reset')
      .send({ token: 'me-lo-acabo-de-inventar', newPassword: NEW_PASSWORD })
      .expect(400);
  });

  it('refuses a password that is too short', async () => {
    const token = await requestReset();
    await request(app).post('/api/auth/reset').send({ token, newPassword: 'corta' }).expect(400);
  }, 30_000);
});

describe('the email itself', () => {
  it('carries the link in both plain text and HTML', () => {
    const email = buildResetEmail({
      to: 'ana@ejemplo.com',
      link: 'https://barra.test/?reset=abc',
      minutesValid: 60,
    });
    // Some clients render only one of the two; a blank reset mail is a lockout.
    expect(email.text).toContain('https://barra.test/?reset=abc');
    expect(email.html).toContain('https://barra.test/?reset=abc');
    expect(email.text).toContain('60');
  });

  it('escapes the link rather than trusting it', () => {
    const email = buildResetEmail({
      to: 'ana@ejemplo.com',
      link: 'https://barra.test/?reset="><script>alert(1)</script>',
      minutesValid: 60,
    });
    expect(email.html).not.toContain('<script>');
  });
});

describe('the sender without a key', () => {
  it('reports failure instead of pretending to have sent', async () => {
    // A silent no-op looks exactly like delivery, and password resets would
    // appear to work while nobody ever received one.
    const sender = createEmailSender(undefined, 'Barra <x@example.com>');
    expect(sender.configured).toBe(false);
    expect(await sender.send({ to: 'a@b.c', subject: 's', text: 't', html: '<p>t</p>' })).toBe(false);
  });
});

describe('the profile', () => {
  async function profile() {
    const { body } = await agent.get('/api/profile').expect(200);
    return body.profile as {
      identity: { displayName: string; gym: string | null; weightUnit: string; email: string };
      stats: { completedSessions: number; totalVolumeKg: number; distinctExercises: number };
      records: { exercise: string; oneRepMax: number }[];
      bodyWeights: { weightKg: number; measuredOn: string }[];
    };
  }

  it('falls back to the email when there is no name yet', async () => {
    const { identity } = await profile();
    expect(identity.displayName).toBe('ana');
    expect(identity.weightUnit).toBe('kg');
    expect(identity.gym).toBeNull();
  });

  it('stores the name, the gym and the unit', async () => {
    await agent
      .patch('/api/profile')
      .send({ displayName: '  Ana  ', gym: 'Gimnasio del barrio', weightUnit: 'lb' })
      .expect(204);

    const { identity } = await profile();
    expect(identity.displayName).toBe('Ana');
    expect(identity.gym).toBe('Gimnasio del barrio');
    expect(identity.weightUnit).toBe('lb');
  });

  it('treats an emptied name as no name', async () => {
    await agent.patch('/api/profile').send({ displayName: '   ' }).expect(204);
    expect((await profile()).identity.displayName).toBe('ana');
  });

  it('rejects a unit that is not one', async () => {
    await agent.patch('/api/profile').send({ weightUnit: 'piedras' }).expect(400);
  });

  it('rejects an empty patch and unknown fields', async () => {
    await agent.patch('/api/profile').send({}).expect(400);
    await agent.patch('/api/profile').send({ isAdmin: true }).expect(400);
  });

  it('builds records and totals from what was actually logged', async () => {
    await agent
      .post('/api/programs?filename=ejemplo.xlsx')
      .set('Content-Type', 'application/octet-stream')
      .send(readFileSync(REFERENCE_FILE))
      .expect(201);

    const { stats, records } = await profile();
    // The workbook carried 82.5 kg x 4 on the bench.
    expect(stats.totalVolumeKg).toBe(330);
    expect(stats.distinctExercises).toBe(1);
    expect(records[0]?.exercise).toBe('PRESS DE BANCA PLANO CON BARRA LIBRE');
    expect(records[0]?.oneRepMax).toBe(93.5);
  }, 60_000);

  it('is empty, not broken, for an account that has logged nothing', async () => {
    const { stats, records, bodyWeights } = await profile();
    expect(stats.completedSessions).toBe(0);
    expect(stats.totalVolumeKg).toBe(0);
    expect(records).toEqual([]);
    expect(bodyWeights).toEqual([]);
  });
});

describe('body weight', () => {
  it('records a weigh-in and reads it back', async () => {
    await agent.put('/api/profile/weight').send({ weightKg: 75.4 }).expect(204);

    const { body } = await agent.get('/api/profile').expect(200);
    expect(body.profile.bodyWeights).toHaveLength(1);
    expect(body.profile.bodyWeights[0].weightKg).toBe(75.4);
  });

  it('replaces the reading instead of stacking two for the same day', async () => {
    // Stepping on the scale twice should not draw a sawtooth.
    await agent.put('/api/profile/weight').send({ weightKg: 75.4, measuredOn: '2026-08-01' }).expect(204);
    await agent.put('/api/profile/weight').send({ weightKg: 75.9, measuredOn: '2026-08-01' }).expect(204);

    const { body } = await agent.get('/api/profile').expect(200);
    expect(body.profile.bodyWeights).toHaveLength(1);
    expect(body.profile.bodyWeights[0].weightKg).toBe(75.9);
  });

  it('returns readings oldest first, so a chart reads left to right', async () => {
    await agent.put('/api/profile/weight').send({ weightKg: 76, measuredOn: '2026-08-02' }).expect(204);
    await agent.put('/api/profile/weight').send({ weightKg: 75, measuredOn: '2026-08-01' }).expect(204);

    const { body } = await agent.get('/api/profile').expect(200);
    expect(body.profile.bodyWeights.map((entry: { measuredOn: string }) => entry.measuredOn)).toEqual([
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('deletes a reading', async () => {
    await agent.put('/api/profile/weight').send({ weightKg: 75, measuredOn: '2026-08-01' }).expect(204);
    await agent.delete('/api/profile/weight/2026-08-01').expect(204);

    const { body } = await agent.get('/api/profile').expect(200);
    expect(body.profile.bodyWeights).toEqual([]);
  });

  it.each([
    ['zero', { weightKg: 0 }],
    ['negative', { weightKg: -5 }],
    ['absurd', { weightKg: 900 }],
    ['text', { weightKg: '75' }],
    ['a bad date', { weightKg: 75, measuredOn: 'ayer' }],
  ])('rejects %s', async (_label, payload) => {
    await agent.put('/api/profile/weight').send(payload).expect(400);
  });

  it('never mixes accounts', async () => {
    await agent.put('/api/profile/weight').send({ weightKg: 75.4 }).expect(204);

    const bruno = request.agent(app);
    await bruno
      .post('/api/auth/register')
      .send({ email: 'bruno@ejemplo.com', password: PASSWORD })
      .expect(201);

    const { body } = await bruno.get('/api/profile').expect(200);
    expect(body.profile.bodyWeights).toEqual([]);
    expect(body.profile.identity.email).toBe('bruno@ejemplo.com');
  }, 40_000);

  it('requires a session', async () => {
    await request(app).get('/api/profile').expect(401);
    await request(app).put('/api/profile/weight').send({ weightKg: 75 }).expect(401);
  });
});
