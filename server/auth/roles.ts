/**
 * Roles: socio o administrador.
 *
 * El rol vive en `users.role`, salvo para los propietarios — los correos de
 * `ADMIN_EMAILS` —, que son administradores siempre. Ver
 * `migrations/010_roles.sql`.
 */

import type { NextFunction, Request, Response } from 'express';

import type { Database } from '../db/database';
import { findUserRole } from '../repositories/users';

export type Role = 'member' | 'admin';

export interface Access {
  role: Role;
  /** Viene de `ADMIN_EMAILS`: no se puede degradar desde la app. */
  owner: boolean;
}

/** Normaliza la lista de propietarios una vez, al crear la app. */
export function ownerSet(emails: readonly string[] = []): ReadonlySet<string> {
  return new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean));
}

export async function resolveAccess(
  db: Database,
  userId: number,
  owners: ReadonlySet<string>,
): Promise<Access | null> {
  const user = await findUserRole(db, userId);
  if (!user) return null;
  const owner = owners.has(user.email.toLowerCase());
  return { role: owner ? 'admin' : user.role, owner };
}

/**
 * Deja pasar solo a administradores. Va detrás de `requireUser`.
 *
 * Se consulta la base en cada petición en vez de fiarse de lo que se leyó al
 * iniciar sesión: quitarle el rol a alguien tiene que surtir efecto ya, no
 * cuando caduque su sesión dentro de un mes.
 */
export function requireAdmin(db: Database, owners: ReadonlySet<string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.userId === undefined) {
      res.status(401).json({ error: 'Necesitas iniciar sesión.' });
      return;
    }
    resolveAccess(db, req.userId, owners)
      .then((access) => {
        if (access?.role === 'admin') next();
        else res.status(403).json({ error: 'Solo quien administra el gimnasio puede hacer esto.' });
      })
      .catch(next);
  };
}
