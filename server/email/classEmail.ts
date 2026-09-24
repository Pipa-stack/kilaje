/**
 * Los avisos de clases: has entrado desde la espera, o tu clase se ha anulado.
 *
 * Aparte del envío, como el correo de recuperar contraseña, para que el texto
 * se pueda leer y probar sin red. Texto y HTML dicen lo mismo.
 */

import type { Email } from './sender';
import type { OccurrenceLabel } from '../repositories/classes';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "el jueves 25 de septiembre a las 18:00". */
export function describeWhen({ date, startsAt }: OccurrenceLabel): string {
  const [year, month, day] = date.split('-').map(Number);
  // Mediodía UTC: el día de la semana de una fecha no depende de la zona
  // horaria, pero medianoche sí podría caer en el día de al lado.
  const weekday = new Date(Date.UTC(year!, month! - 1, day!, 12)).getUTCDay();
  return `el ${WEEKDAYS[weekday]} ${day} de ${MONTHS[month! - 1]} a las ${startsAt}`;
}

export function buildPromotedEmail(to: string, label: OccurrenceLabel, appUrl: string): Email {
  const when = describeWhen(label);
  const subject = `Tienes plaza en ${label.name}`;
  const text = [
    `Se ha liberado una plaza y es tuya: ${label.name}, ${when}.`,
    '',
    'Si al final no puedes ir, anúlala en la app para que la aproveche otra persona.',
    appUrl,
  ].join('\n');

  return { to, subject, text, html: wrap(subject, `Se ha liberado una plaza y es tuya: <strong>${escapeHtml(label.name)}</strong>, ${escapeHtml(when)}.`, 'Si al final no puedes ir, anúlala en la app para que la aproveche otra persona.', appUrl) };
}

export function buildCancelledEmail(to: string, label: OccurrenceLabel, appUrl: string): Email {
  const when = describeWhen(label);
  const subject = `Clase anulada: ${label.name}`;
  const text = [
    `La clase de ${label.name} de ${when} se ha anulado.`,
    '',
    'No tienes que hacer nada. Si se recupera, seguirás apuntado donde estabas.',
    appUrl,
  ].join('\n');

  return { to, subject, text, html: wrap(subject, `La clase de <strong>${escapeHtml(label.name)}</strong> de ${escapeHtml(when)} se ha anulado.`, 'No tienes que hacer nada. Si se recupera, seguirás apuntado donde estabas.', appUrl) };
}

export function wrap(title: string, lead: string, note: string, appUrl: string): string {
  const link = appUrl
    ? `<p style="margin: 0 0 24px">
        <a href="${escapeHtml(appUrl)}"
           style="display: inline-block; background: #f2c200; color: #0e100f; font-weight: 700;
                  padding: 12px 20px; border-radius: 10px; text-decoration: none">
          Abrir Kilaje
        </a>
      </p>`
    : '';

  return `
    <div style="font-family: system-ui, sans-serif; line-height: 1.5; color: #171b19; max-width: 480px">
      <h1 style="font-size: 20px; margin: 0 0 16px">${escapeHtml(title)}</h1>
      <p style="margin: 0 0 16px">${lead}</p>
      ${link}
      <p style="margin: 0; color: #55605a; font-size: 14px">${escapeHtml(note)}</p>
    </div>
  `.trim();
}

/** El nombre de la clase lo escribe quien administra, y acaba en un HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
