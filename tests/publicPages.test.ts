// @vitest-environment node
/**
 * Las páginas públicas que pide Google Play: privacidad, borrar la cuenta sin
 * la app, y el archivo con el que Android verifica que la app es de esta web.
 */

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server/app';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase';

const PASSWORD = 'contrasena-de-prueba';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.truncate();
}, 30_000);

const app = (publicPages = {}) => createApp({ db, rateLimits: false, publicPages });

describe('privacidad', () => {
  it('se ve sin sesión y dice quién es el responsable y cómo contactarle', async () => {
    const response = await request(app({ privacyOwner: 'Gimnasio Ejemplo S.L.', privacyContact: 'hola@ejemplo.com' }))
      .get('/privacidad')
      .expect(200)
      .expect('Content-Type', /html/);
    expect(response.text).toContain('Política de privacidad');
    expect(response.text).toContain('Gimnasio Ejemplo S.L.');
    expect(response.text).toContain('mailto:hola@ejemplo.com');
    expect(response.text).toContain('www.aepd.es');
  });

  it('escapa lo que viene de la configuración', async () => {
    const response = await request(app({ privacyOwner: '<script>x</script>' })).get('/privacidad').expect(200);
    expect(response.text).not.toContain('<script>x</script>');
    expect(response.text).toContain('&lt;script&gt;');
  });
});

describe('borrar la cuenta sin la app', () => {
  it('enseña los pasos y un formulario que la CSP deja enviar', async () => {
    const response = await request(app()).get('/borrar-cuenta').expect(200);
    expect(response.text).toContain('Borrar mi cuenta de Kilaje');
    expect(response.text).toContain('<form');
    expect(response.headers['content-security-policy']).toContain("form-action 'self'");
  });

  it('borra la cuenta con el correo y la contraseña correctos', async () => {
    const server = app();
    await request(server).post('/api/auth/register').send({ email: 'ana@ejemplo.com', password: PASSWORD }).expect(201);

    await request(server)
      .post('/borrar-cuenta')
      .type('form')
      .send({ email: 'ana@ejemplo.com', password: 'otra-contrasena', confirm: 'si' })
      .expect(403)
      .expect(/Correo o contraseña incorrectos/);
    await request(server)
      .post('/borrar-cuenta')
      .type('form')
      .send({ email: 'nadie@ejemplo.com', password: PASSWORD, confirm: 'si' })
      .expect(403)
      .expect(/Correo o contraseña incorrectos/);
    await request(server)
      .post('/borrar-cuenta')
      .type('form')
      .send({ email: 'ana@ejemplo.com', password: PASSWORD })
      .expect(400);

    await request(server)
      .post('/borrar-cuenta')
      .type('form')
      .send({ email: 'ana@ejemplo.com', password: PASSWORD, confirm: 'si' })
      .expect(200)
      .expect(/Cuenta borrada/);
    const { rows } = await db.query('SELECT 1 FROM users');
    expect(rows).toEqual([]);
  });
});

describe('verificación de Android', () => {
  it('sin configurar contesta 404 en JSON, no con la página de la app', async () => {
    const response = await request(app()).get('/.well-known/assetlinks.json').expect(404);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('configurada, sirve el paquete y las huellas', async () => {
    const response = await request(
      app({ twaPackage: 'app.kilaje.twa', twaFingerprints: 'aa:bb:cc, DD:EE:FF' }),
    )
      .get('/.well-known/assetlinks.json')
      .expect(200)
      .expect('Content-Type', /json/);
    expect(response.body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'app.kilaje.twa',
          sha256_cert_fingerprints: ['AA:BB:CC', 'DD:EE:FF'],
        },
      },
    ]);
  });
});
