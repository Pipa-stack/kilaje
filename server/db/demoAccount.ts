/**
 * A fixed account for trying the app out.
 *
 * Registering a new address every time you want to check whether something
 * works is friction that has nothing to do with training, so this keeps one
 * account alive with known credentials, ready to sign in with.
 *
 * It is idempotent and self-healing: if the account is missing it is created,
 * if its password has drifted it is put back, and if it has no program the
 * reference workbook is imported for it. Running it on every boot means a
 * redeploy — or a wiped database — never leaves the demo unusable.
 *
 * It is opt-in (`DEMO_ACCOUNT=true`) and the password comes from the
 * environment or is generated: an account whose credentials are written in a
 * public repository is an open door to whatever it can reach, and this one can
 * reach every ownerless program in the database.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseWorkbook } from '../parser/excelParser';
import { hashSource, importProgram } from '../repositories/programs';
import {
  authenticate,
  claimOrphanPrograms,
  createUser,
  findUserByEmail,
  setPassword,
} from '../repositories/users';
import type { Database } from './database';

/** Used when `DEMO_EMAIL` is not set. */
export const DEFAULT_DEMO_EMAIL = 'demo@kilaje.app';

/**
 * There is deliberately no default password.
 *
 * A constant here would be a live credential published in a public repository:
 * anyone reading the file could sign in, and — because the account adopts every
 * ownerless program — could end up holding somebody's training. A boot-log
 * warning does not close a door.
 *
 * When `DEMO_PASSWORD` is unset the caller generates a random one and prints it
 * once, so the account still works out of the box and the credential exists
 * only in that deployment's log.
 */
export function generateDemoPassword(): string {
  return randomBytes(12).toString('base64url');
}

export interface DemoAccountOptions {
  email?: string;
  /** Required: see {@link generateDemoPassword} for why there is no default. */
  password: string;
  /** Imported for the account when it has no program of its own. */
  workbookPath?: string;
}

export interface DemoAccountResult {
  email: string;
  /** What had to be done, in words, for the boot log. */
  account: 'creada' | 'contraseña restablecida' | 'ya estaba lista';
  program: 'importado' | 'adoptado' | 'ya tenía' | 'sin plantilla que importar';
}

/**
 * Makes sure the demo account exists, its password works, and it has
 * something to train.
 */
export async function seedDemoAccount(
  db: Database,
  { email = DEFAULT_DEMO_EMAIL, password, workbookPath }: DemoAccountOptions,
): Promise<DemoAccountResult> {
  const existing = await findUserByEmail(db, email);

  let account: DemoAccountResult['account'];
  let userId: number;

  if (!existing) {
    userId = (await createUser(db, email, password)).id;
    account = 'creada';
  } else if (await authenticate(db, email, password)) {
    // Already works. Left alone on purpose: `setPassword` revokes every
    // session, and doing that on each boot would sign the tester out of a
    // workout for no reason.
    userId = existing.id;
    account = 'ya estaba lista';
  } else {
    userId = existing.id;
    await setPassword(db, userId, password);
    account = 'contraseña restablecida';
  }

  return { email, account, program: await ensureProgram(db, userId, workbookPath) };
}

async function ensureProgram(
  db: Database,
  userId: number,
  workbookPath: string | undefined,
): Promise<DemoAccountResult['program']> {
  const { rows } = await db.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM programs WHERE user_id = $1',
    [userId],
  );
  if ((rows[0]?.count ?? 0) > 0) return 'ya tenía';

  // Anything seeded before accounts existed is ownerless and invisible;
  // adopting it is cheaper than importing the same file again.
  if ((await claimOrphanPrograms(db, userId)) > 0) return 'adoptado';

  if (!workbookPath) return 'sin plantilla que importar';

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(workbookPath));
  } catch {
    return 'sin plantilla que importar';
  }

  const parsed = parseWorkbook(bytes, 'ejemplo.xlsx');
  await importProgram(db, parsed, hashSource(bytes), userId);
  return 'importado';
}
