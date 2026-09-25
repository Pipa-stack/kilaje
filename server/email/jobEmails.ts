/**
 * Los correos que el servidor manda solo: la copia de seguridad semanal y el
 * aviso de cuota a punto de vencer.
 */

import type { Attachment, Email } from './sender';
import { wrap } from './classEmail';
import { describeWhen } from './classEmail';

export function buildBackupEmail(to: string, date: string, file: Attachment, counts: {
  members: number;
  bookings: number;
}): Email {
  const subject = `Copia de seguridad de Kilaje — ${date}`;
  const lead = `Adjunta va la copia semanal del gimnasio: ${counts.members} socios, el horario, ${counts.bookings} reservas de los últimos tres meses y las futuras, y los avisos.`;
  const note =
    'Guárdala en algún sitio que no sea este correo: en el ordenador o en la nube. Es lo que permite recuperar socios, cuotas y reservas si algún día se pierde la base de datos.';
  return {
    to,
    subject,
    text: [lead, '', note].join('\n'),
    html: wrap(subject, lead, note, ''),
    attachments: [file],
  };
}

export function buildFeeReminderEmail(to: string, paidUntil: string, appUrl: string): Email {
  // Se reutiliza la forma de describir una fecha de las clases, sin la hora.
  const when = describeWhen({ name: '', date: paidUntil, startsAt: '' }).replace(/ a las $/, '');
  const subject = 'Tu cuota de Kilaje vence pronto';
  const lead = `Tu cuota está pagada hasta ${when}. Después de ese día no podrás reservar clases hasta renovarla.`;
  const note = 'Pásate por recepción para renovarla. Si ya lo has hecho, no hace falta que hagas nada.';
  return {
    to,
    subject,
    text: [lead, '', note, appUrl].join('\n'),
    html: wrap(subject, lead, note, appUrl),
  };
}
