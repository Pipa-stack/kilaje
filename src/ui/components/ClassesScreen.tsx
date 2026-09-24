import { useCallback, useEffect, useState } from 'react';

import * as api from '../../api/client';
import { ApiError, type ClassOccurrence, type ClassesWeek } from '../../api/client';
import { Icon } from './Icon';

interface ClassesScreenProps {
  offline: boolean;
}

const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const WEEKDAY_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/**
 * `"2026-10-01"` → día de la semana, 0 = domingo.
 *
 * A mediodía UTC para que ninguna zona horaria lo empuje al día de al lado.
 */
function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, 12)).getUTCDay();
}

function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}

/** "Hoy", "Mañana" o "jueves 1": cómo se nombra un día de la lista. */
function dayName(date: string, index: number): string {
  if (index === 0) return 'Hoy';
  if (index === 1) return 'Mañana';
  const name = WEEKDAY_LONG[weekdayOf(date)]!;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${dayNumber(date)}`;
}

/**
 * Reservar clases del gimnasio.
 *
 * Tres toques como mucho: el día, la clase, "Reservar". Lo que importa de
 * cada clase — a qué hora, cuántas plazas quedan y si tú vas — se lee sin
 * abrir nada, y el estado siempre lo dice una palabra, no solo un color.
 *
 * No funciona sin conexión, y lo dice: una reserva que se queda en la cola
 * del móvil no es una plaza, y enseñarla como hecha sería mentir.
 */
export function ClassesScreen({ offline }: ClassesScreenProps) {
  const [week, setWeek] = useState<ClassesWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.fetchClasses();
      setWeek(next);
      setError(null);
      // El día elegido se conserva mientras siga en la lista; a medianoche
      // "hoy" cambia y el primero de ayer desaparece.
      setSelected((current) =>
        current && next.days.some((day) => day.date === current) ? current : (next.days[0]?.date ?? null),
      );
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.isOffline
          ? 'Sin conexión: las clases se ven y se reservan solo con conexión.'
          : cause instanceof Error
            ? cause.message
            : 'No se han podido cargar las clases.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Las plazas cambian mientras la app está en segundo plano. Al volver,
    // se vuelve a preguntar, para no ofrecer una plaza que ya no existe.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  /**
   * Ejecuta una acción, vuelve a cargar y enseña lo que ha pasado.
   * Devuelve si salió bien, para que un formulario sepa si cerrarse.
   */
  const act = async (key: string, work: () => Promise<string | null>): Promise<boolean> => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const message = await work();
      await load();
      setNotice(message);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se ha podido completar la operación.');
      // Lo que falló puede ser que la clase ya estuviera llena: se recarga
      // para que la pantalla diga cómo está de verdad.
      await load();
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <p role="status" className="py-12 text-center text-iron-400">
        Cargando clases…
      </p>
    );
  }

  const days = week?.days ?? [];
  const day = days.find((candidate) => candidate.date === selected) ?? days[0];
  const upcoming = days.flatMap((candidate) =>
    candidate.classes.filter((c) => c.mine !== null && !c.started && !c.cancelled),
  );
  const nothingScheduled = days.every((candidate) => candidate.classes.length === 0);
  const disabled = offline || busy !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-chalk">Clases</h2>
      </div>

      <div role="status" aria-live="polite" className="space-y-2">
        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-effort-500/40 bg-effort-500/10 px-4 py-3 text-sm text-effort-300">
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="rounded-lg px-2 py-1 font-semibold text-chalk hover:bg-effort-500/20"
            >
              Cerrar
            </button>
          </div>
        ) : null}
        {notice ? (
          <p className="rounded-xl border border-done-500/40 bg-done-500/10 px-4 py-3 text-sm font-semibold text-done-300">
            {notice}
          </p>
        ) : null}
      </div>

      {week ? (
        <>
          {upcoming.length > 0 ? (
            <section aria-labelledby="my-classes-title">
              <h3 id="my-classes-title" className="eyebrow mb-2 block px-1">
                Tus reservas
              </h3>
              <ul className="space-y-2">
                {upcoming.map((c) => {
                  const index = days.findIndex((candidate) => candidate.date === c.date);
                  return (
                    <li key={`${c.id}|${c.date}`}>
                      <button
                        type="button"
                        onClick={() => setSelected(c.date)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-iron-700 bg-iron-900 px-4 py-3 text-left hover:bg-iron-850"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-chalk">
                            {c.name}
                          </span>
                          <span className="block text-xs text-iron-400">
                            {dayName(c.date, index)} · {c.startsAt}
                          </span>
                        </span>
                        <StatusChip occurrence={c} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <nav aria-label="Días">
            <ul className="grid grid-cols-7 gap-1.5">
              {days.map((candidate, index) => {
                const active = candidate.date === day?.date;
                const mineThatDay = candidate.classes.some(
                  (c) => c.mine !== null && !c.cancelled,
                );
                return (
                  <li key={candidate.date}>
                    <button
                      type="button"
                      onClick={() => setSelected(candidate.date)}
                      aria-current={active ? 'date' : undefined}
                      aria-label={`${dayName(candidate.date, index)}: ${candidate.classes.length} ${
                        candidate.classes.length === 1 ? 'clase' : 'clases'
                      }${mineThatDay ? ', tienes reserva' : ''}`}
                      className={`flex min-h-16 w-full flex-col items-center justify-center rounded-xl px-0.5 transition-colors ${
                        active
                          ? 'bg-signal-500 text-iron-950'
                          : 'bg-iron-900 text-iron-400 hover:bg-iron-850'
                      }`}
                    >
                      <span className="text-[11px] font-semibold uppercase">
                        {index === 0 ? 'Hoy' : WEEKDAY_SHORT[weekdayOf(candidate.date)]}
                      </span>
                      <span className="figure text-xl font-bold leading-tight">
                        {dayNumber(candidate.date)}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`size-1.5 rounded-full ${
                          mineThatDay ? (active ? 'bg-iron-950' : 'bg-done-500') : 'bg-transparent'
                        }`}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {day ? (
            <section aria-labelledby="day-classes-title" className="space-y-2">
              <h3 id="day-classes-title" className="eyebrow block px-1">
                {dayName(day.date, days.indexOf(day))}
              </h3>

              {nothingScheduled ? (
                <p className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-6 text-center text-sm text-iron-400">
                  Todavía no hay clases en el horario.
                </p>
              ) : day.classes.length === 0 ? (
                <p className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-6 text-center text-sm text-iron-400">
                  No hay clases este día.
                </p>
              ) : (
                <ul className="space-y-2">
                  {day.classes.map((c) => (
                    <li key={c.id}>
                      <ClassCard
                        occurrence={c}
                        busy={busy}
                        disabled={disabled}
                        onBook={() =>
                          void act(`${c.id}|${c.date}`, async () => {
                            const result = await api.bookClass(c.id, c.date);
                            return result.status === 'booked'
                              ? `Reservado: ${c.name}, ${c.startsAt}.`
                              : `Estás en la lista de espera (vas el ${result.waitPosition}º). Si se libera una plaza entras solo y te llega un correo.`;
                          })
                        }
                        onCancel={() =>
                          void act(`${c.id}|${c.date}`, async () => {
                            await api.cancelClassBooking(c.id, c.date);
                            return c.mine === 'waiting'
                              ? 'Has salido de la lista de espera.'
                              : 'Plaza anulada.';
                          })
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <p className="px-1 text-xs text-iron-400">
            Se reserva con {week.bookingDays} días de antelación y se puede anular hasta{' '}
            {week.cancelDeadlineMinutes === 60 ? '1 hora' : `${week.cancelDeadlineMinutes} minutos`}{' '}
            antes. Si una clase está completa te apuntas a la espera: cuando alguien anula entras
            solo, por orden, y te llega un correo.
          </p>
        </>
      ) : null}
    </div>
  );
}

function StatusChip({ occurrence: c }: { occurrence: ClassOccurrence }) {
  const [label, tone] = c.cancelled
    ? ['Anulada', 'bg-iron-800 text-iron-400']
    : c.mine === 'booked'
      ? ['Tienes plaza', 'bg-done-500/15 text-done-300']
      : c.mine === 'waiting'
        ? [`En espera · ${c.waitPosition}º`, 'bg-signal-500/15 text-signal-300']
        : c.started
          ? ['Empezada', 'bg-iron-800 text-iron-400']
          : c.booked >= c.capacity
            ? ['Completa', 'bg-iron-800 text-iron-300']
            : [
                `${c.capacity - c.booked} ${c.capacity - c.booked === 1 ? 'libre' : 'libres'}`,
                'bg-iron-800 text-iron-300',
              ];

  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}
    >
      {c.mine === 'booked' && !c.cancelled ? <Icon name="check" size={12} /> : null}
      {label}
    </span>
  );
}

interface ClassCardProps {
  occurrence: ClassOccurrence;
  busy: string | null;
  disabled: boolean;
  onBook: () => void;
  onCancel: () => void;
}

function ClassCard({
  occurrence: c,
  busy,
  disabled,
  onBook,
  onCancel,
}: ClassCardProps) {
  const full = c.booked >= c.capacity;
  const working = busy === `${c.id}|${c.date}`;
  const titleId = `class-${c.id}-${c.date}`;
  const open = !c.cancelled && !c.started;

  return (
    <article
      aria-labelledby={titleId}
      className={`rounded-2xl border bg-iron-900 p-4 ${
        c.mine === 'booked' && open ? 'border-done-500/50' : 'border-iron-800'
      } ${c.cancelled || c.started ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-3">
        <span className="figure w-16 shrink-0 text-2xl font-bold leading-none text-chalk">
          {c.startsAt}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h4 id={titleId} className="font-semibold text-chalk">
              <span className="sr-only">{c.startsAt} </span>
              {c.name}
            </h4>
            <StatusChip occurrence={c} />
          </div>
          <p className="mt-0.5 text-xs text-iron-400">
            {c.durationMinutes} min{c.coach ? ` · con ${c.coach}` : ''}
          </p>
        </div>
      </div>

      {!c.cancelled ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-iron-400">
            <span>
              {c.booked} de {c.capacity} plazas
            </span>
            {c.waiting > 0 ? <span>{c.waiting} en espera</span> : null}
          </div>
          <div
            role="progressbar"
            aria-valuenow={c.booked}
            aria-valuemin={0}
            aria-valuemax={c.capacity}
            aria-label={`Plazas ocupadas en ${c.name}`}
            className="h-1.5 overflow-hidden rounded-full bg-iron-800"
          >
            <div
              className={`h-full rounded-full ${full ? 'bg-iron-400' : 'bg-signal-500'}`}
              style={{ width: `${(c.booked / c.capacity) * 100}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-iron-400">Esta clase no se da este día.</p>
      )}

      {open ? (
        <div className="mt-3">
          {c.mine === null ? (
            <button
              type="button"
              onClick={onBook}
              disabled={disabled}
              className={`flex min-h-12 w-full items-center justify-center rounded-xl px-4 font-semibold transition-colors disabled:opacity-40 ${
                full
                  ? 'border border-iron-700 text-iron-100 hover:bg-iron-850'
                  : 'bg-signal-500 text-iron-950 hover:bg-signal-400'
              }`}
            >
              {working ? 'Un momento…' : full ? 'Apuntarme a la lista de espera' : 'Reservar'}
            </button>
          ) : c.canCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={disabled}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-iron-700 px-4 font-semibold text-iron-100 transition-colors hover:bg-iron-850 disabled:opacity-40"
            >
              {working
                ? 'Un momento…'
                : c.mine === 'waiting'
                  ? 'Salir de la lista de espera'
                  : 'Anular mi plaza'}
            </button>
          ) : (
            <p className="text-sm text-iron-400">
              Falta menos de 1 hora: ya no se puede anular desde la app. Si no puedes venir, avisa
              en el gimnasio.
            </p>
          )}
        </div>
      ) : null}

    </article>
  );
}
