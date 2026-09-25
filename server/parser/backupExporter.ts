/**
 * La copia de seguridad del gimnasio, en un Excel que cualquiera puede abrir.
 *
 * Una hoja por cosa — socios, horario, reservas, avisos — con cabeceras en
 * castellano y sin fórmulas. No está pensada para volver a importarse: es lo
 * que se abre el día que haga falta saber quién tenía pagado qué.
 */

import * as XLSX from 'xlsx';

import type { BackupData } from '../repositories/backup';

const WEEKDAYS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function attendedLabel(value: boolean | null): string {
  if (value === null) return '';
  return value ? 'Vino' : 'No vino';
}

export function buildBackupWorkbook(data: BackupData): Uint8Array {
  const workbook = XLSX.utils.book_new();

  const sheet = (name: string, rows: (string | number | null)[][], widths: number[]) => {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  };

  sheet(
    'Socios',
    [
      ['Nombre', 'Correo', 'Rol', 'Alta', 'Cuota pagada hasta', 'Vino (30 días)', 'Faltó (30 días)'],
      ...data.members.map((m) => [
        m.name,
        m.email,
        m.role === 'admin' ? 'Administrador' : 'Socio',
        m.memberSince,
        m.paidUntil ?? 'Sin control',
        m.attended30,
        m.missed30,
      ]),
    ],
    [20, 30, 14, 12, 18, 14, 14],
  );

  sheet(
    'Horario',
    [
      ['Día', 'Hora', 'Clase', 'Monitor', 'Minutos', 'Plazas'],
      ...data.schedule.map((c) => [
        WEEKDAYS[c.weekday] ?? '',
        c.startsAt,
        c.name,
        c.coach ?? '',
        c.durationMinutes,
        c.capacity,
      ]),
    ],
    [12, 8, 20, 16, 9, 8],
  );

  sheet(
    'Reservas',
    [
      ['Fecha', 'Hora', 'Clase', 'Socio', 'Correo', 'Plaza', 'Asistencia', 'Clase anulada'],
      ...data.bookings.map((b) => [
        b.date,
        b.startsAt,
        b.className,
        b.member,
        b.email,
        b.status === 'plaza' ? 'Con plaza' : 'En espera',
        attendedLabel(b.attended),
        b.cancelled ? 'Sí' : '',
      ]),
    ],
    [12, 8, 20, 20, 30, 12, 12, 14],
  );

  sheet(
    'Avisos',
    [['Publicado', 'Aviso'], ...data.announcements.map((a) => [a.createdAt, a.message])],
    [18, 80],
  );

  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
