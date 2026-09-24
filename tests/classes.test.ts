// @vitest-environment node
/**
 * Clases: el horario, las reservas y la lista de espera.
 *
 * El reloj está fijo — lunes 28 de septiembre de 2026, 10:00 en Madrid — y
 * cada test lo mueve cuando necesita que pase el tiempo. Las reglas de plazo
 * se prueban así sin esperar una hora de verdad.
 */

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server/app';
import type { Email, EmailSender } from '../server/email/sender';
import { describeWhen } from '../server/email/classEmail';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase';

const PASSWORD = 'contrasena-de-prueba';
const ADMIN = 'jefa@gimnasio.com';

/** Lunes 28/09/2026 a las 10:00 en Madrid (UTC+2 en verano). */
const MONDAY_10 = new Date('2026-09-28T08:00:00Z');

let db: TestDatabase;
let app: express.Express;
let now: Date;
let sent: Email[];

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.truncate();
  now = MONDAY_10;
  sent = [];
  const email: EmailSender = {
    configured: true,
    async send(message) {
      sent.push(message);
      return true;
    },
  };
  app = createApp({
    db,
    rateLimits: false,
    adminEmails: [ADMIN],
    email,
    appUrl: 'https://kilaje.test',
    clock: () => now,
  });
}, 30_000);

async function signUp(address: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email: address, password: PASSWORD }).expect(201);
  return agent;
}

type Agent = Awaited<ReturnType<typeof signUp>>;

interface Occurrence {
  id: number;
  name: string;
  date: string;
  startsAtIso: string;
  booked: number;
  waiting: number;
  cancelled: boolean;
  started: boolean;
  mine: 'booked' | 'waiting' | null;
  waitPosition: number | null;
  canCancel: boolean;
  attendees?: { bookingId: number; name: string; waiting: boolean }[];
}

async function createClass(admin: Agent, overrides: Record<string, unknown> = {}) {
  const response = await admin
    .post('/api/classes/schedule')
    .send({
      name: 'Crossfit',
      coach: 'Laura',
      weekday: 4,
      startsAt: '18:00',
      durationMinutes: 60,
      capacity: 2,
      ...overrides,
    })
    .expect(201);
  return (response.body as { class: { id: number } }).class.id;
}

async function occurrence(agent: Agent, classId: number, date: string): Promise<Occurrence> {
  const response = await agent.get('/api/classes').expect(200);
  const { days } = response.body as { days: { date: string; classes: Occurrence[] }[] };
  const found = days
    .find((day) => day.date === date)
    ?.classes.find((candidate) => candidate.id === classId);
  if (!found) throw new Error(`No hay clase ${classId} el ${date}`);
  return found;
}

/** El jueves de esta semana. */
const THURSDAY = '2026-10-01';

describe('horario', () => {
  it('solo quien administra puede crear, cambiar o borrar clases', async () => {
    const member = await signUp('socio@ejemplo.com');
    await member
      .post('/api/classes/schedule')
      .send({ name: 'Yoga', coach: null, weekday: 1, startsAt: '09:00', durationMinutes: 60, capacity: 10 })
      .expect(403);

    const admin = await signUp(ADMIN);
    const classId = await createClass(admin);
    await member.delete(`/api/classes/schedule/${classId}`).expect(403);
    await member.put(`/api/classes/${classId}/cancellations/${THURSDAY}`).expect(403);
  });

  it('reconoce al administrador sin mirar mayúsculas', async () => {
    const admin = await signUp('Jefa@Gimnasio.com');
    const response = await admin.get('/api/classes').expect(200);
    expect(response.body.isAdmin).toBe(true);
    expect(response.body.schedule).toEqual([]);
  });

  it('rechaza una clase mal escrita', async () => {
    const admin = await signUp(ADMIN);
    await admin
      .post('/api/classes/schedule')
      .send({ name: '', coach: null, weekday: 8, startsAt: '25:00', durationMinutes: 60, capacity: 0 })
      .expect(400);
  });

  it('enseña hoy y los seis días siguientes, cada clase en su día de la semana', async () => {
    const admin = await signUp(ADMIN);
    const thursday = await createClass(admin);
    await createClass(admin, { name: 'Yoga', weekday: 1, startsAt: '19:30' });

    const member = await signUp('socio@ejemplo.com');
    const response = await member.get('/api/classes').expect(200);
    const { days, isAdmin } = response.body as {
      days: { date: string; classes: Occurrence[] }[];
      isAdmin: boolean;
    };

    expect(isAdmin).toBe(false);
    expect(response.body.schedule).toBeUndefined();
    expect(days.map((day) => day.date)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(days[0]!.classes.map((c) => c.name)).toEqual(['Yoga']);
    expect(days[3]!.classes.map((c) => c.id)).toEqual([thursday]);
    // 18:00 en Madrid en verano son las 16:00 UTC.
    expect(days[3]!.classes[0]!.startsAtIso).toBe('2026-10-01T16:00:00.000Z');
  });

  it('usa la hora de invierno después del cambio de hora', async () => {
    now = new Date('2026-10-26T08:00:00Z'); // lunes, ya en invierno
    const admin = await signUp(ADMIN);
    const classId = await createClass(admin);
    const thursday = await occurrence(admin, classId, '2026-10-29');
    expect(thursday.startsAtIso).toBe('2026-10-29T17:00:00.000Z');
  });
});

describe('reservas', () => {
  it('da plaza hasta llenar y después pone en espera, por orden de llegada', async () => {
    const admin = await signUp(ADMIN);
    const classId = await createClass(admin);
    const ana = await signUp('ana@ejemplo.com');
    const bea = await signUp('bea@ejemplo.com');
    const carla = await signUp('carla@ejemplo.com');
    const dani = await signUp('dani@ejemplo.com');

    const book = (agent: Agent) =>
      agent.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);

    expect((await book(ana)).body).toEqual({ status: 'booked', waitPosition: null });
    expect((await book(bea)).body).toEqual({ status: 'booked', waitPosition: null });
    expect((await book(carla)).body).toEqual({ status: 'waiting', waitPosition: 1 });
    expect((await book(dani)).body).toEqual({ status: 'waiting', waitPosition: 2 });

    // Pulsar dos veces no duplica ni cambia el puesto.
    expect((await book(carla)).body).toEqual({ status: 'waiting', waitPosition: 1 });

    const seen = await occurrence(dani, classId, THURSDAY);
    expect(seen).toMatchObject({ booked: 2, waiting: 2, mine: 'waiting', waitPosition: 2 });
    expect(seen.attendees).toBeUndefined();
  });

  it('cuando alguien con plaza anula, entra el primero de la espera y se le avisa', async () => {
    const admin = await signUp(ADMIN);
    const classId = await createClass(admin);
    const ana = await signUp('ana@ejemplo.com');
    const bea = await signUp('bea@ejemplo.com');
    const carla = await signUp('carla@ejemplo.com');
    for (const agent of [ana, bea, carla]) {
      await agent.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);
    }

    await ana.delete(`/api/classes/${classId}/bookings/${THURSDAY}`).expect(204);

    expect(await occurrence(carla, classId, THURSDAY)).toMatchObject({
      mine: 'booked',
      booked: 2,
      waiting: 0,
    });
    expect(await occurrence(ana, classId, THURSDAY)).toMatchObject({ mine: null });

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]!.to).toBe('carla@ejemplo.com');
    expect(sent[0]!.subject).toBe('Tienes plaza en Crossfit');
    expect(sent[0]!.text).toContain('el jueves 1 de octubre a las 18:00');
  });

  it('salir de la espera no mueve a nadie ni avisa a nadie', async () => {
    const admin = await signUp(ADMIN);
    const classId = await createClass(admin, { capacity: 1 });
    const ana = await signUp('ana@ejemplo.com');
    const bea = await signUp('bea@ejemplo.com');
    await ana.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);
    await bea.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);

    await bea.delete(`/api/classes/${classId}/bookings/${THURSDAY}`).expect(204);
    expect(await occurrence(ana, classId, THURSDAY)).toMatchObject({ mine: 'booked', waiting: 0 });
    await new Promise((resume) => setTimeout(resume, 50));
    expect(sent).toEqual([]);
  });

  it('no deja soltar una plaza a menos de 1 hora, pero sí salir de la espera', async () => {
    const admin = await signUp(ADMIN);
    const classId = await createClass(admin, { capacity: 1 });
    const ana = await signUp('ana@ejemplo.com');
    const bea = await signUp('bea@ejemplo.com');
    await ana.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);
    await bea.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);

    now = new Date('2026-10-01T15:10:00Z'); // 17:10 en Madrid, la clase es a las 18:00

    expect(await occurrence(ana, classId, THURSDAY)).toMatchObject({ canCancel: false });
    const refused = await ana.delete(`/api/classes/${classId}/bookings/${THURSDAY}`).expect(409);
    expect(refused.body.error).toMatch(/menos de 1 hora/);

    expect(await occurrence(bea, classId, THURSDAY)).toMatchObject({ canCancel: true });
    await bea.delete(`/api/classes/${classId}/bookings/${THURSDAY}`).expect(204);
  });

  it('deja anular justo a la hora del límite', async () => {
    const admin = await signUp(ADMIN);
    const classId = await createClass(admin);
    const ana = await signUp('ana@ejemplo.com');
    await ana.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);

    now = new Date('2026-10-01T15:00:00Z'); // 17:00 en Madrid, 60 minutos antes
    await ana.delete(`/api/classes/${classId}/bookings/${THURSDAY}`).expect(204);
  });

  it('no deja reservar una clase empezada, fuera de plazo o en otro día', async () => {
    const admin = await signUp(ADMIN);
    const monday = await createClass(admin, { weekday: 1, startsAt: '09:00' });
    const thursday = await createClass(admin);
    const ana = await signUp('ana@ejemplo.com');

    // Hoy a las 09:00 ya ha pasado: son las 10:00.
    await ana.post(`/api/classes/${monday}/bookings`).send({ date: '2026-09-28' }).expect(409);
    // El lunes que viene cae fuera de los 7 días.
    await ana.post(`/api/classes/${monday}/bookings`).send({ date: '2026-10-05' }).expect(409);
    // Crossfit es los jueves.
    await ana.post(`/api/classes/${thursday}/bookings`).send({ date: '2026-09-30' }).expect(404);
    await ana.post(`/api/classes/999/bookings`).send({ date: THURSDAY }).expect(404);
    await ana.post(`/api/classes/${thursday}/bookings`).send({ date: 'mañana' }).expect(400);
  });

  it('no deja anular una reserva que no existe', async () => {
    const admin = await signUp(ADMIN);
    const classId = await createClass(admin);
    const ana = await signUp('ana@ejemplo.com');
    await ana.delete(`/api/classes/${classId}/bookings/${THURSDAY}`).expect(404);
  });

  it('necesita sesión', async () => {
    await request(app).get('/api/classes').expect(401);
  });
});

describe('administración', () => {
  it('ve quién va y en qué orden; puede quitar a alguien y sube el siguiente', async () => {
    const admin = await signUp(ADMIN);
    const classId = await createClass(admin, { capacity: 1 });
    const ana = await signUp('ana@ejemplo.com');
    const bea = await signUp('bea@ejemplo.com');
    await ana.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);
    await bea.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);

    const seen = await occurrence(admin, classId, THURSDAY);
    expect(seen.attendees?.map(({ name, waiting }) => ({ name, waiting }))).toEqual([
      { name: 'ana', waiting: false },
      { name: 'bea', waiting: true },
    ]);

    // Sin plazo para quien administra, aunque falten diez minutos.
    now = new Date('2026-10-01T15:50:00Z');
    await admin.delete(`/api/classes/bookings/${seen.attendees![0]!.bookingId}`).expect(204);
    expect(await occurrence(bea, classId, THURSDAY)).toMatchObject({ mine: 'booked' });
    await expect.poll(() => sent.map((email) => email.to)).toEqual(['bea@ejemplo.com']);
  });

  it('anula una fecha, avisa a los apuntados y la puede recuperar', async () => {
    const admin = await signUp(ADMIN);
    const classId = await createClass(admin, { capacity: 1 });
    const ana = await signUp('ana@ejemplo.com');
    const bea = await signUp('bea@ejemplo.com');
    const carla = await signUp('carla@ejemplo.com');
    await ana.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);
    await bea.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);

    await admin.put(`/api/classes/${classId}/cancellations/${THURSDAY}`).expect(204);
    // La segunda vez no vuelve a avisar.
    await admin.put(`/api/classes/${classId}/cancellations/${THURSDAY}`).expect(204);

    expect(await occurrence(ana, classId, THURSDAY)).toMatchObject({ cancelled: true });
    await carla.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(409);
    await expect
      .poll(() => sent.map((email) => email.to).sort())
      .toEqual(['ana@ejemplo.com', 'bea@ejemplo.com']);
    expect(sent[0]!.subject).toBe('Clase anulada: Crossfit');

    await admin.delete(`/api/classes/${classId}/cancellations/${THURSDAY}`).expect(204);
    expect(await occurrence(ana, classId, THURSDAY)).toMatchObject({
      cancelled: false,
      mine: 'booked',
    });
  });

  it('al mover una clase de día, las reservas futuras se van con el día viejo', async () => {
    const admin = await signUp(ADMIN);
    const classId = await createClass(admin);
    const ana = await signUp('ana@ejemplo.com');
    await ana.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);

    const body = {
      name: 'Crossfit',
      coach: null,
      weekday: 5,
      startsAt: '18:00',
      durationMinutes: 60,
      capacity: 2,
    };
    await admin.put(`/api/classes/schedule/${classId}`).send(body).expect(200);
    expect(await occurrence(ana, classId, '2026-10-02')).toMatchObject({ mine: null, booked: 0 });

    // Cambiar solo la hora no toca a nadie.
    await ana.post(`/api/classes/${classId}/bookings`).send({ date: '2026-10-02' }).expect(201);
    await admin
      .put(`/api/classes/schedule/${classId}`)
      .send({ ...body, startsAt: '19:00' })
      .expect(200);
    expect(await occurrence(ana, classId, '2026-10-02')).toMatchObject({ mine: 'booked' });
  });

  it('borrar una clase del horario se lleva sus reservas', async () => {
    const admin = await signUp(ADMIN);
    const classId = await createClass(admin);
    const ana = await signUp('ana@ejemplo.com');
    await ana.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);

    await admin.delete(`/api/classes/schedule/${classId}`).expect(204);
    await admin.delete(`/api/classes/schedule/${classId}`).expect(404);
    const { rows } = await db.query('SELECT 1 FROM class_bookings');
    expect(rows).toEqual([]);
  });

  it('sin ADMIN_EMAILS no administra nadie', async () => {
    app = createApp({ db, rateLimits: false, clock: () => now });
    const agent = await signUp(ADMIN);
    const response = await agent.get('/api/classes').expect(200);
    expect(response.body.isAdmin).toBe(false);
  });
});

describe('describeWhen', () => {
  it('dice el día de la semana en castellano', () => {
    expect(describeWhen({ name: 'Yoga', date: '2026-10-04', startsAt: '09:30' })).toBe(
      'el domingo 4 de octubre a las 09:30',
    );
  });
});
