/**
 * Las páginas públicas que Google Play exige y que no pueden depender de tener
 * la app ni de haber iniciado sesión:
 *
 * - `/privacidad`: la política de privacidad (RGPD).
 * - `/borrar-cuenta`: cómo borrar la cuenta, y un formulario para hacerlo sin
 *   la app. Play pide un enlace así además del borrado desde dentro.
 * - `/.well-known/assetlinks.json`: el archivo con el que Android comprueba
 *   que la app de la tienda y esta web son del mismo dueño. Sin él, la app se
 *   abre con la barra de direcciones del navegador encima.
 *
 * HTML generado aquí, sin React: tienen que cargar sin JavaScript, en
 * cualquier navegador, y la CSP no deja scripts en línea.
 */

import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import type { Database } from '../db/database';
import type { EmailSender } from '../email/sender';
import { buildClassNoticeEmail } from '../email/classEmail';
import { promotionsIfLeaving } from '../repositories/classes';
import { WrongPasswordError, deleteAccount, findUserByEmail } from '../repositories/users';
import { createAuthIpLimiter, createAuthLimiter } from './rateLimit';

export interface PublicPagesOptions {
  rateLimits?: boolean;
  email?: EmailSender;
  appUrl?: string;
  /** Quién es el responsable del tratamiento: nombre o razón social. */
  privacyOwner?: string;
  /** Correo de contacto para privacidad. */
  privacyContact?: string;
  /** Paquete Android de la app de la tienda, p. ej. `app.kilaje.twa`. */
  twaPackage?: string;
  /** Huellas SHA-256 de las claves de firma, separadas por comas. */
  twaFingerprints?: string;
}

/** Fecha de la última revisión de la política. Cambiarla al cambiar el texto. */
const PRIVACY_REVISED = '25 de septiembre de 2026';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** El esqueleto común: legible, con el tema del móvil, sin nada externo. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Kilaje</title>
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<style>
  :root { color-scheme: light dark; --bg: #f4f5f2; --card: #ffffff; --text: #171b19; --muted: #55605a; --line: #d8dcd5; --accent: #f2c200; --ink: #0e100f; --bad: #a32a1c; --good: #1d6b38; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e100f; --card: #141716; --text: #f2f4f0; --muted: #9aa39d; --line: #2f3531; --bad: #f08575; --good: #8fd0a0; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 42rem; margin: 0 auto; padding: 24px 16px 64px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
  header img { width: 40px; height: 40px; border-radius: 10px; }
  header a { color: inherit; text-decoration: none; font-weight: 700; letter-spacing: .02em; }
  h1 { font-size: 1.6rem; line-height: 1.2; margin: 0 0 8px; }
  h2 { font-size: 1.1rem; margin: 28px 0 8px; }
  p, li { color: var(--text); }
  .muted { color: var(--muted); font-size: .9rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin: 16px 0; }
  label { display: block; font-weight: 600; margin: 12px 0 4px; }
  input[type=email], input[type=password] { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; }
  .check { display: flex; gap: 10px; align-items: flex-start; font-weight: 400; }
  .check input { margin-top: 5px; width: 18px; height: 18px; }
  button { margin-top: 16px; width: 100%; min-height: 48px; border: 0; border-radius: 12px; background: var(--bad); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
  .alert { border-radius: 12px; padding: 12px 16px; margin: 16px 0; font-weight: 600; }
  .alert.bad { background: color-mix(in srgb, var(--bad) 15%, transparent); color: var(--bad); }
  .alert.good { background: color-mix(in srgb, var(--good) 15%, transparent); color: var(--good); }
  a { color: inherit; }
  footer { margin-top: 40px; display: flex; gap: 16px; flex-wrap: wrap; }
</style>
</head>
<body>
<main>
<header><img src="/icons/icon-192.png" alt=""><a href="/">Kilaje</a></header>
${body}
<footer class="muted"><a href="/">Abrir Kilaje</a><a href="/privacidad">Privacidad</a><a href="/borrar-cuenta">Borrar mi cuenta</a></footer>
</main>
</body>
</html>`;
}

function privacyBody(owner: string, contact: string | null): string {
  const reach = contact
    ? `escribiendo a <a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a>`
    : 'a través de la recepción del gimnasio';
  return `
<h1>Política de privacidad</h1>
<p class="muted">Última actualización: ${PRIVACY_REVISED}</p>

<p>Kilaje es la app del gimnasio para reservar clases y llevar tu entrenamiento. Aquí se explica qué datos tuyos guarda, para qué y qué puedes hacer con ellos.</p>

<h2>Quién es el responsable</h2>
<p>${escapeHtml(owner)}. Puedes contactar para cualquier cuestión de privacidad ${reach}.</p>

<h2>Qué datos guardamos</h2>
<ul>
  <li><strong>Tu cuenta:</strong> correo electrónico, el nombre que elijas mostrar y tu contraseña. La contraseña nunca se guarda tal cual, solo una huella cifrada (scrypt) que no permite recuperarla.</li>
  <li><strong>Tu entrenamiento</strong>, si lo usas: los planes que importas o creas y lo que anotas en ellos (pesos, repeticiones, notas, duración de las sesiones).</li>
  <li><strong>Clases:</strong> tus reservas, tu puesto en las listas de espera y, si el gimnasio pasa lista, si asististe.</li>
  <li><strong>Cuota:</strong> la fecha hasta la que la tienes pagada, si el gimnasio la apunta. La app no cobra nada ni guarda datos de pago.</li>
</ul>
<p>No usamos publicidad, ni herramientas de analítica, ni cookies de terceros. La única cookie es la de tu sesión, necesaria para que la app sepa que has entrado.</p>

<h2>Para qué los usamos</h2>
<ul>
  <li>Que puedas usar la app: entrar, reservar clases y registrar tu entrenamiento.</li>
  <li>Que el gimnasio pueda gestionar el horario, las plazas, las cuotas y la asistencia.</li>
  <li>Mandarte correos sobre tu cuenta y tus reservas: recuperar la contraseña, entrar desde la lista de espera, cambios o anulaciones de clases y el aviso de que tu cuota vence.</li>
</ul>
<p>La base legal es la relación que tienes con el gimnasio (artículo 6.1.b del RGPD) y, para proteger la cuenta frente a accesos indebidos, el interés legítimo (artículo 6.1.f).</p>

<h2>Quién más los trata</h2>
<p>Solo los proveedores que hacen falta para que la app funcione, como encargados del tratamiento:</p>
<ul>
  <li><strong>Railway</strong>, que aloja la app y la base de datos en servidores de la Unión Europea (Países Bajos). Railway es una empresa de EE. UU.; cualquier acceso desde allí queda cubierto por las cláusulas contractuales tipo de la Comisión Europea.</li>
  <li><strong>Brevo</strong> (Francia, UE), que envía los correos.</li>
</ul>
<p>No vendemos ni cedemos tus datos a nadie más. Quien administra el gimnasio ve tu nombre, tu correo, tus reservas, tu asistencia y tu cuota; no ve tu contraseña.</p>

<h2>Cuánto tiempo</h2>
<p>Mientras tengas cuenta. Si la borras, se borran al momento tu cuenta y todo lo asociado: planes, series, reservas y asistencia. El gimnasio recibe una copia de seguridad semanal por correo que puede contener tus datos hasta que esas copias se eliminan.</p>

<h2>Tus derechos</h2>
<p>Puedes pedir acceso a tus datos, corregirlos, borrarlos, oponerte a su uso, limitarlo o llevártelos (tu entrenamiento se puede descargar en Excel desde la app). Para borrar la cuenta tienes <a href="/borrar-cuenta">esta página</a>; para lo demás, contacta ${reach}. Si crees que no se han respetado tus derechos, puedes reclamar ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es">www.aepd.es</a>).</p>

<h2>Menores</h2>
<p>Si tienes menos de 14 años, necesitas que tu padre, tu madre o tu tutor den su consentimiento para que uses la app.</p>

<h2>Seguridad</h2>
<p>Todo viaja cifrado (HTTPS), las contraseñas se guardan cifradas y las sesiones se pueden cerrar en cualquier momento. Aun así, ningún sistema es infalible: si detectamos un problema que afecte a tus datos, te lo contaremos.</p>
`;
}

type DeleteState =
  | { kind: 'form'; error?: string; email?: string }
  | { kind: 'done' };

function deleteBody(state: DeleteState, contact: string | null): string {
  if (state.kind === 'done') {
    return `
<h1>Cuenta borrada</h1>
<div class="alert good">Tu cuenta y todos sus datos se han borrado: planes, series, reservas y asistencia.</div>
<p>Si tenías plaza en alguna clase, ha pasado al primero de la lista de espera.</p>
<p class="muted">Las copias de seguridad semanales que recibe el gimnasio pueden conservar tus datos hasta que se eliminen.</p>`;
  }

  const help = contact
    ? `escribe a <a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a> desde el correo de tu cuenta y lo borraremos nosotros`
    : 'pídelo en la recepción del gimnasio';

  return `
<h1>Borrar mi cuenta de Kilaje</h1>
<p>Al borrar tu cuenta se eliminan <strong>para siempre</strong> tu cuenta y todo lo asociado: tus planes de entrenamiento y lo que anotaste, tus reservas y tu asistencia a clases. No se puede deshacer.</p>

<h2>Desde la app</h2>
<ol>
  <li>Abre Kilaje.</li>
  <li>Si entrenas con la app: <strong>Perfil → Ajustes → Borrar mi cuenta</strong>. Si solo reservas clases: al final de la pantalla de <strong>Clases</strong>, <strong>Borrar mi cuenta</strong>.</li>
  <li>Escribe tu contraseña y pulsa <strong>Borrar para siempre</strong>.</li>
</ol>

<h2>Sin la app, aquí mismo</h2>
${state.error ? `<div class="alert bad" role="alert">${escapeHtml(state.error)}</div>` : ''}
<form class="card" method="post" action="/borrar-cuenta">
  <label for="email">Correo de tu cuenta</label>
  <input id="email" name="email" type="email" autocomplete="email" required value="${escapeHtml(state.email ?? '')}">
  <label for="password">Contraseña</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <label class="check"><input type="checkbox" name="confirm" value="si" required> Entiendo que se borran mi cuenta y todos mis datos, y que no se puede deshacer.</label>
  <button type="submit">Borrar mi cuenta para siempre</button>
</form>

<p class="muted">¿No recuerdas la contraseña? Recupérala desde la pantalla de entrada de <a href="/">la app</a>, o ${help}.</p>`;
}

const deleteForm = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024),
  confirm: z.literal('si'),
});

export function createPublicPagesRouter(
  db: Database,
  {
    rateLimits = true,
    email,
    appUrl = '',
    privacyOwner,
    privacyContact,
    twaPackage,
    twaFingerprints,
  }: PublicPagesOptions = {},
): Router {
  const router = Router();
  const passThrough = (_req: Request, _res: Response, next: NextFunction): void => next();
  const ipLimiter = rateLimits ? createAuthIpLimiter() : passThrough;
  const accountLimiter = rateLimits ? createAuthLimiter() : passThrough;

  const owner = privacyOwner?.trim() || 'El titular de Kilaje y del gimnasio que lo usa';
  const contact = privacyContact?.trim() || null;

  const html = (res: Response, status: number, title: string, body: string) => {
    res.status(status).type('html').setHeader('Cache-Control', 'no-cache').send(page(title, body));
  };

  router.get('/privacidad', (_req, res) => html(res, 200, 'Política de privacidad', privacyBody(owner, contact)));

  router.get('/borrar-cuenta', (_req, res) => {
    // La CSP general prohíbe enviar formularios; esta página es la excepción.
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
    html(res, 200, 'Borrar mi cuenta', deleteBody({ kind: 'form' }, contact));
  });

  router.post(
    '/borrar-cuenta',
    express.urlencoded({ extended: false, limit: '4kb' }),
    ipLimiter,
    accountLimiter,
    (req, res, next) => {
      res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
      const parsed = deleteForm.safeParse(req.body);
      if (!parsed.success) {
        html(res, 400, 'Borrar mi cuenta', deleteBody({ kind: 'form', error: 'Rellena el correo y la contraseña, y marca la casilla de confirmación.', email: typeof req.body?.email === 'string' ? req.body.email : '' }, contact));
        return;
      }
      const { email: address, password } = parsed.data;
      const wrong = () =>
        html(res, 403, 'Borrar mi cuenta', deleteBody({ kind: 'form', error: 'Correo o contraseña incorrectos.', email: address }, contact));

      (async () => {
        const user = await findUserByEmail(db, address);
        if (!user) {
          wrong();
          return;
        }
        const promoted = await promotionsIfLeaving(db, user.id, new Date());
        try {
          await deleteAccount(db, user.id, password);
        } catch (error) {
          if (error instanceof WrongPasswordError) {
            wrong();
            return;
          }
          throw error;
        }
        html(res, 200, 'Cuenta borrada', deleteBody({ kind: 'done' }, contact));
        if (email?.configured) {
          for (const notice of promoted) {
            email.send(buildClassNoticeEmail(notice, appUrl)).catch((cause: unknown) => {
              console.error('[pages] no se ha podido avisar a quien entra desde la espera:', cause);
            });
          }
        }
      })().catch(next);
    },
  );

  router.get('/.well-known/assetlinks.json', (_req, res) => {
    const fingerprints = (twaFingerprints ?? '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    if (!twaPackage || fingerprints.length === 0) {
      // Un 404 de verdad, no la página de la app: Android lo leería como un
      // archivo roto en vez de como uno que falta.
      res.status(404).json([]);
      return;
    }
    res.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: twaPackage, sha256_cert_fingerprints: fingerprints },
      },
    ]);
  });

  return router;
}
