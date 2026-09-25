import { useCallback, useEffect, useRef, useState } from 'react';

import * as api from '../../api/client';
import { ApiError, type ClassHistoryItem, type ClassOccurrence, type ClassesWeek } from '../../api/client';
import {
  addDays,
  longDate,
  dayName,
  dayNumber,
  endTime,
  gymToday,
  longDateTitle,
  monthOf,
  monthTitle,
  monthWeeks,
  shiftMonth,
} from '../classDates';
import { Icon } from './Icon';

interface ClassesScreenProps {
  offline: boolean;
}

const WEEKDAY_HEADERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const WEEKDAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** Plazas que quedan en un día, entre las clases que aún se pueden reservar. */
function freePlaces(classes: ClassOccurrence[]): number {
  return classes
    .filter((c) => !c.cancelled && !c.started)
    .reduce((sum, c) => sum + Math.max(0, c.capacity - c.booked), 0);
}

/**
 * Reservar clases del gimnasio, en forma de calendario.
 *
 * Como el calendario de pared que todo el mundo sabe leer: se toca el día y
 * se despliega debajo con sus horas y los huecos libres de cada una; se toca
 * una hora y aparece el botón. El estado lo dice siempre una palabra —
 * «2 libres», «Completa», «Tu plaza» — y no solo un color.
 *
 * No funciona sin conexión, y lo dice: una reserva que se queda en la cola
 * del móvil no es una plaza, y enseñarla como hecha sería mentir.
 */
export function ClassesScreen({ offline }: ClassesScreenProps) {
  const today = gymToday();
  const [week, setWeek] = useState<ClassesWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [month, setMonth] = useState(monthOf(today));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    try {
      setWeek(await api.fetchClasses());
      setError(null);
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

  // Al abrir un día, el desplegable se trae a la vista: en un móvil queda
  // debajo del calendario, fuera de la pantalla.
  useEffect(() => {
    if (selectedDay) panel.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [selectedDay]);

  /** Ejecuta una acción, vuelve a cargar y enseña lo que ha pasado. */
  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await work();
      await load();
      setNotice(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se ha podido completar la operación.');
      // Lo que falló puede ser que la clase ya estuviera llena: se recarga
      // para que la pantalla diga cómo está de verdad.
      await load();
    } finally {
      setBusy(false);
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
  const byDate = new Map(days.map((day) => [day.date, day.classes]));
  const bookable = days.map((day) => day.date);
  const firstMonth = monthOf(bookable[0] ?? today);
  const lastMonth = monthOf(bookable.at(-1) ?? today);
  const upcoming = days.flatMap((day) =>
    day.classes.filter((c) => c.mine !== null && !c.started && !c.cancelled),
  );
  const nothingScheduled = days.every((day) => day.classes.length === 0);
  const disabled = offline || busy;

  const dayClasses = selectedDay ? (byDate.get(selectedDay) ?? []) : [];
  const occurrence = dayClasses.find((c) => c.id === selectedClass);

  const openDay = (date: string) => {
    setSelectedDay((current) => (current === date ? null : date));
    setSelectedClass(null);
    setNotice(null);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-chalk">Clases</h2>

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

      {week?.paidUntil && week.paidUntil < today ? (
        <p role="alert" className="rounded-xl border border-effort-500/40 bg-effort-500/10 px-4 py-3 text-sm text-effort-300">
          Tu cuota venció el {longDate(week.paidUntil)}. Renuévala en recepción para seguir reservando.
        </p>
      ) : week?.paidUntil && week.paidUntil <= addDays(today, 7) ? (
        <p className="rounded-xl border border-signal-500/40 bg-signal-500/10 px-4 py-3 text-sm text-iron-100">
          Tu cuota vence el {longDate(week.paidUntil)}. Después de esa fecha no podrás reservar hasta renovarla.
        </p>
      ) : null}

      {upcoming.length > 0 ? (
        <section aria-labelledby="my-classes-title">
          <h3 id="my-classes-title" className="eyebrow mb-2 block px-1">
            Tus reservas
          </h3>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {upcoming.map((c) => (
              <li key={`${c.id}|${c.date}`} className="shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setMonth(monthOf(c.date));
                    setSelectedDay(c.date);
                    setSelectedClass(c.id);
                  }}
                  className={`rounded-2xl border px-3 py-2 text-left hover:bg-iron-850 ${
                    c.mine === 'booked' ? 'border-done-500/50 bg-done-500/10' : 'border-signal-500/40 bg-signal-500/10'
                  }`}
                >
                  <span className="block text-xs font-semibold text-iron-400">{dayName(c.date, today)}</span>
                  <span className="figure block text-lg font-bold leading-tight text-chalk">{c.startsAt}</span>
                  <span className="block text-xs font-semibold text-iron-300">
                    {c.mine === 'booked' ? 'Tu plaza' : `En espera · ${c.waitPosition}º`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {nothingScheduled ? (
        <p className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-6 text-center text-sm text-iron-400">
          Todavía no hay clases en el horario.
        </p>
      ) : (
        <section aria-labelledby="calendar-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-3">
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMonth((current) => shiftMonth(current, -1))}
              disabled={month <= firstMonth}
              aria-label="Mes anterior"
              className="flex size-10 items-center justify-center rounded-xl text-iron-400 hover:bg-iron-850 disabled:invisible"
            >
              <Icon name="chevronRight" size={18} className="rotate-180" />
            </button>
            <h3 id="calendar-title" className="flex-1 text-center font-semibold text-chalk">
              {monthTitle(month).charAt(0).toUpperCase() + monthTitle(month).slice(1)}
            </h3>
            <button
              type="button"
              onClick={() => setMonth((current) => shiftMonth(current, 1))}
              disabled={month >= lastMonth}
              aria-label="Mes siguiente"
              className="flex size-10 items-center justify-center rounded-xl text-iron-400 hover:bg-iron-850 disabled:invisible"
            >
              <Icon name="chevronRight" size={18} />
            </button>
          </div>

          <table className="w-full table-fixed border-separate border-spacing-1">
            <thead>
              <tr>
                {WEEKDAY_HEADERS.map((letter, index) => (
                  <th key={letter + index} scope="col" className="text-xs font-semibold text-iron-400">
                    <abbr title={WEEKDAY_NAMES[index]} className="no-underline">
                      {letter}
                    </abbr>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthWeeks(month).map((weekCells, row) => (
                <tr key={row}>
                  {weekCells.map((date, column) => (
                    <td key={date ?? `empty-${row}-${column}`} className="p-0">
                      {date ? (
                        <CalendarDay
                          date={date}
                          today={today}
                          classes={byDate.get(date)}
                          selected={date === selectedDay}
                          onSelect={() => openDay(date)}
                        />
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-iron-400">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-full bg-done-500" /> Hay plazas
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-full bg-iron-600" /> Todo completo
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="flex size-4 items-center justify-center rounded-full bg-done-500 text-white">
                <Icon name="check" size={10} />
              </span>
              Tienes reserva
            </span>
          </p>
        </section>
      )}

      {selectedDay && byDate.has(selectedDay) ? (
        <section
          ref={panel}
          aria-labelledby="day-panel-title"
          className="space-y-3 rounded-2xl border border-signal-500/40 bg-iron-900 p-4"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h3 id="day-panel-title" className="font-semibold text-chalk">
              {longDateTitle(selectedDay)}
            </h3>
            <button
              type="button"
              onClick={() => openDay(selectedDay)}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-iron-400 hover:bg-iron-850"
            >
              Cerrar
            </button>
          </div>

          {dayClasses.length === 0 ? (
            <p className="text-sm text-iron-400">No hay clases este día.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2" aria-label="Horas del día">
              {dayClasses.map((c) => (
                <li key={c.id}>
                  <SlotButton
                    occurrence={c}
                    selected={c.id === selectedClass}
                    onSelect={() => {
                      setSelectedClass((current) => (current === c.id ? null : c.id));
                      setNotice(null);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}

          {occurrence ? (
            <SlotDetail
              occurrence={occurrence}
              disabled={disabled}
              busy={busy}
              cancelDeadlineMinutes={week?.cancelDeadlineMinutes ?? 60}
              onBook={() =>
                void act(async () => {
                  const result = await api.bookClass(occurrence.id, occurrence.date);
                  return result.status === 'booked'
                    ? `Reservado: ${occurrence.name}, ${dayName(occurrence.date, today).toLowerCase()} a las ${occurrence.startsAt}.`
                    : `Estás en la lista de espera (vas el ${result.waitPosition}º). Si se libera una plaza entras solo y te llega un correo.`;
                })
              }
              onCancel={() =>
                void act(async () => {
                  await api.cancelClassBooking(occurrence.id, occurrence.date);
                  return occurrence.mine === 'waiting' ? 'Has salido de la lista de espera.' : 'Plaza anulada.';
                })
              }
            />
          ) : dayClasses.length > 0 ? (
            <p className="text-center text-sm text-iron-400">Toca una hora para reservar.</p>
          ) : null}
        </section>
      ) : null}

      <History today={today} />

      {week ? (
        <p className="px-1 text-xs text-iron-400">
          Se reserva con {week.bookingDays} días de antelación y se puede anular hasta{' '}
          {week.cancelDeadlineMinutes === 60 ? '1 hora' : `${week.cancelDeadlineMinutes} minutos`} antes. Si
          una hora está completa te apuntas a la espera: cuando alguien anula entras solo, por orden, y te
          llega un correo.
        </p>
      ) : null}
    </div>
  );
}

interface CalendarDayProps {
  date: string;
  today: string;
  /** Solo los días que se pueden reservar traen clases. */
  classes: ClassOccurrence[] | undefined;
  selected: boolean;
  onSelect: () => void;
}

function CalendarDay({ date, today, classes, selected, onSelect }: CalendarDayProps) {
  const number = dayNumber(date);
  const isToday = date === today;

  // Fuera de los días que se pueden reservar: el número, apagado, y nada más.
  if (!classes) {
    return (
      <span
        className={`flex h-12 items-center justify-center rounded-xl text-sm ${
          isToday ? 'font-bold text-iron-100' : 'text-iron-600'
        }`}
      >
        {number}
      </span>
    );
  }

  const free = freePlaces(classes);
  const open = classes.filter((c) => !c.cancelled && !c.started);
  const mine = classes.some((c) => c.mine !== null && !c.cancelled && !c.started);
  const state =
    classes.length === 0
      ? 'sin clases'
      : open.length === 0
        ? 'ya no quedan clases'
        : free > 0
          ? `${free} ${free === 1 ? 'plaza libre' : 'plazas libres'}`
          : 'todo completo';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${dayName(date, today)}: ${state}${mine ? ', tienes reserva' : ''}`}
      className={`relative flex h-12 w-full flex-col items-center justify-center rounded-xl transition-colors ${
        selected
          ? 'bg-signal-500 text-ink'
          : isToday
            ? 'border border-signal-500/60 bg-iron-850 text-chalk hover:bg-iron-800'
            : 'bg-iron-850 text-chalk hover:bg-iron-800'
      }`}
    >
      <span className="figure text-base font-bold leading-none">{number}</span>
      <span className="mt-1 flex h-2 items-center gap-0.5" aria-hidden="true">
        {open.length > 0 ? (
          <span
            className={`size-1.5 rounded-full ${
              free > 0 ? (selected ? 'bg-ink' : 'bg-done-500') : selected ? 'bg-ink/50' : 'bg-iron-600'
            }`}
          />
        ) : null}
      </span>
      {mine ? (
        <span
          aria-hidden="true"
          className={`absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full ${
            selected ? 'bg-ink text-signal-400' : 'bg-done-500 text-white'
          }`}
        >
          <Icon name="check" size={10} />
        </span>
      ) : null}
    </button>
  );
}

function slotLabel(c: ClassOccurrence): string {
  if (c.cancelled) return 'Anulada';
  if (c.mine === 'booked') return 'Tu plaza';
  if (c.mine === 'waiting') return `Espera ${c.waitPosition}º`;
  if (c.started) return 'Pasada';
  const free = c.capacity - c.booked;
  return free > 0 ? `${free} ${free === 1 ? 'libre' : 'libres'}` : 'Completa';
}

function SlotButton({
  occurrence: c,
  selected,
  onSelect,
}: {
  occurrence: ClassOccurrence;
  selected: boolean;
  onSelect: () => void;
}) {
  const closed = c.cancelled || (c.started && c.mine === null);
  const full = c.booked >= c.capacity;
  const tone = selected
    ? 'border-signal-500 bg-signal-500 text-ink'
    : c.mine === 'booked'
      ? 'border-done-500/60 bg-done-500/15 text-chalk'
      : c.mine === 'waiting'
        ? 'border-signal-500/50 bg-signal-500/10 text-chalk'
        : closed
          ? 'border-iron-800 bg-iron-900 text-iron-600'
          : full
            ? 'border-iron-700 bg-iron-850 text-iron-300'
            : 'border-iron-700 bg-iron-850 text-chalk hover:border-signal-400';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${c.startsAt} ${c.name}: ${slotLabel(c)}`}
      className={`flex min-h-16 w-full flex-col items-center justify-center rounded-xl border px-1 transition-colors ${tone}`}
    >
      <span className={`figure text-lg font-bold leading-none ${c.cancelled ? 'line-through' : ''}`}>
        {c.startsAt}
      </span>
      <span className="mt-1 text-xs font-semibold">{slotLabel(c)}</span>
    </button>
  );
}

interface SlotDetailProps {
  occurrence: ClassOccurrence;
  disabled: boolean;
  busy: boolean;
  cancelDeadlineMinutes: number;
  onBook: () => void;
  onCancel: () => void;
}

function SlotDetail({ occurrence: c, disabled, busy, cancelDeadlineMinutes, onBook, onCancel }: SlotDetailProps) {
  const full = c.booked >= c.capacity;
  const open = !c.cancelled && !c.started;

  return (
    <article aria-labelledby={`slot-${c.id}`} className="rounded-xl border border-iron-700 bg-iron-850 p-3">
      <h4 id={`slot-${c.id}`} className="font-semibold text-chalk">
        {c.name} · {c.startsAt}–{endTime(c.startsAt, c.durationMinutes)}
      </h4>
      <p className="text-xs text-iron-400">
        {c.durationMinutes} min{c.coach ? ` · con ${c.coach}` : ''}
      </p>

      {c.cancelled ? (
        <p className="mt-2 text-sm text-iron-400">Esta clase no se da este día.</p>
      ) : (
        <div className="mt-2">
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
                  ? 'border border-iron-700 text-iron-100 hover:bg-iron-800'
                  : 'bg-signal-500 text-ink hover:bg-signal-400'
              }`}
            >
              {busy ? 'Un momento…' : full ? 'Apuntarme a la lista de espera' : 'Reservar'}
            </button>
          ) : c.canCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={disabled}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-iron-700 px-4 font-semibold text-iron-100 transition-colors hover:bg-iron-800 disabled:opacity-40"
            >
              {busy ? 'Un momento…' : c.mine === 'waiting' ? 'Salir de la lista de espera' : 'Anular mi plaza'}
            </button>
          ) : (
            <p className="text-sm text-iron-400">
              Falta menos de {cancelDeadlineMinutes === 60 ? '1 hora' : `${cancelDeadlineMinutes} minutos`}: ya no
              se puede anular desde la app. Si no puedes venir, avisa en el gimnasio.
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Las clases a las que ha ido, de la más reciente a la más antigua.
 *
 * Plegado hasta que se pide: es para mirarlo de vez en cuando, no cada vez
 * que se abre la pantalla a reservar.
 */
function History({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<ClassHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || history !== null) return;
    api.fetchClassHistory().then(setHistory, (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'No se ha podido cargar el historial.'),
    );
  }, [open, history]);

  const thisMonth = (history ?? []).filter(
    (item) => item.date.slice(0, 7) === today.slice(0, 7) && item.attended !== false,
  ).length;

  return (
    <section aria-labelledby="history-title" className="rounded-2xl border border-iron-800 bg-iron-900">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-2 px-4 text-left"
      >
        <span id="history-title" className="flex-1 font-semibold text-chalk">
          Mi historial
        </span>
        <Icon name="chevronRight" size={18} className={`text-iron-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open ? (
        <div className="border-t border-iron-800 px-4 py-3">
          {error ? (
            <p className="text-sm text-effort-300">{error}</p>
          ) : history === null ? (
            <p className="text-sm text-iron-400">Cargando…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-iron-400">Todavía no has ido a ninguna clase.</p>
          ) : (
            <>
              <p className="mb-2 text-sm text-iron-100">
                <span className="figure text-2xl font-bold text-chalk">{thisMonth}</span>{' '}
                {thisMonth === 1 ? 'clase' : 'clases'} este mes
              </p>
              <ul className="divide-y divide-iron-800">
                {history.map((item) => (
                  <li key={`${item.date}|${item.startsAt}|${item.name}`} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-iron-100">
                        {longDate(item.date).replace(/^./, (first) => first.toUpperCase())}
                      </span>
                      <span className="block text-xs text-iron-400">
                        {item.startsAt} · {item.name}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold ${
                        item.attended === false ? 'text-effort-300' : item.attended ? 'text-done-300' : 'text-iron-400'
                      }`}
                    >
                      {item.attended === false ? 'No viniste' : item.attended ? 'Viniste' : 'Reservada'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-iron-400">Los últimos 3 meses.</p>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
