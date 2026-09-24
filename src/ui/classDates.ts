/**
 * Fechas de clases, escritas para quien lee en castellano.
 *
 * Las fechas viajan como `YYYY-MM-DD` de pared en el gimnasio. Se trabajan a
 * mediodía UTC para que ninguna zona horaria las empuje al día de al lado.
 */

export const GYM_TIME_ZONE = 'Europe/Madrid';

export const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const WEEKDAY_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function noon(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, 12));
}

/** Día de la semana, 0 = domingo. */
export function weekdayOf(date: string): number {
  return noon(date).getUTCDay();
}

export function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}

export function addDays(date: string, days: number): string {
  const next = noon(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Hoy en el gimnasio, `YYYY-MM-DD`. */
export function gymToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: GYM_TIME_ZONE });
}

/** "Jueves 25 de septiembre", para empezar una línea. */
export function longDateTitle(date: string): string {
  const text = longDate(date);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** "jueves 25 de septiembre". */
export function longDate(date: string): string {
  const when = noon(date);
  return `${WEEKDAY_LONG[when.getUTCDay()]} ${when.getUTCDate()} de ${MONTHS[when.getUTCMonth()]}`;
}

/** "Hoy", "Mañana" o "Jueves 25", respecto a `today`. */
export function dayName(date: string, today: string): string {
  if (date === today) return 'Hoy';
  if (date === addDays(today, 1)) return 'Mañana';
  const name = WEEKDAY_LONG[weekdayOf(date)]!;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${dayNumber(date)}`;
}

/** "18:00" + 90 → "19:30". */
export function endTime(startsAt: string, minutes: number): string {
  const [hours, mins] = startsAt.split(':').map(Number);
  const total = (hours! * 60 + mins! + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
