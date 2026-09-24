/**
 * Los socios, vistos por quien administra.
 *
 * Lo justo para llevar un gimnasio pequeño: quién hay, qué plan tiene, cuándo
 * entrenó por última vez y qué rol tiene. El detalle del entrenamiento se
 * sigue leyendo con las mismas funciones que usa cada socio para sí mismo.
 */

import type { Database } from '../db/database';
import type { Role } from '../auth/roles';

export interface MemberSummary {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  /** Propietario: administrador siempre, no se puede cambiar. */
  owner: boolean;
  memberSince: string;
  /** Última serie anotada en cualquiera de sus programas. */
  lastTrainedAt: string | null;
  programCount: number;
  /** El programa que abre al entrar: el último subido. */
  currentProgram: string | null;
  /** Hasta qué día tiene la cuota pagada; `null` si no se lleva control. */
  paidUntil: string | null;
  /** Últimos 30 días, según lo que se marcó al pasar lista. */
  attended30: number;
  missed30: number;
}

interface MemberRow {
  id: number;
  email: string;
  display_name: string | null;
  role: Role;
  created_at: Date | string;
  last_trained: Date | string | null;
  program_count: number | string;
  current_program: string | null;
  paid_until: string | null;
  attended_30: number | string;
  missed_30: number | string;
}

/** Nombre, o el correo antes de la @, como en el resto de la app. */
function displayName(row: { email: string; display_name: string | null }): string {
  return row.display_name?.trim() || row.email.split('@')[0] || row.email;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toMember(row: MemberRow, owners: ReadonlySet<string>): MemberSummary {
  const owner = owners.has(row.email.toLowerCase());
  return {
    id: Number(row.id),
    email: row.email,
    displayName: displayName(row),
    role: owner ? 'admin' : row.role,
    owner,
    memberSince: toIso(row.created_at),
    lastTrainedAt: row.last_trained ? toIso(row.last_trained) : null,
    programCount: Number(row.program_count),
    currentProgram: row.current_program,
    paidUntil: row.paid_until,
    attended30: Number(row.attended_30),
    missed30: Number(row.missed_30),
  };
}

/**
 * Todos los socios, o solo el que se pide.
 *
 * Tres subconsultas correlacionadas en lugar de unir todo y agrupar: unir
 * programas con series multiplica filas por cada serie anotada, y aquí solo
 * hacen falta un máximo, un recuento y un nombre.
 */
async function queryMembers(
  db: Database,
  owners: ReadonlySet<string>,
  userId: number | null,
): Promise<MemberSummary[]> {
  const { rows } = await db.query<MemberRow>(
    `SELECT u.id, u.email, u.display_name, u.role, u.created_at,
            (SELECT MAX(ss.performed_at)
               FROM session_sets ss
               JOIN exercises e    ON e.id = ss.exercise_id
               JOIN workout_days d ON d.id = e.day_id
               JOIN weeks w        ON w.id = d.week_id
               JOIN programs p     ON p.id = w.program_id
              WHERE p.user_id = u.id)                                   AS last_trained,
            (SELECT COUNT(*) FROM programs p WHERE p.user_id = u.id)    AS program_count,
            (SELECT p.name FROM programs p WHERE p.user_id = u.id
              ORDER BY p.imported_at DESC, p.id DESC LIMIT 1)          AS current_program,
            to_char(u.paid_until, 'YYYY-MM-DD')                         AS paid_until,
            (SELECT COUNT(*) FROM class_bookings b
              WHERE b.user_id = u.id AND b.attended
                AND b.class_date >= CURRENT_DATE - 30)                  AS attended_30,
            (SELECT COUNT(*) FROM class_bookings b
              WHERE b.user_id = u.id AND b.attended = false
                AND b.class_date >= CURRENT_DATE - 30)                  AS missed_30
       FROM users u
      WHERE $1::bigint IS NULL OR u.id = $1
      ORDER BY lower(COALESCE(NULLIF(trim(u.display_name), ''), u.email))`,
    [userId],
  );
  return rows.map((row) => toMember(row, owners));
}

export function listMembers(db: Database, owners: ReadonlySet<string>): Promise<MemberSummary[]> {
  return queryMembers(db, owners, null);
}

export async function getMember(
  db: Database,
  owners: ReadonlySet<string>,
  userId: number,
): Promise<MemberSummary | null> {
  return (await queryMembers(db, owners, userId))[0] ?? null;
}

/** Un cambio de rol que no se permite. */
export class RoleChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleChangeError';
  }
}

/**
 * Cambia el rol de un socio.
 *
 * Ni el de un propietario — lo es por configuración, no por esta fila — ni el
 * propio: quitarse el rol a uno mismo por error dejaría fuera a quien lo pulsó
 * sin nadie que pueda devolvérselo.
 */
export async function setRole(
  db: Database,
  actorId: number,
  target: MemberSummary,
  role: Role,
): Promise<void> {
  if (target.owner) {
    throw new RoleChangeError('La cuenta propietaria es administradora siempre.');
  }
  if (target.id === actorId) {
    throw new RoleChangeError('No puedes cambiar tu propio rol.');
  }
  await db.query('UPDATE users SET role = $2 WHERE id = $1', [target.id, role]);
}

/** Marca un programa como subido por otra persona. */
export async function markAssigned(
  db: Database,
  programId: number,
  assignedBy: number,
): Promise<void> {
  await db.query('UPDATE programs SET assigned_by = $2 WHERE id = $1', [programId, assignedBy]);
}

/** Apunta hasta cuándo tiene pagado. `null` deja de llevar control. */
export async function setPaidUntil(
  db: Database,
  userId: number,
  paidUntil: string | null,
): Promise<void> {
  await db.query('UPDATE users SET paid_until = $2::date WHERE id = $1', [userId, paidUntil]);
}
