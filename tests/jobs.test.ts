// @vitest-environment node
/**
 * Lo que el servidor hace solo: la copia de seguridad semanal, el aviso de
 * cuota, y los avisos cuando un cambio de horario le toca la reserva a alguien.
 */

import express from 'express';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server/app';
import type { Email, EmailSender } from '../server/email/sender';
import { runBackup, runFeeReminders, tick, type JobContext } from '../server/jobs/scheduler';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase';

const PASSWORD = 'contrasena-de-prueba';
const OWNER = 'jefa@gimnasio.com';
/** Lunes 28/09/2026 a las 10:00 en Madrid. */
const MONDAY_10 = new Date('2026-09-28T08:00:00Z');
const THURSDAY = '2026-10-01';

let db: TestDatabase;
let app: express.Express;
let now: Date;
let sent: Email[];
let email: EmailSender;

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
  email = {
    configured: true,
    async send(message) {
      sent.push(message);
      return true;
    },
  };
  app = createApp({ db, rateLimits: false, adminEmails: [OWNER], email, appUrl: 'https://kilaje.test', clock: () => now });
}, 30_000);

async function signUp(address: string) {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/register').send({ email: address, password: PASSWORD }).expect(201);
  return { agent, id: (response.body as { user: { id: number } }).user.id };
}

type Agent = ReturnType<typeof request.agent>;

async function createClass(admin: Agent, overrides: Record<string, unknown> = {}): Promise<number> {
  const body = { name: 'Turno', coach: null, weekday: 4, startsAt: '18:00', durationMinutes: 90, capacity: 2, ...overrides };
  const response = await admin.post('/api/classes/schedule').send(body).expect(201);
  return (response.body as { class: { id: number } }).class.id;
}

const classBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Turno',
  coach: null,
  weekday: 4,
  startsAt: '18:00',
  durationMinutes: 90,
  capacity: 2,
  ...overrides,
});

const context = (): JobContext => ({ db, email, owners: [OWNER], appUrl: 'https://kilaje.test' });

describe('cambios de horario que tocan reservas', () => {
  async function threeBooked() {
    const owner = await signUp(OWNER);
    const classId = await createClass(owner.agent);
    const people = [];
    for (const name of ['ana', 'bea', 'carla']) {
      const person = await signUp(`${name}@ejemplo.com`);
      await person.agent.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);
      people.push(person);
    }
    return { owner, classId };
  }

  it('al bajar las plazas avisa a quien pasa a la espera', async () => {
    const { owner, classId } = await threeBooked();
    const response = await owner.agent.put(`/api/classes/schedule/${classId}`).send(classBody({ capacity: 1 })).expect(200);
    expect(response.body.notified).toBe(1);
    await expect.poll(() => sent.map((m) => [m.to, m.subject])).toEqual([
      ['bea@ejemplo.com', 'Ya no tienes plaza en Turno'],
    ]);
    expect(sent[0]!.text).toContain('vas el 1º');
  });

  it('al subir las plazas avisa a quien entra desde la espera', async () => {
    const { owner, classId } = await threeBooked();
    await owner.agent.put(`/api/classes/schedule/${classId}`).send(classBody({ capacity: 3 })).expect(200);
    await expect.poll(() => sent.map((m) => [m.to, m.subject])).toEqual([
      ['carla@ejemplo.com', 'Tienes plaza en Turno'],
    ]);
  });

  it('al cambiar la hora avisa a todos los apuntados, con plaza o en espera', async () => {
    const { owner, classId } = await threeBooked();
    await owner.agent.put(`/api/classes/schedule/${classId}`).send(classBody({ startsAt: '19:00' })).expect(200);
    await expect.poll(() => sent.length).toBe(3);
    expect(sent.every((m) => m.subject === 'Turno cambia de hora')).toBe(true);
    expect(sent[0]!.text).toContain('pasa a ser a las 19:00');
  });

  it('al cambiar de día o borrar la clase avisa de que la reserva se ha anulado', async () => {
    const { owner, classId } = await threeBooked();
    await owner.agent.put(`/api/classes/schedule/${classId}`).send(classBody({ weekday: 5 })).expect(200);
    await expect.poll(() => sent.length).toBe(3);
    expect(sent[0]!.subject).toBe('Tu reserva de Turno se ha anulado');

    sent.length = 0;
    const other = await createClass(owner.agent, { name: 'Yoga' });
    const ana = await signUp('dani@ejemplo.com');
    await ana.agent.post(`/api/classes/${other}/bookings`).send({ date: THURSDAY }).expect(201);
    await owner.agent.delete(`/api/classes/schedule/${other}`).expect(204);
    await expect.poll(() => sent.map((m) => [m.to, m.subject])).toEqual([
      ['dani@ejemplo.com', 'Tu reserva de Yoga se ha anulado'],
    ]);
  });

  it('cambiar solo el nombre o el monitor no avisa a nadie', async () => {
    const { owner, classId } = await threeBooked();
    const response = await owner.agent
      .put(`/api/classes/schedule/${classId}`)
      .send(classBody({ coach: 'Laura' }))
      .expect(200);
    expect(response.body.notified).toBe(0);
  });

  it('si alguien con plaza borra su cuenta, avisa al primero de la espera', async () => {
    const owner = await signUp(OWNER);
    const classId = await createClass(owner.agent, { capacity: 1 });
    const ana = await signUp('ana@ejemplo.com');
    const bea = await signUp('bea@ejemplo.com');
    await ana.agent.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);
    await bea.agent.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);

    // La clase de esta prueba es futura respecto al reloj real del servidor
    // de cuentas, que no usa el reloj fijo: se pone muy lejos para no fallar.
    await db.query(`UPDATE class_bookings SET class_date = DATE '2099-01-01'`);
    await db.query(`UPDATE gym_classes SET weekday = EXTRACT(ISODOW FROM DATE '2099-01-01')`);

    await ana.agent.delete('/api/auth/account').send({ password: PASSWORD }).expect(204);
    await expect.poll(() => sent.map((m) => [m.to, m.subject])).toEqual([
      ['bea@ejemplo.com', 'Tienes plaza en Turno'],
    ]);
  });
});

describe('norma de faltas', () => {
  it('con 3 faltas en 30 días no se reserva hasta una semana después de la última', async () => {
    const owner = await signUp(OWNER);
    const classId = await createClass(owner.agent);
    const ana = await signUp('ana@ejemplo.com');
    for (const day of ['2026-09-10', '2026-09-17', '2026-09-24']) {
      await db.query(
        `INSERT INTO class_bookings (class_id, class_date, user_id, attended) VALUES ($1, $2::date, $3, false)`,
        [classId, day, ana.id],
      );
    }

    const refused = await ana.agent.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(409);
    expect(refused.body.error).toBe(
      'Has faltado 3 veces sin avisar en el último mes. Podrás volver a reservar desde el 1 de octubre; si crees que es un error, habla con recepción.',
    );

    // Quien administra sí puede apuntarle.
    await owner.agent.post(`/api/classes/${classId}/attendees`).send({ date: THURSDAY, userId: ana.id }).expect(201);

    // Pasada la semana, vuelve a poder.
    now = new Date('2026-10-01T08:00:00Z');
    await ana.agent.delete(`/api/classes/${classId}/bookings/${THURSDAY}`).expect(204);
    await ana.agent.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);
  });

  it('dos faltas, o faltas sin marcar, no bloquean', async () => {
    const owner = await signUp(OWNER);
    const classId = await createClass(owner.agent);
    const ana = await signUp('ana@ejemplo.com');
    for (const [day, attended] of [['2026-09-17', false], ['2026-09-24', false], ['2026-09-10', null]] as const) {
      await db.query(
        `INSERT INTO class_bookings (class_id, class_date, user_id, attended) VALUES ($1, $2::date, $3, $4)`,
        [classId, day, ana.id, attended],
      );
    }
    await ana.agent.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);
  });
});

describe('copia de seguridad', () => {
  it('manda a los propietarios un Excel con socios, horario, reservas y avisos', async () => {
    const owner = await signUp(OWNER);
    const classId = await createClass(owner.agent);
    const ana = await signUp('ana@ejemplo.com');
    await ana.agent.post(`/api/classes/${classId}/bookings`).send({ date: THURSDAY }).expect(201);
    await owner.agent.put(`/api/admin/members/${ana.id}/paid-until`).send({ paidUntil: '2026-10-31' }).expect(200);
    await owner.agent.post('/api/announcements').send({ message: 'Cerramos el lunes.' }).expect(201);

    expect(await runBackup(context(), now)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(OWNER);
    expect(sent[0]!.subject).toBe('Copia de seguridad de Kilaje — 2026-09-28');
    const file = sent[0]!.attachments![0]!;
    expect(file.name).toBe('kilaje-copia-2026-09-28.xlsx');

    const workbook = XLSX.read(file.content, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['Socios', 'Horario', 'Reservas', 'Avisos']);
    const members = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Socios']!);
    expect(members.find((row) => row.Correo === 'ana@ejemplo.com')).toMatchObject({
      'Cuota pagada hasta': '2026-10-31',
      Rol: 'Socio',
    });
    const bookings = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Reservas']!);
    expect(bookings).toEqual([
      expect.objectContaining({ Fecha: THURSDAY, Hora: '18:00', Clase: 'Turno', Correo: 'ana@ejemplo.com', Plaza: 'Con plaza' }),
    ]);
    const notices = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Avisos']!);
    expect(notices[0]!.Aviso).toBe('Cerramos el lunes.');
  });

  it('sale una vez por semana, a partir de las 7, y un reinicio no la repite', async () => {
    await signUp(OWNER);
    const ctx = context();

    expect(await tick(ctx, new Date('2026-09-28T04:30:00Z'))).toEqual([]); // 06:30 en Madrid
    expect(await tick(ctx, new Date('2026-09-28T05:10:00Z'))).toContain('backup'); // 07:10
    expect(await tick(ctx, new Date('2026-09-28T05:25:00Z'))).not.toContain('backup');
    expect(await tick(ctx, new Date('2026-10-02T09:00:00Z'))).not.toContain('backup');
    expect(await tick(ctx, new Date('2026-10-05T05:10:00Z'))).toContain('backup');
    expect(sent.filter((m) => m.subject.startsWith('Copia'))).toHaveLength(2);
  });
});

describe('aviso de cuota', () => {
  it('avisa una vez a quien le vence en 3 días o menos, y otra vez solo si renueva', async () => {
    const owner = await signUp(OWNER);
    const ana = await signUp('ana@ejemplo.com');
    const bea = await signUp('bea@ejemplo.com');
    await owner.agent.put(`/api/admin/members/${ana.id}/paid-until`).send({ paidUntil: '2026-09-30' }).expect(200);
    await owner.agent.put(`/api/admin/members/${bea.id}/paid-until`).send({ paidUntil: '2026-10-15' }).expect(200);

    expect(await runFeeReminders(context(), now)).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(['ana@ejemplo.com']);
    expect(sent[0]!.subject).toBe('Tu cuota de Kilaje vence pronto');
    expect(sent[0]!.text).toContain('pagada hasta el miércoles 30 de septiembre');

    // El mismo día, o al siguiente, no se repite.
    expect(await runFeeReminders(context(), new Date('2026-09-29T08:00:00Z'))).toBe(0);

    // Renueva y, cuando vuelva a vencer, se le avisa otra vez.
    await owner.agent.put(`/api/admin/members/${ana.id}/paid-until`).send({ paidUntil: '2026-10-30' }).expect(200);
    // Bea venció el 15 y ya no está en el plazo de aviso: solo Ana.
    sent.length = 0;
    expect(await runFeeReminders(context(), new Date('2026-10-28T08:00:00Z'))).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(['ana@ejemplo.com']);
  });

  it('el temporizador lo hace una vez al día, a partir de las 9', async () => {
    await signUp('ana@ejemplo.com');
    const ctx = { ...context(), owners: [] };
    expect(await tick(ctx, new Date('2026-09-28T06:30:00Z'))).toEqual([]); // 08:30 en Madrid
    expect(await tick(ctx, new Date('2026-09-28T07:10:00Z'))).toEqual(['fee-reminders:0']);
    expect(await tick(ctx, new Date('2026-09-28T15:00:00Z'))).toEqual([]);
    expect(await tick(ctx, new Date('2026-09-29T07:10:00Z'))).toEqual(['fee-reminders:0']);
  });
});

describe('seguridad', () => {
  it('un socio no llega a enviar un archivo a la administración: se le para antes', async () => {
    await signUp(OWNER);
    const ana = await signUp('ana@ejemplo.com');
    // Con un cuerpo pequeño se ve el 403. Con uno de 11 MB el servidor contesta
    // y cierra sin leerlo, y el cliente puede ver la conexión cortada: las dos
    // cosas prueban que no se guardó en memoria, que es lo que importa.
    await ana.agent
      .post(`/api/admin/members/${ana.id}/programs?filename=x.xlsx`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(10))
      .expect(403);
    try {
      const response = await ana.agent
        .post(`/api/admin/members/${ana.id}/programs?filename=x.xlsx`)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.alloc(11 * 1024 * 1024));
      expect(response.status).toBe(403);
    } catch (error) {
      expect((error as { code?: string }).code).toMatch(/ECONNRESET|EPIPE/);
    }
  });
});
