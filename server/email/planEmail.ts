/**
 * El aviso de que quien administra te ha subido un plan.
 *
 * Mismo formato que los avisos de clases: texto y HTML dicen lo mismo.
 */

import type { Email } from './sender';
import { wrap } from './classEmail';

export function buildPlanAssignedEmail(
  to: string,
  programName: string,
  from: string,
  appUrl: string,
): Email {
  const subject = 'Tienes un plan nuevo en Kilaje';
  const lead = `${from} te ha subido un plan de entrenamiento nuevo: ${programName}.`;
  const note = 'Se abre solo la próxima vez que entres en la app. Tus planes anteriores siguen en Ajustes.';

  return {
    to,
    subject,
    text: [lead, '', note, appUrl].join('\n'),
    html: wrap(subject, escapeHtml(lead), note, appUrl),
  };
}

/** El nombre del plan viene del archivo que alguien subió. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
