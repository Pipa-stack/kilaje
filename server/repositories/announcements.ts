/**
 * Avisos del gimnasio para todos los socios: un cierre, un cambio de horario.
 */

import type { Database } from '../db/database';

export interface Announcement {
  id: number;
  message: string;
  createdAt: string;
}

/** Los que se enseñan a la vez. Más ya no se leen. */
export const MAX_ANNOUNCEMENTS = 5;

export async function listAnnouncements(db: Database): Promise<Announcement[]> {
  const { rows } = await db.query<{ id: number; message: string; created_at: Date | string }>(
    `SELECT id, message, created_at FROM announcements ORDER BY created_at DESC, id DESC LIMIT $1`,
    [MAX_ANNOUNCEMENTS],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    message: row.message,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function createAnnouncement(
  db: Database,
  message: string,
  createdBy: number,
): Promise<Announcement> {
  const { rows } = await db.query<{ id: number; message: string; created_at: Date | string }>(
    `INSERT INTO announcements (message, created_by) VALUES ($1, $2)
     RETURNING id, message, created_at`,
    [message, createdBy],
  );
  const row = rows[0]!;
  return { id: Number(row.id), message: row.message, createdAt: new Date(row.created_at).toISOString() };
}

export async function deleteAnnouncement(db: Database, id: number): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM announcements WHERE id = $1', [id]);
  return rowCount > 0;
}
