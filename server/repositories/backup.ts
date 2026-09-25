/**
 * Lo que sale en la copia de seguridad semanal: todo lo del gimnasio que no
 * está en el Excel de entrenamiento de cada uno.
 */

import type { Database } from '../db/database';

export interface BackupData {
  members: {
    name: string;
    email: string;
    role: string;
    memberSince: string;
    paidUntil: string | null;
    attended30: number;
    missed30: number;
  }[];
  schedule: {
    weekday: number;
    startsAt: string;
    name: string;
    coach: string | null;
    durationMinutes: number;
    capacity: number;
  }[];
  bookings: {
    date: string;
    startsAt: string;
    className: string;
    member: string;
    email: string;
    status: 'plaza' | 'espera';
    attended: boolean | null;
    cancelled: boolean;
  }[];
  announcements: { createdAt: string; message: string }[];
}

/** Cuántos días atrás llegan las reservas de la copia; las futuras, todas. */
export const BACKUP_BOOKING_DAYS = 90;

export async function loadBackupData(db: Database): Promise<BackupData> {
  const [members, schedule, bookings, announcements] = await Promise.all([
    db.query<{
      name: string;
      email: string;
      role: string;
      created_at: Date | string;
      paid_until: string | null;
      attended_30: number | string;
      missed_30: number | string;
    }>(
      `SELECT COALESCE(NULLIF(trim(u.display_name), ''), split_part(u.email, '@', 1)) AS name,
              u.email, u.role, u.created_at, to_char(u.paid_until, 'YYYY-MM-DD') AS paid_until,
              (SELECT COUNT(*) FROM class_bookings b
                WHERE b.user_id = u.id AND b.attended AND b.class_date >= CURRENT_DATE - 30) AS attended_30,
              (SELECT COUNT(*) FROM class_bookings b
                WHERE b.user_id = u.id AND b.attended = false AND b.class_date >= CURRENT_DATE - 30) AS missed_30
         FROM users u
        ORDER BY lower(u.email)`,
    ),
    db.query<{
      weekday: number;
      starts_at: string;
      name: string;
      coach: string | null;
      duration_minutes: number;
      capacity: number;
    }>(
      `SELECT weekday::int AS weekday, to_char(starts_at, 'HH24:MI') AS starts_at, name, coach,
              duration_minutes::int AS duration_minutes, capacity::int AS capacity
         FROM gym_classes ORDER BY weekday, starts_at, name`,
    ),
    db.query<{
      day: string;
      starts_at: string;
      class_name: string;
      member: string;
      email: string;
      has_place: boolean;
      attended: boolean | null;
      cancelled: boolean;
    }>(
      `WITH ranked AS (
          SELECT b.*, ROW_NUMBER() OVER (PARTITION BY b.class_id, b.class_date ORDER BY b.id) AS position
            FROM class_bookings b
           WHERE b.class_date >= CURRENT_DATE - $1::int
       )
       SELECT to_char(r.class_date, 'YYYY-MM-DD') AS day, to_char(c.starts_at, 'HH24:MI') AS starts_at,
              c.name AS class_name,
              COALESCE(NULLIF(trim(u.display_name), ''), split_part(u.email, '@', 1)) AS member,
              u.email, r.position <= c.capacity AS has_place, r.attended,
              EXISTS (SELECT 1 FROM class_cancellations x
                       WHERE x.class_id = r.class_id AND x.class_date = r.class_date) AS cancelled
         FROM ranked r
         JOIN gym_classes c ON c.id = r.class_id
         JOIN users u       ON u.id = r.user_id
        ORDER BY r.class_date, c.starts_at, r.position`,
      [BACKUP_BOOKING_DAYS],
    ),
    db.query<{ created_at: Date | string; message: string }>(
      'SELECT created_at, message FROM announcements ORDER BY created_at DESC',
    ),
  ]);

  return {
    members: members.rows.map((row) => ({
      name: row.name,
      email: row.email,
      role: row.role,
      memberSince: new Date(row.created_at).toISOString().slice(0, 10),
      paidUntil: row.paid_until,
      attended30: Number(row.attended_30),
      missed30: Number(row.missed_30),
    })),
    schedule: schedule.rows.map((row) => ({
      weekday: Number(row.weekday),
      startsAt: row.starts_at,
      name: row.name,
      coach: row.coach,
      durationMinutes: Number(row.duration_minutes),
      capacity: Number(row.capacity),
    })),
    bookings: bookings.rows.map((row) => ({
      date: row.day,
      startsAt: row.starts_at,
      className: row.class_name,
      member: row.member,
      email: row.email,
      status: row.has_place ? 'plaza' : 'espera',
      attended: row.attended ?? null,
      cancelled: Boolean(row.cancelled),
    })),
    announcements: announcements.rows.map((row) => ({
      createdAt: new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' '),
      message: row.message,
    })),
  };
}

/** Las cuotas que vencen pronto y a las que aún no se ha avisado. */
export async function dueFeeReminders(
  db: Database,
  today: string,
  daysAhead: number,
): Promise<{ id: number; email: string; name: string; paidUntil: string }[]> {
  const { rows } = await db.query<{ id: number; email: string; name: string; paid_until: string }>(
    `SELECT id, email,
            COALESCE(NULLIF(trim(display_name), ''), split_part(email, '@', 1)) AS name,
            to_char(paid_until, 'YYYY-MM-DD') AS paid_until
       FROM users
      WHERE paid_until BETWEEN $1::date AND $1::date + $2::int
        AND fee_reminded_for IS DISTINCT FROM paid_until
      ORDER BY id`,
    [today, daysAhead],
  );
  return rows.map((row) => ({ id: Number(row.id), email: row.email, name: row.name, paidUntil: row.paid_until }));
}

export async function markFeeReminded(db: Database, userId: number, paidUntil: string): Promise<void> {
  await db.query('UPDATE users SET fee_reminded_for = $2::date WHERE id = $1', [userId, paidUntil]);
}

/** Cuándo se hizo por última vez una tarea, o `null` si nunca. */
export async function lastJobRun(db: Database, name: string): Promise<Date | null> {
  const { rows } = await db.query<{ last_run: Date | string }>(
    'SELECT last_run FROM job_runs WHERE name = $1',
    [name],
  );
  return rows[0] ? new Date(rows[0].last_run) : null;
}

export async function recordJobRun(db: Database, name: string, at: Date): Promise<void> {
  await db.query(
    `INSERT INTO job_runs (name, last_run) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET last_run = EXCLUDED.last_run`,
    [name, at.toISOString()],
  );
}
