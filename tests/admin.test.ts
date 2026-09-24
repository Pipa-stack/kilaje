// @vitest-environment node
/**
 * Roles y administración de socios.
 *
 * Lo que importa es quién puede hacer qué: un socio no ve a nadie más, un
 * administrador ve a todos y les sube el plan, y a la cuenta propietaria no se
 * le puede quitar el mando desde la app.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server/app';
import type { Email, EmailSender } from '../server/email/sender';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase';

const PASSWORD = 'contrasena-de-prueba';
const OWNER = 'jefa@gimnasio.com';
const WORKBOOK = readFileSync(resolve(process.cwd(), 'Ejemplo/ejemplo.xlsx'));

let db: TestDatabase;
let app: express.Express;
let sent: Email[];

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.truncate();
  sent = [];
  const email: EmailSender = {
    configured: true,
    async send(message) {
      sent.push(message);
      return true;
    },
  };
  app = createApp({ db, rateLimits: false, adminEmails: [OWNER], email, appUrl: 'https://kilaje.test' });
}, 30_000);

async function signUp(address: string) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/register')
    .send({ email: address, password: PASSWORD })
    .expect(201);
  return { agent, id: (response.body as { user: { id: number } }).user.id };
}

function upload(agent: ReturnType<typeof request.agent>, userId: number) {
  return agent
    .post(`/api/admin/members/${userId}/programs?filename=${encodeURIComponent('Plan Ana.xlsx')}`)
    .set('Content-Type', 'application/octet-stream')
    .send(WORKBOOK);
}

describe('roles', () => {
  it('la cuenta dice su rol al entrar y en /me', async () => {
    const owner = await signUp(OWNER);
    const ana = await signUp('ana@ejemplo.com');

    expect((await owner.agent.get('/api/auth/me').expect(200)).body.user.role).toBe('admin');
    expect((await ana.agent.get('/api/auth/me').expect(200)).body.user.role).toBe('member');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: OWNER, password: PASSWORD })
      .expect(200);
    expect(login.body.user.role).toBe('admin');
  });

  it('un socio no entra en la administración', async () => {
    await signUp(OWNER);
    const ana = await signUp('ana@ejemplo.com');
    await ana.agent.get('/api/admin/members').expect(403);
    await upload(ana.agent, ana.id).expect(403);
    await request(app).get('/api/admin/members').expect(401);
  });

  it('hacer administrador a alguien vale al momento, y quitárselo también', async () => {
    const owner = await signUp(OWNER);
    const ana = await signUp('ana@ejemplo.com');

    await owner.agent.patch(`/api/admin/members/${ana.id}`).send({ role: 'admin' }).expect(200);
    await ana.agent.get('/api/admin/members').expect(200);
    // El mismo rol sirve para las clases.
    await ana.agent
      .post('/api/classes/schedule')
      .send({ name: 'Turno', coach: null, weekday: 1, startsAt: '08:00', durationMinutes: 90, capacity: 7 })
      .expect(201);

    await owner.agent.patch(`/api/admin/members/${ana.id}`).send({ role: 'member' }).expect(200);
    await ana.agent.get('/api/admin/members').expect(403);
  });

  it('nadie le quita el rol a la cuenta propietaria, ni uno a sí mismo', async () => {
    const owner = await signUp(OWNER);
    const ana = await signUp('ana@ejemplo.com');
    await owner.agent.patch(`/api/admin/members/${ana.id}`).send({ role: 'admin' }).expect(200);

    const refused = await ana.agent
      .patch(`/api/admin/members/${owner.id}`)
      .send({ role: 'member' })
      .expect(409);
    expect(refused.body.error).toMatch(/propietaria/);

    await ana.agent.patch(`/api/admin/members/${ana.id}`).send({ role: 'member' }).expect(409);
    await owner.agent.patch(`/api/admin/members/${ana.id}`).send({ role: 'jefe' }).expect(400);
  });
});

describe('socios', () => {
  it('lista a todos con su rol y su plan', async () => {
    const owner = await signUp(OWNER);
    const ana = await signUp('ana@ejemplo.com');
    await upload(owner.agent, ana.id).expect(201);

    const { members } = (await owner.agent.get('/api/admin/members').expect(200)).body as {
      members: { email: string; role: string; owner: boolean; programCount: number; currentProgram: string | null }[];
    };
    expect(members.map((m) => [m.email, m.role, m.owner])).toEqual([
      ['ana@ejemplo.com', 'member', false],
      [OWNER, 'admin', true],
    ]);
    expect(members[0]).toMatchObject({ programCount: 1, currentProgram: 'Plan Ana' });
    await owner.agent.get('/api/admin/members/999').expect(404);
  });

  it('sube el planning a un socio: se le abre a él, sabe quién se lo puso y le llega un correo', async () => {
    const owner = await signUp(OWNER);
    const ana = await signUp('ana@ejemplo.com');

    const response = await upload(owner.agent, ana.id).expect(201);
    expect(response.body).toMatchObject({ created: true, name: 'Plan Ana' });

    const latest = await ana.agent.get('/api/programs/latest').expect(200);
    expect(latest.body.program.name).toBe('Plan Ana');
    const { programs } = (await ana.agent.get('/api/programs').expect(200)).body;
    expect(programs[0].assignedBy).toBe('jefa');

    // No aparece en los programas de quien lo subió.
    await owner.agent.get('/api/programs/latest').expect(404);

    await expect.poll(() => sent.map((email) => email.to)).toEqual(['ana@ejemplo.com']);
    expect(sent[0]!.subject).toBe('Tienes un plan nuevo en Kilaje');
    expect(sent[0]!.text).toContain('jefa te ha subido un plan de entrenamiento nuevo: Plan Ana.');

    // El mismo archivo otra vez no duplica ni vuelve a avisar.
    const again = await upload(owner.agent, ana.id).expect(200);
    expect(again.body.created).toBe(false);
    await new Promise((resume) => setTimeout(resume, 50));
    expect(sent).toHaveLength(1);
  });

  it('un plan que se importa uno mismo no lleva "subido por"', async () => {
    const ana = await signUp('ana@ejemplo.com');
    await ana.agent
      .post('/api/programs?filename=mio.xlsx')
      .set('Content-Type', 'application/octet-stream')
      .send(WORKBOOK)
      .expect(201);
    const { programs } = (await ana.agent.get('/api/programs').expect(200)).body;
    expect(programs[0].assignedBy).toBeNull();
  });

  it('ve los planes del socio, descarga su progreso y puede borrar uno', async () => {
    const owner = await signUp(OWNER);
    const ana = await signUp('ana@ejemplo.com');
    const { programId } = (await upload(owner.agent, ana.id).expect(201)).body as { programId: number };

    const detail = await owner.agent.get(`/api/admin/members/${ana.id}`).expect(200);
    expect(detail.body.member.email).toBe('ana@ejemplo.com');
    expect(detail.body.programs.map((p: { id: number }) => p.id)).toEqual([programId]);

    const file = await owner.agent
      .get(`/api/admin/members/${ana.id}/programs/${programId}/export`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
    // Un .xlsx es un zip: empieza por "PK".
    expect((file.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    // El id de un plan de otro socio no sirve con este socio en la ruta.
    const other = await signUp('bea@ejemplo.com');
    await owner.agent.delete(`/api/admin/members/${other.id}/programs/${programId}`).expect(404);

    await owner.agent.delete(`/api/admin/members/${ana.id}/programs/${programId}`).expect(204);
    await ana.agent.get('/api/programs/latest').expect(404);
  });

  it('rechaza un archivo vacío o que no es la plantilla', async () => {
    const owner = await signUp(OWNER);
    const ana = await signUp('ana@ejemplo.com');
    await owner.agent
      .post(`/api/admin/members/${ana.id}/programs?filename=x.xlsx`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(0))
      .expect(400);
    const bad = await owner.agent
      .post(`/api/admin/members/${ana.id}/programs?filename=x.xlsx`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('esto no es un excel'));
    expect([400, 422]).toContain(bad.status);
  });
});
