import { useEffect, useState } from 'react';

import * as api from '../../api/client';
import type { ClassOccurrence, ClassesWeek } from '../../api/client';
import { addDays, dayName, endTime, gymToday, longDate, longDateTitle } from '../classDates';
import { Icon } from './Icon';

interface HomeClassesProps {
  /** Abre la pestaña de clases, en ese día si se da. */
  onOpenClasses: (date?: string) => void;
}

/** "en 40 min", "en 3 h", o nada si queda más de medio día. */
function soon(startsAtIso: string): string | null {
  const minutes = Math.round((Date.parse(startsAtIso) - Date.now()) / 60_000);
  if (minutes <= 0 || minutes >= 12 * 60) return null;
  if (minutes < 60) return `en ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest >= 15 ? `en ${hours} h ${rest} min` : `en ${hours} h`;
}

function isOpen(c: ClassOccurrence): boolean {
  return !c.cancelled && !c.started;
}

/**
 * Lo del gimnasio, arriba del todo en Inicio: tu próxima clase y lo que
 * queda libre hoy.
 *
 * Como en las apps de socios (Glofox, Mindbody, Virtuagym), lo primero al
 * abrir es lo siguiente que tienes que hacer, no las cifras de la semana. Sin
 * conexión no enseña nada: las plazas cambian, y enseñar unas viejas
 * invitaría a ir a una clase que ya está llena.
 */
export function HomeClasses({ onOpenClasses }: HomeClassesProps) {
  const [week, setWeek] = useState<ClassesWeek | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.fetchClasses().then(
      (found) => {
        if (!cancelled) setWeek(found);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!week) return null;
  const hasTimetable = week.days.some((day) => day.classes.length > 0);
  if (!hasTimetable) return null;

  const today = gymToday();
  const mine = week.days.flatMap((day) => day.classes.filter((c) => c.mine !== null && isOpen(c)));
  const next = mine[0];
  const later = mine.length - 1;

  // Lo que queda con sitio hoy; si hoy ya no queda nada, lo de mañana.
  const withRoom = (date: string) =>
    (week.days.find((day) => day.date === date)?.classes ?? []).filter(
      (c) => isOpen(c) && c.mine === null && c.booked < c.capacity,
    );
  const todayRoom = withRoom(today);
  const roomDate = todayRoom.length > 0 ? today : addDays(today, 1);
  const room = todayRoom.length > 0 ? todayRoom : withRoom(roomDate);

  const feeExpired = week.paidUntil !== null && week.paidUntil < today;
  const feeSoon = !feeExpired && week.paidUntil !== null && week.paidUntil <= addDays(today, 7);

  return (
    <section aria-labelledby="home-classes-title" className="space-y-3">
      <h2 id="home-classes-title" className="eyebrow block px-1">
        Tus clases
      </h2>

      {feeExpired ? (
        <p role="alert" className="rounded-xl border border-effort-500/40 bg-effort-500/10 px-4 py-3 text-sm text-effort-300">
          Tu cuota venció el {longDate(week.paidUntil!)}. Renuévala en recepción para seguir reservando.
        </p>
      ) : feeSoon ? (
        <p className="rounded-xl border border-signal-500/40 bg-signal-500/10 px-4 py-3 text-sm text-iron-100">
          Tu cuota vence el {longDate(week.paidUntil!)}.
        </p>
      ) : null}

      {next ? (
        <button
          type="button"
          onClick={() => onOpenClasses(next.date)}
          className={`flex w-full items-center gap-4 rounded-2xl border px-4 py-4 text-left transition-colors hover:bg-iron-850 ${
            next.mine === 'booked' ? 'border-done-500/50 bg-done-500/10' : 'border-signal-500/40 bg-signal-500/10'
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="eyebrow block">
              Tu próxima clase{soon(next.startsAtIso) ? ` · ${soon(next.startsAtIso)}` : ''}
            </span>
            <span className="mt-0.5 block font-condensed text-2xl font-bold leading-tight text-chalk">
              {dayName(next.date, today)} · {next.startsAt}–{endTime(next.startsAt, next.durationMinutes)}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-iron-300">
              <span>{next.name}</span>
              <span
                className={`flex items-center gap-1 font-semibold ${
                  next.mine === 'booked' ? 'text-done-300' : 'text-signal-300'
                }`}
              >
                {next.mine === 'booked' ? (
                  <>
                    <Icon name="check" size={14} /> Tienes plaza
                  </>
                ) : (
                  `En espera · vas el ${next.waitPosition}º`
                )}
              </span>
            </span>
            {later > 0 ? (
              <span className="mt-1 block text-xs text-iron-400">
                y {later} {later === 1 ? 'reserva más' : 'reservas más'} esta semana
              </span>
            ) : null}
          </span>
          <Icon name="chevronRight" size={22} className="shrink-0 text-iron-400" />
        </button>
      ) : (
        <div className="flex items-center gap-4 rounded-2xl border border-iron-800 bg-iron-900 px-4 py-4">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-chalk">No tienes ninguna clase reservada</span>
            <span className="block text-sm text-iron-400">Se reserva con {week.bookingDays} días de antelación.</span>
          </span>
          <button
            type="button"
            onClick={() => onOpenClasses()}
            className="min-h-11 shrink-0 rounded-xl bg-signal-500 px-4 text-sm font-semibold text-ink hover:bg-signal-400"
          >
            Reservar
          </button>
        </div>
      )}

      {room.length > 0 ? (
        <div>
          <p className="mb-2 px-1 text-sm text-iron-400">
            {roomDate === today ? 'Hoy' : longDateTitle(roomDate)} quedan plazas a las:
          </p>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {room.slice(0, 6).map((c) => {
              const free = c.capacity - c.booked;
              return (
                <li key={c.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenClasses(c.date)}
                    aria-label={`${c.startsAt} ${c.name}: ${free} ${free === 1 ? 'plaza libre' : 'plazas libres'}`}
                    className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-iron-700 bg-iron-900 px-4 hover:border-signal-400"
                  >
                    <span className="figure text-lg font-bold leading-none text-chalk">{c.startsAt}</span>
                    <span className="mt-1 text-xs font-semibold text-iron-300">
                      {free} {free === 1 ? 'libre' : 'libres'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
