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
import {
  createEmailSender,
  createSenderFromEnv,
  type Email,
  type EmailSender,
} from '../server/email/sender';
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
  app = createApp({ db, email: fakeSender(), appUrl: 'https://kilaje.test' });
  agent = request.agent(app);
  await agent
    .post('/api/auth/register')
    .send({ email: 'ana@ejemplo.com', password: PASSWORD })
    .expect(201);
}, 30_000);

/**
 * Waits for something the endpoint finishes after it has already answered.
 *
 * A fixed sleep races the database: it is long enough against PGlite, which
 * runs in-process, and too short against a real PostgreSQL over a socket.
 */
async function waitFor(done: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) {
    await new Promise((resume) => setTimeout(resume, 10));
  }
}

/** Runs the whole flow and returns the token from the emailed link. */
async function requestReset(email = 'ana@ejemplo.com'): Promise<string | null> {
  const before = sent.length;
  await request(app).post('/api/auth/forgot').send({ email }).expect(204);

  // The endpoint answers before it sends, on purpose, so the message lands
  // after the response has gone out.
  await waitFor(() => sent.length > before);

  const link = sent.at(-1)?.text.match(/https:\/\/\S+/)?.[0];
  if (!link) return null;

  // The token rides in the fragment, not the query string: a fragment is never
  // sent to a server, so it never lands in an access log where it could be
  // replayed for the hour it stays valid.
  const { hash, searchParams } = new URL(link);
  return (
    new URLSearchParams(hash.slice(1)).get('reset') ?? searchParams.get('reset')
  );
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

    // Proving a negative needs a deadline, and a fixed sleep is the wrong one:
    // too long here and the suite crawls, too short and it passes for an
    // address that simply had not been reached yet. A second request that does
    // have an account gives an ordering to wait on instead.
    await requestReset('ana@ejemplo.com');

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('ana@ejemplo.com');
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
      link: 'https://kilaje.test/#reset=abc',
      minutesValid: 60,
    });
    // Some clients render only one of the two; a blank reset mail is a lockout.
    expect(email.text).toContain('https://kilaje.test/#reset=abc');
    expect(email.html).toContain('https://kilaje.test/#reset=abc');
    expect(email.text).toContain('60');
  });

  it('escapes the link rather than trusting it', () => {
    const email = buildResetEmail({
      to: 'ana@ejemplo.com',
      link: 'https://kilaje.test/?reset="><script>alert(1)</script>',
      minutesValid: 60,
    });
    expect(email.html).not.toContain('<script>');
  });
});

describe('the sender without a key', () => {
  it('reports failure instead of pretending to have sent', async () => {
    // A silent no-op looks exactly like delivery, and password resets would
    // appear to work while nobody ever received one.
    const sender = createEmailSender(undefined, 'Kilaje <x@example.com>');
    expect(sender.configured).toBe(false);
    expect(await sender.send({ to: 'a@b.c', subject: 's', text: 't', html: '<p>t</p>' })).toBe(false);
  });
});

describe('choosing a provider from the environment', () => {
  const FROM = 'Kilaje <x@example.com>';
  const SMTP = {
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_USER: 'kilaje@gmail.com',
    SMTP_PASSWORD: 'abcd efgh ijkl mnop',
  };

  it('sends nothing when neither provider is configured', () => {
    expect(createSenderFromEnv({}, FROM).configured).toBe(false);
  });

  it('uses Resend when only its key is set', () => {
    expect(createSenderFromEnv({ RESEND_API_KEY: 're_x' }, FROM).configured).toBe(true);
  });

  it('uses SMTP when it is configured', () => {
    expect(createSenderFromEnv(SMTP, FROM).configured).toBe(true);
  });

  it('prefers SMTP over Resend when both are set', () => {
    // Only SMTP delivers to arbitrary recipients without a verified domain,
    // so setting it is the deliberate act and it has to win.
    const sender = createSenderFromEnv({ ...SMTP, RESEND_API_KEY: 're_x' }, FROM);
    expect(sender.configured).toBe(true);
    expect(String(sender.send)).toContain('sendMail');
  });

  it('refuses a half-written SMTP configuration instead of silently ignoring it', () => {
    // A typo in one variable must not look like "no email configured".
    const sender = createSenderFromEnv({ SMTP_HOST: 'smtp.gmail.com' }, FROM);
    expect(sender.configured).toBe(false);
  });

  it('survives a port that is not a number', () => {
    expect(createSenderFromEnv({ ...SMTP, SMTP_PORT: 'ochenta' }, FROM).configured).toBe(true);
  });
});

describe('the profile', () => {
  async function profile() {
    const { body } = await agent.get('/api/profile').expect(200);
    return body.profile as {
      identity: { displayName: string; email: string; memberSince: string };
      stats: { completedSessions: number; totalVolumeKg: number; distinctExercises: number };
      records: { exercise: string; oneRepMax: number; weeksSince: number }[];
      weeklyActivity: { weekStart: string; sessions: number; volumeKg: number }[];
      streakWeeks: number;
      volumeByType: { type: string; volumeKg: number; sessions: number }[];
      lastSessionAt: string | null;
    };
  }

  /** Imports the reference workbook, which carries one logged session. */
  async function importReference() {
    await agent
      .post('/api/programs?filename=ejemplo.xlsx')
      .set('Content-Type', 'application/octet-stream')
      .send(readFileSync(REFERENCE_FILE))
      .expect(201);
  }

  it('falls back to the email when there is no name yet', async () => {
    const { identity } = await profile();
    expect(identity.displayName).toBe('ana');
    expect(identity.email).toBe('ana@ejemplo.com');
  });

  it('stores the name, trimmed', async () => {
    await agent.patch('/api/profile').send({ displayName: '  Ana  ' }).expect(204);
    expect((await profile()).identity.displayName).toBe('Ana');
  });

  it('treats an emptied name as no name', async () => {
    await agent.patch('/api/profile').send({ displayName: '   ' }).expect(204);
    expect((await profile()).identity.displayName).toBe('ana');
  });

  it('rejects unknown fields instead of ignoring them', async () => {
    await agent.patch('/api/profile').send({ isAdmin: true }).expect(400);
    // The removed fields must not quietly come back either.
    await agent.patch('/api/profile').send({ displayName: 'Ana', gym: 'X' }).expect(400);
  });

  it('builds records and totals from what was actually logged', async () => {
    await importReference();

    const { stats, records } = await profile();
    // The workbook carried 82.5 kg x 4 on the bench.
    expect(stats.totalVolumeKg).toBe(330);
    expect(stats.distinctExercises).toBe(1);
    expect(records[0]?.exercise).toBe('PRESS DE BANCA PLANO CON BARRA LIBRE');
    expect(records[0]?.oneRepMax).toBe(93.5);
  }, 60_000);

  it('is empty, not broken, for an account that has logged nothing', async () => {
    const { stats, records, weeklyActivity, streakWeeks, volumeByType, lastSessionAt } =
      await profile();
    expect(stats.completedSessions).toBe(0);
    expect(stats.totalVolumeKg).toBe(0);
    expect(records).toEqual([]);
    // The chart still has an x-axis: twelve empty weeks, not an empty array.
    expect(weeklyActivity).toHaveLength(12);
    expect(weeklyActivity.every((week) => week.sessions === 0)).toBe(true);
    expect(streakWeeks).toBe(0);
    expect(volumeByType).toEqual([]);
    expect(lastSessionAt).toBeNull();
  });

  it('reports the weeks you missed instead of skipping them', async () => {
    await importReference();
    const { weeklyActivity, streakWeeks, lastSessionAt } = await profile();

    // A chart that drops empty weeks reports a habit nobody has.
    expect(weeklyActivity).toHaveLength(12);
    expect(weeklyActivity.filter((week) => week.sessions > 0)).toHaveLength(1);
    expect(weeklyActivity.at(-1)?.sessions).toBe(1);
    expect(weeklyActivity.at(-1)?.volumeKg).toBe(330);
    expect(streakWeeks).toBe(1);
    expect(lastSessionAt).toBeTruthy();

    // Oldest first, one week apart, no gaps and no duplicates.
    const starts = weeklyActivity.map((week) => Date.parse(week.weekStart));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index]! - starts[index - 1]!).toBe(7 * 24 * 60 * 60 * 1000);
    }
  }, 60_000);

  it('splits the volume by session type, biggest first', async () => {
    await importReference();
    const { volumeByType } = await profile();

    expect(volumeByType).toHaveLength(1);
    expect(volumeByType[0]?.volumeKg).toBe(330);
    expect(volumeByType[0]?.sessions).toBe(1);
    // Whatever the workbook called it, the split is named, never blank.
    expect(volumeByType[0]?.type).toBeTruthy();
  }, 60_000);

  it('dates each record so a stalled lift can be spotted', async () => {
    await importReference();
    const { records } = await profile();
    // Logged today, so nothing is stale yet — but the number has to be there.
    expect(records[0]?.weeksSince).toBe(0);
  }, 60_000);
});

describe('failures that used to answer 500', () => {
  it('rejects a malformed session cookie as unauthenticated, not as a crash', async () => {
    // decodeURIComponent throws on a stray %. It runs before any auth, on every
    // /api route, so a truncated cookie used to break the app for that browser
    // — and a 500 is not a 401, so the client never cleared the cookie either.
    await request(app)
      .get('/api/programs')
      .set('Cookie', 'kilaje_session=%E0%A4%A')
      .expect(401);
  });

  it('answers 400 for a truncated JSON body', async () => {
    await agent
      .patch('/api/profile')
      .set('Content-Type', 'application/json')
      .send('{"displayName": ')
      .expect(400);
  });

  it('refuses a weight the column cannot store', async () => {
    // NUMERIC(7,2) tops out at 99999.99. Accepting 100000 got past validation
    // and died in the driver as a numeric overflow.
    const { body } = await agent
      .post('/api/programs?filename=ejemplo.xlsx')
      .set('Content-Type', 'application/octet-stream')
      .send(readFileSync(REFERENCE_FILE))
      .expect(201);

    const dayId = String(body.program.weeks[0].days[0].id);
    const exerciseId = body.program.weeks[0].days[0].exercises[0].id;

    await agent
      .put(`/api/days/${dayId}/sets`)
      .send({ exerciseId, setIndex: 0, weight: 100000, reps: 1, rir: 0 })
      .expect(400);
  }, 60_000);
});

describe('scope', () => {
  it('never mixes accounts', async () => {
    await agent.patch('/api/profile').send({ displayName: 'Ana' }).expect(204);

    const bruno = request.agent(app);
    await bruno
      .post('/api/auth/register')
      .send({ email: 'bruno@ejemplo.com', password: PASSWORD })
      .expect(201);

    const { body } = await bruno.get('/api/profile').expect(200);
    expect(body.profile.identity.email).toBe('bruno@ejemplo.com');
    expect(body.profile.identity.displayName).toBe('bruno');
    expect(body.profile.records).toEqual([]);
  }, 40_000);

  it('requires a session', async () => {
    await request(app).get('/api/profile').expect(401);
    await request(app).patch('/api/profile').send({ displayName: 'x' }).expect(401);
  });
});
