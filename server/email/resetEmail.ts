/**
 * The password reset message.
 *
 * Kept apart from the sender so the copy can be read, and tested, without a
 * network call. Plain text and HTML say the same thing: some clients show
 * only one of them, and a reset mail that arrives blank is a lockout.
 */

import type { Email } from './sender';

export interface ResetEmailInput {
  to: string;
  /** Absolute link, already carrying the token. */
  link: string;
  minutesValid: number;
}

export function buildResetEmail({ to, link, minutesValid }: ResetEmailInput): Email {
  const subject = 'Restablecer tu contraseña de Barra';

  const text = [
    'Has pedido restablecer la contraseña de tu cuenta de Barra.',
    '',
    `Abre este enlace para elegir una nueva (caduca en ${minutesValid} minutos y solo sirve una vez):`,
    link,
    '',
    'Si no has sido tú, no hace falta que hagas nada: tu contraseña sigue igual.',
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, sans-serif; line-height: 1.5; color: #171b19; max-width: 480px">
      <h1 style="font-size: 20px; margin: 0 0 16px">Restablecer tu contraseña</h1>
      <p style="margin: 0 0 16px">Has pedido restablecer la contraseña de tu cuenta de Barra.</p>
      <p style="margin: 0 0 24px">
        <a href="${escapeHtml(link)}"
           style="display: inline-block; background: #f2c200; color: #0e100f; font-weight: 700;
                  padding: 12px 20px; border-radius: 10px; text-decoration: none">
          Elegir contraseña nueva
        </a>
      </p>
      <p style="margin: 0 0 16px; color: #55605a; font-size: 14px">
        El enlace caduca en ${minutesValid} minutos y solo sirve una vez.
      </p>
      <p style="margin: 0; color: #55605a; font-size: 14px">
        Si no has sido tú, no hace falta que hagas nada: tu contraseña sigue igual.
      </p>
    </div>
  `.trim();

  return { to, subject, text, html };
}

/** The link is built by us, but escaping it costs nothing and closes the hole. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
