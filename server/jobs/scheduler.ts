/**
 * Tareas que el servidor hace solo.
 *
 * - **Copia de seguridad semanal** al correo de los propietarios, con socios,
 *   cuotas, horario, reservas y avisos. Es lo único que protege esos datos:
 *   el Excel de entrenamiento no los lleva, y las copias de Railway cuestan.
 * - **Aviso de cuota** a quien le vence en los próximos días.
 *
 * Sin cron ni servicio aparte, que costarían dinero: un temporizador dentro
 * del mismo proceso que mira cada cuarto de hora si toca algo. Lo que ya se
 * hizo se apunta en la base (`job_runs`, `fee_reminded_for`), así que un
 * reinicio o un despliegue no repite nada, y si el servidor estuvo caído a la
 * hora de siempre, la tarea se hace en cuanto vuelve.
 */

import type { Database } from '../db/database';
import type { EmailSender } from '../email/sender';
import { buildBackupEmail, buildFeeReminderEmail } from '../email/jobEmails';
import { buildBackupWorkbook } from '../parser/backupExporter';
import {
  dueFeeReminders,
  lastJobRun,
  loadBackupData,
  markFeeReminded,
  recordJobRun,
} from '../repositories/backup';
import { GYM_TIME_ZONE } from '../repositories/classes';

export interface JobContext {
  db: Database;
  email: EmailSender;
  /** Propietarios (`ADMIN_EMAILS`): reciben la copia de seguridad. */
  owners: readonly string[];
  appUrl: string;
}

/** Cada cuánto se mira si toca algo. */
const TICK_MS = 15 * 60 * 1000;
/** La copia sale a partir de esta hora, una vez por semana. */
const BACKUP_HOUR = 7;
const BACKUP_EVERY_DAYS = 7;
/** Los avisos de cuota, a partir de esta hora, una vez al día. */
const REMINDER_HOUR = 9;
/** Con cuántos días de antelación se avisa de que vence la cuota. */
export const FEE_REMINDER_DAYS = 3;

/** Fecha y hora en el gimnasio. */
function gymClock(now: Date): { date: string; hour: number } {
  const date = now.toLocaleDateString('sv-SE', { timeZone: GYM_TIME_ZONE });
  const hour = Number(
    now.toLocaleTimeString('en-GB', { timeZone: GYM_TIME_ZONE, hour: '2-digit', hour12: false }),
  );
  return { date, hour };
}

/** Manda la copia a cada propietario. Devuelve a cuántos se ha enviado. */
export async function runBackup({ db, email, owners }: JobContext, now: Date): Promise<number> {
  const data = await loadBackupData(db);
  const { date } = gymClock(now);
  const file = {
    name: `kilaje-copia-${date}.xlsx`,
    content: Buffer.from(buildBackupWorkbook(data)),
  };
  let sent = 0;
  for (const owner of owners) {
    const ok = await email.send(
      buildBackupEmail(owner, date, file, { members: data.members.length, bookings: data.bookings.length }),
    );
    if (ok) sent += 1;
  }
  return sent;
}

/** Avisa a quien le vence la cuota pronto. Devuelve a cuántos. */
export async function runFeeReminders({ db, email, appUrl }: JobContext, now: Date): Promise<number> {
  const { date } = gymClock(now);
  let sent = 0;
  for (const member of await dueFeeReminders(db, date, FEE_REMINDER_DAYS)) {
    // Se marca solo si salió: si el proveedor falla, se reintenta mañana.
    if (await email.send(buildFeeReminderEmail(member.email, member.paidUntil, appUrl))) {
      await markFeeReminded(db, member.id, member.paidUntil);
      sent += 1;
    }
  }
  return sent;
}

/** Mira si toca algo y lo hace. Separado del temporizador para probarlo. */
export async function tick(context: JobContext, now: Date): Promise<string[]> {
  const done: string[] = [];
  const { date, hour } = gymClock(now);

  if (context.owners.length > 0 && hour >= BACKUP_HOUR) {
    const last = await lastJobRun(context.db, 'backup');
    const due = !last || now.getTime() - last.getTime() >= (BACKUP_EVERY_DAYS - 0.5) * 86_400_000;
    if (due && (await runBackup(context, now)) > 0) {
      await recordJobRun(context.db, 'backup', now);
      done.push('backup');
    }
  }

  if (hour >= REMINDER_HOUR) {
    const last = await lastJobRun(context.db, 'fee-reminders');
    if (!last || gymClock(last).date < date) {
      const sent = await runFeeReminders(context, now);
      await recordJobRun(context.db, 'fee-reminders', now);
      done.push(`fee-reminders:${sent}`);
    }
  }

  return done;
}

/** Arranca el temporizador. Sin correo configurado no hay nada que hacer. */
export function startJobs(context: JobContext): () => void {
  if (!context.email.configured) {
    console.warn('[jobs] sin correo configurado: no habrá copia de seguridad ni avisos de cuota');
    return () => undefined;
  }

  const run = () => {
    tick(context, new Date())
      .then((done) => {
        if (done.length > 0) console.log(`[jobs] hecho: ${done.join(', ')}`);
      })
      .catch((error: unknown) => console.error('[jobs] ha fallado una tarea:', error));
  };

  // Un minuto después de arrancar, para no competir con el primer tráfico.
  const first = setTimeout(run, 60_000);
  const every = setInterval(run, TICK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
