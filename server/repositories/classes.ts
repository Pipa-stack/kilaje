/**
 * Clases del gimnasio: el horario semanal y las reservas.
 *
 * Una clase concreta es la pareja (clase del horario, fecha). Quién tiene
 * plaza y quién espera no se guarda: se deduce del orden de llegada, así que
 * la lista de espera avanza sola cuando alguien anula. Ver
 * `migrations/008_classes.sql`.
 *
 * Todas las horas son de pared en {@link GYM_TIME_ZONE}, y "ahora" llega como
 * parámetro en vez de salir de `now()`: así los tests fijan el reloj y las
 * reglas de plazo se prueban sin esperar a que pasen de verdad.
 */

import type { Database } from '../db/database';

/** Donde está el gimnasio. Las 18:00 de una clase son las 18:00 de aquí. */
export const GYM_TIME_ZONE = 'Europe/Madrid';

/** Hoy y los seis días siguientes: lo que se ve y lo que se puede reservar. */
export const BOOKING_DAYS = 7;

/**
 * Hasta dónde mira quien administra: anular un festivo o apuntar a alguien
 * con semanas de margen, sin abrir las reservas de los socios tan lejos.
 */
export const ADMIN_DAYS_AHEAD = 90;

/** Una plaza con sitio se puede soltar hasta una hora antes de empezar. */
export const CANCEL_DEADLINE_MINUTES = 60;

/** Una regla de reserva que no se cumple. Lleva el código HTTP que le toca. */
export class ClassRuleError extends Error {
  readonly status: 403 | 404 | 409;

  constructor(message: string, status: 403 | 404 | 409 = 409) {
    super(message);
    this.name = 'ClassRuleError';
    this.status = status;
  }
}

/** Una clase del horario semanal. */
export interface GymClass {
  id: number;
  name: string;
  coach: string | null;
  /** 1 = lunes … 7 = domingo. */
  weekday: number;
  /** `HH:MM`, hora del gimnasio. */
  startsAt: string;
  durationMinutes: number;
  capacity: number;
}

export type GymClassInput = Omit<GymClass, 'id'>;

export interface Attendee {
  bookingId: number;
  userId: number;
  name: string;
  waiting: boolean;
}

/** Una clase en una fecha, vista por quien pregunta. */
export interface ClassOccurrence extends GymClass {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Instante de inicio, ISO. */
  startsAtIso: string;
  /** Personas con plaza. Nunca más que `capacity`. */
  booked: number;
  /** Personas en lista de espera. */
  waiting: number;
  cancelled: boolean;
  /** Ya ha empezado: no se reserva ni se anula. */
  started: boolean;
  mine: 'booked' | 'waiting' | null;
  /** Puesto en la espera, empezando en 1. Solo si `mine` es `waiting`. */
  waitPosition: number | null;
  /** Se puede soltar la plaza (o salir de la espera) ahora mismo. */
  canCancel: boolean;
  /** Solo para quien administra. */
  attendees?: Attendee[];
}

export interface ClassDay {
  date: string;
  classes: ClassOccurrence[];
}

/** Alguien a quien avisar por correo. */
export interface Recipient {
  email: string;
  name: string;
}

/** Lo que hace falta para contarle a alguien qué clase es. */
export interface OccurrenceLabel {
  name: string;
  date: string;
  startsAt: string;
}

interface ClassRow {
  id: number;
  name: string;
  coach: string | null;
  weekday: number;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
}

// Las columnas se escriben enteras en cada consulta en vez de interpolar una
// constante: la regla de `architecture.test.ts` es que ninguna SQL lleve
// `${}`, y una excepción para "solo constantes" es por donde se cuela la
// primera que no lo es. El nombre que se enseña de alguien es el que eligió,
// o su correo antes de la @.

function toClass(row: ClassRow): GymClass {
  return {
    id: Number(row.id),
    name: row.name,
    coach: row.coach,
    weekday: Number(row.weekday),
    startsAt: row.starts_at,
    durationMinutes: Number(row.duration_minutes),
    capacity: Number(row.capacity),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/* ------------------------------------------------------------------ */
/* Horario                                                             */
/* ------------------------------------------------------------------ */

export async function listSchedule(db: Database): Promise<GymClass[]> {
  const { rows } = await db.query<ClassRow>(
    `SELECT c.id, c.name, c.coach, c.weekday::int AS weekday,
            to_char(c.starts_at, 'HH24:MI') AS starts_at,
            c.duration_minutes::int AS duration_minutes, c.capacity::int AS capacity FROM gym_classes c ORDER BY c.weekday, c.starts_at, c.name`,
  );
  return rows.map(toClass);
}

export async function createClass(db: Database, input: GymClassInput): Promise<GymClass> {
  const { rows } = await db.query<ClassRow>(
    `INSERT INTO gym_classes AS c (name, coach, weekday, starts_at, duration_minutes, capacity)
     VALUES ($1, $2, $3, $4::time, $5, $6)
     RETURNING c.id, c.name, c.coach, c.weekday::int AS weekday,
            to_char(c.starts_at, 'HH24:MI') AS starts_at,
            c.duration_minutes::int AS duration_minutes, c.capacity::int AS capacity`,
    [input.name, input.coach, input.weekday, input.startsAt, input.durationMinutes, input.capacity],
  );
  return toClass(rows[0]!);
}

/**
 * Cambia una clase del horario.
 *
 * Si cambia el día de la semana, las reservas futuras quedan en fechas que ya
 * no tienen esa clase y se borran: dejarlas sería tener gente apuntada a algo
 * que no aparece en ningún sitio. Las pasadas se quedan como historial.
 */
export async function updateClass(
  db: Database,
  classId: number,
  input: GymClassInput,
  now: Date,
): Promise<GymClass> {
  return db.transaction(async (tx) => {
    const { rows: before } = await tx.query<{ weekday: number }>(
      'SELECT weekday::int AS weekday FROM gym_classes WHERE id = $1 FOR UPDATE',
      [classId],
    );
    if (!before[0]) throw new ClassRuleError('Esa clase ya no existe.', 404);

    const { rows } = await tx.query<ClassRow>(
      `UPDATE gym_classes AS c
          SET name = $2, coach = $3, weekday = $4, starts_at = $5::time,
              duration_minutes = $6, capacity = $7
        WHERE c.id = $1
        RETURNING c.id, c.name, c.coach, c.weekday::int AS weekday,
            to_char(c.starts_at, 'HH24:MI') AS starts_at,
            c.duration_minutes::int AS duration_minutes, c.capacity::int AS capacity`,
      [
        classId,
        input.name,
        input.coach,
        input.weekday,
        input.startsAt,
        input.durationMinutes,
        input.capacity,
      ],
    );

    if (Number(before[0].weekday) !== input.weekday) {
      await tx.query(
        `DELETE FROM class_bookings
          WHERE class_id = $1 AND class_date >= ($2::timestamptz AT TIME ZONE $3)::date`,
        [classId, now.toISOString(), GYM_TIME_ZONE],
      );
      await tx.query(
        `DELETE FROM class_cancellations
          WHERE class_id = $1 AND class_date >= ($2::timestamptz AT TIME ZONE $3)::date`,
        [classId, now.toISOString(), GYM_TIME_ZONE],
      );
    }

    return toClass(rows[0]!);
  });
}

export async function deleteClass(db: Database, classId: number): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM gym_classes WHERE id = $1', [classId]);
  if (rowCount === 0) throw new ClassRuleError('Esa clase ya no existe.', 404);
}

/* ------------------------------------------------------------------ */
/* La semana                                                           */
/* ------------------------------------------------------------------ */

/**
 * Las clases de hoy y los próximos días, con el estado de cada una para
 * `userId`. Con `withAttendees`, además, quién va. Con `from`, los siete días
 * a partir de esa fecha en vez de a partir de hoy (solo administración).
 */
export async function listUpcoming(
  db: Database,
  userId: number,
  now: Date,
  { withAttendees = false, from = null }: { withAttendees?: boolean; from?: string | null } = {},
): Promise<ClassDay[]> {
  const params = [now.toISOString(), GYM_TIME_ZONE, BOOKING_DAYS, from];

  // Los días salen de SQL y no de JavaScript por la misma razón que las
  // semanas del perfil: "hoy" depende de la zona horaria, y la del gimnasio
  // no es la del servidor.
  const { rows: dayRows } = await db.query<{ day: string }>(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day
       FROM generate_series(
              COALESCE($4::date, ($1::timestamptz AT TIME ZONE $2)::date),
              COALESCE($4::date, ($1::timestamptz AT TIME ZONE $2)::date) + ($3::int - 1),
              interval '1 day') AS d
      ORDER BY d`,
    params,
  );

  const { rows: occurrences } = await db.query<
    ClassRow & { day: string; starts_instant: Date | string; cancelled: boolean }
  >(
    `WITH days AS (
        SELECT d::date AS day
          FROM generate_series(
                 COALESCE($4::date, ($1::timestamptz AT TIME ZONE $2)::date),
                 COALESCE($4::date, ($1::timestamptz AT TIME ZONE $2)::date) + ($3::int - 1),
                 interval '1 day') AS d
     )
     SELECT c.id, c.name, c.coach, c.weekday::int AS weekday,
            to_char(c.starts_at, 'HH24:MI') AS starts_at,
            c.duration_minutes::int AS duration_minutes, c.capacity::int AS capacity,
            to_char(days.day, 'YYYY-MM-DD')       AS day,
            (days.day + c.starts_at) AT TIME ZONE $2 AS starts_instant,
            (x.class_id IS NOT NULL)              AS cancelled
       FROM days
       JOIN gym_classes c ON c.weekday = EXTRACT(ISODOW FROM days.day)
       LEFT JOIN class_cancellations x ON x.class_id = c.id AND x.class_date = days.day
      ORDER BY days.day, c.starts_at, c.name, c.id`,
    params,
  );

  const { rows: bookings } = await db.query<{
    id: number;
    class_id: number;
    day: string;
    user_id: number;
    name: string;
  }>(
    `SELECT b.id, b.class_id, to_char(b.class_date, 'YYYY-MM-DD') AS day, b.user_id,
            COALESCE(NULLIF(trim(u.display_name), ''), split_part(u.email, '@', 1)) AS name
       FROM class_bookings b
       JOIN users u ON u.id = b.user_id
      WHERE b.class_date BETWEEN COALESCE($4::date, ($1::timestamptz AT TIME ZONE $2)::date)
                             AND COALESCE($4::date, ($1::timestamptz AT TIME ZONE $2)::date) + ($3::int - 1)
      ORDER BY b.id`,
    params,
  );

  const queues = new Map<string, typeof bookings>();
  for (const booking of bookings) {
    const key = `${booking.class_id}|${booking.day}`;
    const queue = queues.get(key) ?? [];
    queue.push(booking);
    queues.set(key, queue);
  }

  const byDay = new Map<string, ClassOccurrence[]>(dayRows.map((row) => [row.day, []]));

  for (const row of occurrences) {
    const gymClass = toClass(row);
    const queue = queues.get(`${gymClass.id}|${row.day}`) ?? [];
    const startsAt = new Date(toIso(row.starts_instant));
    const started = startsAt.getTime() <= now.getTime();
    const index = queue.findIndex((booking) => Number(booking.user_id) === userId);
    const mine = index < 0 ? null : index < gymClass.capacity ? 'booked' : 'waiting';

    byDay.get(row.day)?.push({
      ...gymClass,
      date: row.day,
      startsAtIso: startsAt.toISOString(),
      booked: Math.min(queue.length, gymClass.capacity),
      waiting: Math.max(0, queue.length - gymClass.capacity),
      cancelled: Boolean(row.cancelled),
      started,
      mine,
      waitPosition: mine === 'waiting' ? index - gymClass.capacity + 1 : null,
      canCancel:
        !started &&
        (mine === 'waiting' ||
          (mine === 'booked' && minutesUntil(startsAt, now) >= CANCEL_DEADLINE_MINUTES)),
      ...(withAttendees
        ? {
            attendees: queue.map((booking, position) => ({
              bookingId: Number(booking.id),
              userId: Number(booking.user_id),
              name: booking.name,
              waiting: position >= gymClass.capacity,
            })),
          }
        : {}),
    });
  }

  return [...byDay].map(([date, classes]) => ({ date, classes }));
}

function minutesUntil(when: Date, now: Date): number {
  return (when.getTime() - now.getTime()) / 60_000;
}

/* ------------------------------------------------------------------ */
/* Reservar y anular                                                   */
/* ------------------------------------------------------------------ */

interface LockedOccurrence {
  gymClass: GymClass;
  startsAt: Date;
  cancelled: boolean;
  /** Días desde hoy, en la zona del gimnasio. */
  offset: number;
  /** `false` si esa fecha no cae en el día de la semana de la clase. */
  onWeekday: boolean;
}

/**
 * Bloquea la clase para el resto de la transacción.
 *
 * Todo cambio de reservas de una clase pasa por aquí, así que dos personas
 * anulando y reservando a la vez se ponen en fila en vez de leer cada una una
 * lista que la otra está cambiando.
 */
async function lockOccurrence(
  tx: Database,
  classId: number,
  date: string,
  now: Date,
): Promise<LockedOccurrence> {
  const { rows } = await tx.query<
    ClassRow & {
      starts_instant: Date | string;
      cancelled: boolean;
      offset_days: number;
      on_weekday: boolean;
    }
  >(
    `SELECT c.id, c.name, c.coach, c.weekday::int AS weekday,
            to_char(c.starts_at, 'HH24:MI') AS starts_at,
            c.duration_minutes::int AS duration_minutes, c.capacity::int AS capacity,
            ($2::date + c.starts_at) AT TIME ZONE $4 AS starts_instant,
            EXISTS (SELECT 1 FROM class_cancellations x
                     WHERE x.class_id = c.id AND x.class_date = $2::date) AS cancelled,
            ($2::date - ($3::timestamptz AT TIME ZONE $4)::date)::int AS offset_days,
            (EXTRACT(ISODOW FROM $2::date) = c.weekday) AS on_weekday
       FROM gym_classes c
      WHERE c.id = $1
      FOR UPDATE OF c`,
    [classId, date, now.toISOString(), GYM_TIME_ZONE],
  );

  const row = rows[0];
  if (!row) throw new ClassRuleError('Esa clase ya no existe.', 404);

  return {
    gymClass: toClass(row),
    startsAt: new Date(toIso(row.starts_instant)),
    cancelled: Boolean(row.cancelled),
    offset: Number(row.offset_days),
    onWeekday: Boolean(row.on_weekday),
  };
}

async function queueOf(
  tx: Database,
  classId: number,
  date: string,
): Promise<{ id: number; user_id: number; email: string; name: string }[]> {
  const { rows } = await tx.query<{ id: number; user_id: number; email: string; name: string }>(
    `SELECT b.id, b.user_id, u.email, COALESCE(NULLIF(trim(u.display_name), ''), split_part(u.email, '@', 1)) AS name
       FROM class_bookings b
       JOIN users u ON u.id = b.user_id
      WHERE b.class_id = $1 AND b.class_date = $2::date
      ORDER BY b.id`,
    [classId, date],
  );
  return rows.map((row) => ({ ...row, id: Number(row.id), user_id: Number(row.user_id) }));
}

export interface BookingResult {
  status: 'booked' | 'waiting';
  /** Puesto en la espera, empezando en 1. */
  waitPosition: number | null;
}

/**
 * Apunta a `userId`. Si no queda sitio, a la lista de espera.
 *
 * Volver a pulsar no duplica nada: la reserva ya existe y se devuelve tal
 * cual, con el puesto que tenga.
 */
export async function bookClass(
  db: Database,
  userId: number,
  classId: number,
  date: string,
  now: Date,
  /** Apunta quien administra: puede hacerlo con más antelación. */
  { byAdmin = false }: { byAdmin?: boolean } = {},
): Promise<BookingResult> {
  const window = byAdmin ? ADMIN_DAYS_AHEAD : BOOKING_DAYS;
  return db.transaction(async (tx) => {
    const occurrence = await lockOccurrence(tx, classId, date, now);

    if (!occurrence.onWeekday) throw new ClassRuleError('Esa clase no hay ese día.', 404);
    if (occurrence.offset < 0 || occurrence.startsAt.getTime() <= now.getTime()) {
      throw new ClassRuleError('Esa clase ya ha empezado.');
    }
    if (occurrence.offset >= window) {
      throw new ClassRuleError(`Solo se puede reservar con ${window} días de antelación.`);
    }
    if (occurrence.cancelled) throw new ClassRuleError('Esa clase está anulada.');

    await tx.query(
      `INSERT INTO class_bookings (class_id, class_date, user_id)
       VALUES ($1, $2::date, $3)
       ON CONFLICT (class_id, class_date, user_id) DO NOTHING`,
      [classId, date, userId],
    );

    const queue = await queueOf(tx, classId, date);
    const index = queue.findIndex((booking) => booking.user_id === userId);
    const { capacity } = occurrence.gymClass;
    return index < capacity
      ? { status: 'booked', waitPosition: null }
      : { status: 'waiting', waitPosition: index - capacity + 1 };
  });
}

export interface ReleaseResult {
  /** Quien ha pasado de la espera a tener plaza, para avisarle. */
  promoted: Recipient | null;
  label: OccurrenceLabel;
}

/**
 * Suelta la plaza de `userId`, o lo saca de la espera.
 *
 * Salir de la espera se puede siempre: no le quita nada a nadie. Soltar una
 * plaza solo hasta {@link CANCEL_DEADLINE_MINUTES} antes, que es lo que le da
 * tiempo a quien espera a enterarse y venir.
 */
export async function cancelBooking(
  db: Database,
  userId: number,
  classId: number,
  date: string,
  now: Date,
): Promise<ReleaseResult> {
  return db.transaction(async (tx) => {
    const occurrence = await lockOccurrence(tx, classId, date, now);
    const queue = await queueOf(tx, classId, date);
    const index = queue.findIndex((booking) => booking.user_id === userId);
    const booking = queue[index];
    if (!booking) throw new ClassRuleError('No estás apuntado a esa clase.', 404);

    const { capacity } = occurrence.gymClass;
    const hasPlace = index < capacity;

    if (occurrence.startsAt.getTime() <= now.getTime()) {
      throw new ClassRuleError('Esa clase ya ha empezado.');
    }
    if (hasPlace && minutesUntil(occurrence.startsAt, now) < CANCEL_DEADLINE_MINUTES) {
      throw new ClassRuleError(
        'Falta menos de 1 hora para la clase: ya no se puede anular desde la app.',
      );
    }

    await tx.query('DELETE FROM class_bookings WHERE id = $1', [booking.id]);
    return release(occurrence, queue, index, date);
  });
}

/**
 * Quita una reserva cualquiera. Solo para quien administra, y sin plazo:
 * es quien sabe si alguien ha avisado por otro lado.
 */
export async function removeBooking(
  db: Database,
  bookingId: number,
  now: Date,
): Promise<ReleaseResult> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ class_id: number; day: string }>(
      `SELECT class_id, to_char(class_date, 'YYYY-MM-DD') AS day
         FROM class_bookings WHERE id = $1`,
      [bookingId],
    );
    const found = rows[0];
    if (!found) throw new ClassRuleError('Esa reserva ya no existe.', 404);

    const classId = Number(found.class_id);
    const occurrence = await lockOccurrence(tx, classId, found.day, now);
    const queue = await queueOf(tx, classId, found.day);
    const index = queue.findIndex((booking) => booking.id === bookingId);
    // Otra petición la ha borrado entre la lectura y el bloqueo.
    if (index < 0) throw new ClassRuleError('Esa reserva ya no existe.', 404);

    await tx.query('DELETE FROM class_bookings WHERE id = $1', [bookingId]);
    return release(occurrence, queue, index, found.day);
  });
}

/**
 * Quién sube al quitar el puesto `index` de la cola.
 *
 * Solo sube alguien si el que se va tenía plaza y había espera; el primero de
 * la espera es el que estaba justo detrás de la última plaza.
 */
function release(
  occurrence: LockedOccurrence,
  queue: { email: string; name: string }[],
  index: number,
  date: string,
): ReleaseResult {
  const { capacity, name, startsAt } = occurrence.gymClass;
  const next = index < capacity ? queue[capacity] : undefined;
  return {
    promoted: next ? { email: next.email, name: next.name } : null,
    label: { name, date, startsAt },
  };
}

/* ------------------------------------------------------------------ */
/* Anular una fecha                                                    */
/* ------------------------------------------------------------------ */

export interface CancellationResult {
  /** Quienes estaban apuntados, con plaza o en espera. */
  affected: Recipient[];
  label: OccurrenceLabel;
}

/**
 * Anula la clase de una fecha (un festivo, el monitor enfermo).
 *
 * Las reservas no se borran: si se recupera la clase, cada uno sigue donde
 * estaba.
 */
export async function cancelOccurrence(
  db: Database,
  classId: number,
  date: string,
  now: Date,
): Promise<CancellationResult> {
  return db.transaction(async (tx) => {
    const occurrence = await lockOccurrence(tx, classId, date, now);
    if (!occurrence.onWeekday) throw new ClassRuleError('Esa clase no hay ese día.', 404);
    if (occurrence.startsAt.getTime() <= now.getTime()) {
      throw new ClassRuleError('Esa clase ya ha empezado.');
    }

    const { rowCount } = await tx.query(
      `INSERT INTO class_cancellations (class_id, class_date) VALUES ($1, $2::date)
       ON CONFLICT DO NOTHING`,
      [classId, date],
    );

    // Solo se avisa la primera vez: pulsar dos veces no manda dos correos.
    const affected =
      rowCount > 0
        ? (await queueOf(tx, classId, date)).map(({ email, name }) => ({ email, name }))
        : [];

    return {
      affected,
      label: { name: occurrence.gymClass.name, date, startsAt: occurrence.gymClass.startsAt },
    };
  });
}

export async function restoreOccurrence(
  db: Database,
  classId: number,
  date: string,
): Promise<void> {
  await db.query('DELETE FROM class_cancellations WHERE class_id = $1 AND class_date = $2::date', [
    classId,
    date,
  ]);
}

/* ------------------------------------------------------------------ */
/* Anular un día entero                                                */
/* ------------------------------------------------------------------ */

export interface DayCancellationResult {
  /** Clases que se han anulado ahora (no cuenta las que ya lo estaban). */
  cancelled: number;
  /** Cada persona apuntada a alguna de ellas, con la clase que era. */
  affected: (Recipient & { label: OccurrenceLabel })[];
}

/**
 * Anula todas las clases de una fecha que aún no han empezado: un festivo,
 * un cierre. Como con una sola clase, las reservas se conservan por si se
 * recupera el día.
 */
export async function cancelDay(
  db: Database,
  date: string,
  now: Date,
): Promise<DayCancellationResult> {
  return db.transaction(async (tx) => {
    const { rows: inserted } = await tx.query<{ class_id: number }>(
      `INSERT INTO class_cancellations (class_id, class_date)
       SELECT c.id, $1::date
         FROM gym_classes c
        WHERE c.weekday = EXTRACT(ISODOW FROM $1::date)
          AND ($1::date + c.starts_at) AT TIME ZONE $3 > $2::timestamptz
       ON CONFLICT DO NOTHING
       RETURNING class_id`,
      [date, now.toISOString(), GYM_TIME_ZONE],
    );

    const ids = inserted.map((row) => Number(row.class_id));
    if (ids.length === 0) return { cancelled: 0, affected: [] };

    const { rows } = await tx.query<{
      email: string;
      name: string;
      class_name: string;
      starts_at: string;
    }>(
      `SELECT u.email, COALESCE(NULLIF(trim(u.display_name), ''), split_part(u.email, '@', 1)) AS name,
              c.name AS class_name, to_char(c.starts_at, 'HH24:MI') AS starts_at
         FROM class_bookings b
         JOIN users u       ON u.id = b.user_id
         JOIN gym_classes c ON c.id = b.class_id
        WHERE b.class_date = $1::date AND b.class_id = ANY($2::bigint[])
        ORDER BY c.starts_at, b.id`,
      [date, ids],
    );

    return {
      cancelled: ids.length,
      affected: rows.map((row) => ({
        email: row.email,
        name: row.name,
        label: { name: row.class_name, date, startsAt: row.starts_at },
      })),
    };
  });
}

/** Recupera todas las clases anuladas de una fecha. */
export async function restoreDay(db: Database, date: string): Promise<number> {
  const { rowCount } = await db.query('DELETE FROM class_cancellations WHERE class_date = $1::date', [
    date,
  ]);
  return rowCount;
}
