import { useCallback, useEffect, useMemo, useState } from 'react';

import * as api from '../../api/client';
import type { ClassOccurrence, ClassesWeek, GymClassInput, MemberSummary } from '../../api/client';
import {
  WEEKDAY_SHORT,
  addDays,
  dayName,
  dayNumber,
  endTime,
  gymToday,
  longDate,
  longDateTitle,
  weekdayOf,
} from '../classDates';
import { Icon } from './Icon';
import { MembersScreen } from './MembersScreen';
import { ScheduleEditor } from './ScheduleEditor';

interface AdminScreenProps {
  currentUserId: number | null;
  offline: boolean;
}

type Section = 'agenda' | 'members' | 'schedule' | 'notices';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'agenda', label: 'Agenda' },
  { id: 'members', label: 'Socios' },
  { id: 'schedule', label: 'Horario' },
  { id: 'notices', label: 'Avisos' },
];

/**
 * Gestión del gimnasio: lo que ve quien lo lleva.
 *
 * Como las apps de gestión (Glofox, Mindbody Business, TeamUp), separada de la
 * vista del socio y ordenada por lo que se hace a diario: la **agenda** del
 * día con la ocupación de cada clase y su lista de apuntados; los **socios**;
 * y el **horario** semanal, que se toca de vez en cuando.
 */
export function AdminScreen({ currentUserId, offline }: AdminScreenProps) {
  const [section, setSection] = useState<Section>('agenda');
  // Desde la agenda se puede saltar a cambiar un turno en el horario.
  const [editClassId, setEditClassId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-chalk">Gestión</h2>
      </div>

      <nav aria-label="Gestión">
        <ul className="grid grid-cols-4 gap-1 rounded-xl bg-iron-900 p-1">
          {SECTIONS.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                onClick={() => {
                  setSection(candidate.id);
                  setEditClassId(null);
                }}
                aria-current={section === candidate.id ? 'page' : undefined}
                className={`min-h-10 w-full rounded-lg text-sm font-semibold transition-colors ${
                  section === candidate.id
                    ? 'bg-signal-500 text-iron-950'
                    : 'text-iron-400 hover:text-iron-100'
                }`}
              >
                {candidate.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {section === 'agenda' ? (
        <Agenda
          offline={offline}
          onEditClass={(classId) => {
            setEditClassId(classId);
            setSection('schedule');
          }}
        />
      ) : null}
      {section === 'members' ? <MembersScreen currentUserId={currentUserId} offline={offline} /> : null}
      {section === 'schedule' ? <Schedule offline={offline} editClassId={editClassId} /> : null}
      {section === 'notices' ? <Notices offline={offline} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agenda                                                              */
/* ------------------------------------------------------------------ */

function useFeedback() {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (work: () => Promise<string | null>, after: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const message = await work();
        await after();
        setNotice(message);
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se ha podido completar la operación.');
        await after().catch(() => undefined);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { error, notice, busy, run, setError };
}

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <div role="status" aria-live="polite">
      {error ? (
        <p className="rounded-xl border border-effort-500/40 bg-effort-500/10 px-4 py-3 text-sm text-effort-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl border border-done-500/40 bg-done-500/10 px-4 py-3 text-sm font-semibold text-done-300">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function Agenda({ offline, onEditClass }: { offline: boolean; onEditClass: (classId: number) => void }) {
  const today = useMemo(gymToday, []);
  const [from, setFrom] = useState(today);
  const [week, setWeek] = useState<ClassesWeek | null>(null);
  const [selected, setSelected] = useState(today);
  const [openClass, setOpenClass] = useState<{ id: number; date: string } | null>(null);
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const feedback = useFeedback();
  const { setError } = feedback;

  const load = useCallback(async () => {
    try {
      setWeek(await api.fetchClasses(from === today ? undefined : from));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se ha podido cargar la agenda.');
    }
  }, [from, today, setError]);

  useEffect(() => {
    void load();
  }, [load]);

  // La lista de socios solo hace falta para apuntar a alguien, y se pide una
  // vez al abrir la primera clase.
  useEffect(() => {
    if (openClass && members === null) {
      api.fetchMembers().then(setMembers, () => setMembers([]));
    }
  }, [openClass, members]);

  const days = week?.days ?? [];
  const day = days.find((candidate) => candidate.date === selected) ?? days[0];
  const occurrence = openClass
    ? days
        .find((candidate) => candidate.date === openClass.date)
        ?.classes.find((c) => c.id === openClass.id)
    : undefined;

  const maxFrom = addDays(today, (week?.adminDaysAhead ?? 90) - 6);
  const moveWeek = (offset: number) => {
    const next = addDays(from, offset * 7);
    const clamped = next < addDays(today, -7) ? addDays(today, -7) : next > maxFrom ? maxFrom : next;
    setFrom(clamped);
    setSelected(clamped < today && addDays(clamped, 6) >= today ? today : clamped);
    setOpenClass(null);
  };

  if (!week) {
    return (
      <>
        <Feedback error={feedback.error} notice={null} />
        {!feedback.error ? (
          <p role="status" className="py-12 text-center text-iron-400">
            Cargando agenda…
          </p>
        ) : null}
      </>
    );
  }

  if (openClass && occurrence) {
    return (
      <Roster
        occurrence={occurrence}
        today={today}
        members={members}
        disabled={offline || feedback.busy}
        feedback={feedback}
        onBack={() => setOpenClass(null)}
        onEditClass={() => onEditClass(occurrence.id)}
        reload={load}
      />
    );
  }

  const classes = day?.classes ?? [];
  const live = classes.filter((c) => !c.started);
  // El día cuenta como anulado cuando lo está todo lo que aún no ha empezado.
  const dayCancelled = live.length > 0 && live.every((c) => c.cancelled);
  const booked = classes.reduce((sum, c) => sum + (c.cancelled ? 0 : c.booked), 0);
  const waiting = classes.reduce((sum, c) => sum + (c.cancelled ? 0 : c.waiting), 0);
  const places = classes.reduce((sum, c) => sum + (c.cancelled ? 0 : c.capacity), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => moveWeek(-1)}
          disabled={from <= addDays(today, -7)}
          aria-label="Semana anterior"
          className="flex size-11 items-center justify-center rounded-xl text-iron-400 hover:bg-iron-850 hover:text-iron-100 disabled:opacity-30"
        >
          <Icon name="chevronRight" size={20} className="rotate-180" />
        </button>
        <p className="flex-1 text-center text-sm font-semibold text-iron-100">
          {from === today ? 'Próximos 7 días' : `${longDate(from)} – ${longDate(addDays(from, 6))}`}
        </p>
        <button
          type="button"
          onClick={() => moveWeek(1)}
          disabled={from >= maxFrom}
          aria-label="Semana siguiente"
          className="flex size-11 items-center justify-center rounded-xl text-iron-400 hover:bg-iron-850 hover:text-iron-100 disabled:opacity-30"
        >
          <Icon name="chevronRight" size={20} />
        </button>
      </div>

      <nav aria-label="Días de la agenda">
        <ul className="grid grid-cols-7 gap-1.5">
          {days.map((candidate) => {
            const active = candidate.date === day?.date;
            const cancelledDay =
              candidate.classes.length > 0 && candidate.classes.every((c) => c.cancelled);
            return (
              <li key={candidate.date}>
                <button
                  type="button"
                  onClick={() => setSelected(candidate.date)}
                  aria-current={active ? 'date' : undefined}
                  aria-label={`${dayName(candidate.date, today)}${cancelledDay ? ', anulado' : ''}`}
                  className={`flex min-h-16 w-full flex-col items-center justify-center rounded-xl px-0.5 transition-colors ${
                    active ? 'bg-signal-500 text-iron-950' : 'bg-iron-900 text-iron-400 hover:bg-iron-850'
                  }`}
                >
                  <span className="text-[11px] font-semibold uppercase">
                    {candidate.date === today ? 'Hoy' : WEEKDAY_SHORT[weekdayOf(candidate.date)]}
                  </span>
                  <span
                    className={`figure text-xl font-bold leading-tight ${cancelledDay ? 'line-through' : ''}`}
                  >
                    {dayNumber(candidate.date)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <Feedback error={feedback.error} notice={feedback.notice} />

      {day ? (
        <section aria-labelledby="agenda-day-title" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="agenda-day-title" className="font-semibold text-chalk">
                {longDateTitle(day.date)}
              </h3>
              <p className="text-xs text-iron-400">
                {classes.length === 0
                  ? 'Sin clases'
                  : `${classes.length} ${classes.length === 1 ? 'clase' : 'clases'} · ${booked} de ${places} plazas ocupadas${
                      waiting > 0 ? ` · ${waiting} en espera` : ''
                    }`}
              </p>
            </div>
            {live.length > 0 ? (
              <button
                type="button"
                disabled={offline || feedback.busy}
                onClick={() => {
                  if (dayCancelled) {
                    void feedback.run(async () => {
                      const result = await api.setDayCancelled(day.date, false);
                      return `Día recuperado: ${result.restored ?? 0} clases vuelven a estar abiertas.`;
                    }, load);
                    return;
                  }
                  const people = live.reduce((sum, c) => sum + c.booked + c.waiting, 0);
                  const message =
                    `¿Anular todas las clases del ${longDate(day.date)}?` +
                    (people > 0 ? `\n\nSe avisará por correo a quien estaba apuntado (${people}).` : '') +
                    '\n\nLas reservas se guardan por si recuperas el día.';
                  if (!confirm(message)) return;
                  void feedback.run(async () => {
                    const result = await api.setDayCancelled(day.date, true);
                    return `Día anulado: ${result.cancelled ?? 0} clases${
                      result.notified ? `, ${result.notified} avisos enviados` : ''
                    }.`;
                  }, load);
                }}
                className="flex min-h-11 items-center gap-1.5 rounded-xl border border-iron-700 px-3 text-sm font-semibold text-iron-100 hover:bg-iron-850 disabled:opacity-40"
              >
                {dayCancelled ? 'Recuperar el día' : 'Anular el día'}
              </button>
            ) : null}
          </div>

          {classes.length === 0 ? (
            <p className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-6 text-center text-sm text-iron-400">
              No hay clases este día. Se añaden en «Horario».
            </p>
          ) : (
            <ul className="space-y-2">
              {classes.map((c) => (
                <li key={c.id}>
                  <AgendaRow occurrence={c} onOpen={() => setOpenClass({ id: c.id, date: c.date })} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function AgendaRow({ occurrence: c, onOpen }: { occurrence: ClassOccurrence; onOpen: () => void }) {
  const full = c.booked >= c.capacity;
  const status = c.cancelled ? 'Anulada' : c.started ? 'Empezada' : full ? 'Completa' : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-3 rounded-2xl border border-iron-800 bg-iron-900 px-4 py-3 text-left hover:bg-iron-850 ${
        c.cancelled || c.started ? 'opacity-60' : ''
      }`}
    >
      <span className="w-14 shrink-0">
        <span className="figure block text-lg font-bold leading-none text-chalk">{c.startsAt}</span>
        <span className="figure block text-xs text-iron-400">{endTime(c.startsAt, c.durationMinutes)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={`truncate font-semibold text-chalk ${c.cancelled ? 'line-through' : ''}`}>
            {c.name}
          </span>
          {status ? <span className="text-xs font-semibold text-iron-400">{status}</span> : null}
        </span>
        {!c.cancelled ? (
          <span className="mt-1.5 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-iron-800" aria-hidden="true">
              <span
                className={`block h-full rounded-full ${full ? 'bg-iron-400' : 'bg-signal-500'}`}
                style={{ width: `${(c.booked / c.capacity) * 100}%` }}
              />
            </span>
            {c.waiting > 0 ? (
              <span className="shrink-0 text-xs font-semibold text-signal-300">+{c.waiting} espera</span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="figure shrink-0 text-lg font-bold text-iron-100">
        {c.booked}/{c.capacity}
        <span className="sr-only"> plazas ocupadas</span>
      </span>
      <Icon name="chevronRight" size={18} className="shrink-0 text-iron-600" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Una clase: quién va                                                 */
/* ------------------------------------------------------------------ */

interface RosterProps {
  occurrence: ClassOccurrence;
  today: string;
  members: MemberSummary[] | null;
  disabled: boolean;
  feedback: ReturnType<typeof useFeedback>;
  onBack: () => void;
  onEditClass: () => void;
  reload: () => Promise<void>;
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function Roster({ occurrence: c, today, members, disabled, feedback, onBack, onEditClass, reload }: RosterProps) {
  const [query, setQuery] = useState('');
  const attendees = c.attendees ?? [];
  const confirmed = attendees.filter((person) => !person.waiting);
  const waitlist = attendees.filter((person) => person.waiting);
  const open = !c.cancelled && !c.started;

  const inClass = new Set(attendees.map((person) => person.userId));
  const needle = fold(query.trim());
  const candidates = (members ?? [])
    .filter((member) => !inClass.has(member.id))
    .filter(
      (member) =>
        needle === '' || fold(member.displayName).includes(needle) || fold(member.email).includes(needle),
    )
    .slice(0, needle === '' ? 5 : 10);

  const full = c.booked >= c.capacity;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-iron-400 hover:bg-iron-850 hover:text-iron-100"
      >
        <Icon name="chevronRight" size={18} className="rotate-180" />
        Volver a la agenda
      </button>

      <section className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <p className="eyebrow">{dayName(c.date, today)}</p>
        <h3 className="text-xl font-bold text-chalk">
          {c.name} · {c.startsAt}–{endTime(c.startsAt, c.durationMinutes)}
        </h3>
        <p className="text-sm text-iron-400">
          {longDateTitle(c.date)}
          {c.coach ? ` · con ${c.coach}` : null}
        </p>

        {c.cancelled ? (
          <p className="mt-3 rounded-lg bg-iron-800 px-3 py-2 text-sm font-semibold text-iron-300">
            Anulada este día. Las reservas se guardan por si la recuperas.
          </p>
        ) : (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-semibold text-iron-100">
                {c.booked} de {c.capacity} plazas
              </span>
              <span className="text-iron-400">
                {full ? 'Completa' : `${c.capacity - c.booked} libres`}
                {c.waiting > 0 ? ` · ${c.waiting} en espera` : ''}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-iron-800" aria-hidden="true">
              <div
                className={`h-full rounded-full ${full ? 'bg-iron-400' : 'bg-signal-500'}`}
                style={{ width: `${(c.booked / c.capacity) * 100}%` }}
              />
            </div>
          </div>
        )}
      </section>

      <Feedback error={feedback.error} notice={feedback.notice} />

      <section aria-labelledby="roster-title">
        <h4 id="roster-title" className="eyebrow mb-2 block px-1">
          Apuntados ({confirmed.length})
        </h4>
        {c.started && confirmed.length > 0 ? (
          <p className="mb-2 px-1 text-xs text-iron-400">
            Pasa lista: marca quién vino. Las faltas se ven en la ficha de cada socio.
          </p>
        ) : null}
        <PeopleList
          onMark={
            c.started
              ? (person, attended) =>
                  void feedback.run(async () => {
                    await api.setAttendance(person.bookingId, attended);
                    return null;
                  }, reload)
              : undefined
          }
          people={confirmed}
          empty="Nadie todavía."
          canRemove={!c.started}
          disabled={disabled}
          onRemove={(person) => {
            if (!confirm(`¿Quitar a ${person.name} de ${c.name}?`)) return;
            void feedback.run(async () => {
              await api.removeClassBooking(person.bookingId);
              return `${person.name} ya no está apuntado.${
                waitlist[0] ? ` Entra ${waitlist[0].name} desde la espera.` : ''
              }`;
            }, reload);
          }}
        />
      </section>

      {waitlist.length > 0 ? (
        <section aria-labelledby="waitlist-title">
          <h4 id="waitlist-title" className="eyebrow mb-2 block px-1">
            Lista de espera ({waitlist.length})
          </h4>
          <PeopleList
            people={waitlist}
              empty=""
            canRemove={!c.started}
            disabled={disabled}
            onRemove={(person) => {
              if (!confirm(`¿Sacar a ${person.name} de la lista de espera?`)) return;
              void feedback.run(async () => {
                await api.removeClassBooking(person.bookingId);
                return `${person.name} ha salido de la espera.`;
              }, reload);
            }}
          />
        </section>
      ) : null}

      {open ? (
        <section aria-labelledby="add-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
          <h4 id="add-title" className="mb-2 font-semibold text-chalk">
            Apuntar a un socio
          </h4>
          <label className="block">
            <span className="sr-only">Buscar socio para apuntar</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nombre o correo"
              className="w-full rounded-xl border border-iron-700 bg-iron-850 px-4 py-3 text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
            />
          </label>
          {full ? (
            <p className="mt-2 text-xs text-iron-400">
              La clase está completa: quien apuntes entra en la lista de espera.
            </p>
          ) : null}
          {members === null ? (
            <p className="mt-3 text-sm text-iron-400">Cargando socios…</p>
          ) : candidates.length === 0 ? (
            <p className="mt-3 text-sm text-iron-400">
              {needle ? 'Nadie coincide con esa búsqueda.' : 'Todos los socios están ya apuntados.'}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-iron-800">
              {candidates.map((member) => (
                <li key={member.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-iron-100">
                      {member.displayName}
                    </span>
                    <span className="block truncate text-xs text-iron-400">{member.email}</span>
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      void feedback.run(async () => {
                        const result = await api.addClassAttendee(c.id, c.date, member.id);
                        setQuery('');
                        return result.status === 'booked'
                          ? `${member.displayName} apuntado. Le llega un correo.`
                          : `Clase completa: ${member.displayName} queda en espera (${result.waitPosition}º).`;
                      }, reload)
                    }
                    aria-label={`Apuntar a ${member.displayName}`}
                    className="flex min-h-10 items-center gap-1 rounded-xl bg-signal-500 px-3 text-sm font-semibold text-iron-950 hover:bg-signal-400 disabled:opacity-40"
                  >
                    <Icon name="plus" size={14} />
                    Apuntar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {!c.started ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (c.cancelled) {
                void feedback.run(async () => {
                  await api.setClassCancelled(c.id, c.date, false);
                  return 'Clase recuperada.';
                }, reload);
                return;
              }
              const message =
                attendees.length > 0
                  ? `¿Anular ${c.name} de este día? Se avisará por correo a ${attendees.length} ${
                      attendees.length === 1 ? 'persona' : 'personas'
                    }.`
                  : `¿Anular ${c.name} de este día?`;
              if (!confirm(message)) return;
              void feedback.run(async () => {
                await api.setClassCancelled(c.id, c.date, true);
                return 'Clase anulada.';
              }, reload);
            }}
            className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-iron-700 px-3 text-sm font-semibold text-iron-100 hover:bg-iron-850 disabled:opacity-40"
          >
            {c.cancelled ? 'Recuperar la clase' : 'Anular esta clase'}
          </button>
          <button
            type="button"
            onClick={onEditClass}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-iron-700 px-3 text-sm font-semibold text-iron-100 hover:bg-iron-850"
          >
            <Icon name="pencil" size={14} />
            Cambiar en el horario
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PeopleList({
  people,
  empty,
  canRemove,
  disabled,
  onRemove,
  onMark,
}: {
  people: NonNullable<ClassOccurrence['attendees']>;
  empty: string;
  canRemove: boolean;
  disabled: boolean;
  onRemove: (person: NonNullable<ClassOccurrence['attendees']>[number]) => void;
  /** Pasar lista; solo cuando la clase ya ha empezado. */
  onMark?: (person: NonNullable<ClassOccurrence['attendees']>[number], attended: boolean | null) => void;
}) {
  if (people.length === 0) {
    return (
      <p className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-4 text-sm text-iron-400">{empty}</p>
    );
  }
  return (
    <ol className="divide-y divide-iron-800 rounded-2xl border border-iron-800 bg-iron-900">
      {people.map((person, index) => (
        <li key={person.bookingId} className="flex items-center gap-3 px-4 py-2">
          <span className="figure w-5 text-sm text-iron-600">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-iron-100">{person.name}</span>
          {onMark ? (
            <span className="flex shrink-0 gap-1" role="group" aria-label={`Asistencia de ${person.name}`}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={person.attended === true}
                onClick={() => onMark(person, person.attended === true ? null : true)}
                className={`min-h-10 rounded-lg px-3 text-sm font-semibold disabled:opacity-40 ${
                  person.attended === true
                    ? 'bg-done-500 text-white'
                    : 'border border-iron-700 text-iron-300 hover:bg-iron-850'
                }`}
              >
                Vino
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={person.attended === false}
                onClick={() => onMark(person, person.attended === false ? null : false)}
                className={`min-h-10 rounded-lg px-3 text-sm font-semibold disabled:opacity-40 ${
                  person.attended === false
                    ? 'bg-effort-500 text-white'
                    : 'border border-iron-700 text-iron-300 hover:bg-iron-850'
                }`}
              >
                No vino
              </button>
            </span>
          ) : null}
          {canRemove ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(person)}
              aria-label={`Quitar a ${person.name}`}
              className="min-h-10 rounded-lg px-2 text-sm font-semibold text-iron-400 hover:bg-effort-500/10 hover:text-effort-300 disabled:opacity-40"
            >
              Quitar
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Horario                                                             */
/* ------------------------------------------------------------------ */

function Schedule({ offline, editClassId }: { offline: boolean; editClassId: number | null }) {
  const [week, setWeek] = useState<ClassesWeek | null>(null);
  const feedback = useFeedback();
  const { setError } = feedback;

  const load = useCallback(async () => {
    try {
      setWeek(await api.fetchClasses());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se ha podido cargar el horario.');
    }
  }, [setError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!week?.schedule) {
    return (
      <>
        <Feedback error={feedback.error} notice={null} />
        {!feedback.error ? (
          <p role="status" className="py-12 text-center text-iron-400">
            Cargando horario…
          </p>
        ) : null}
      </>
    );
  }

  const run = (work: () => Promise<string>) => feedback.run(work, load);

  return (
    <div className="space-y-4">
      <Feedback error={feedback.error} notice={feedback.notice} />
      <ScheduleEditor
        schedule={week.schedule}
        busy={feedback.busy}
        disabled={offline || feedback.busy}
        initialEditId={editClassId}
        onCreate={(inputs: GymClassInput[]) =>
          run(async () => {
            for (const input of inputs) await api.createGymClass(input);
            return inputs.length === 1
              ? `${inputs[0]!.name} añadida al horario.`
              : `${inputs[0]!.name} añadida en ${inputs.length} días.`;
          })
        }
        onUpdate={(updates) =>
          run(async () => {
            for (const { id, input } of updates) await api.updateGymClass(id, input);
            return updates.length === 1 ? 'Cambio guardado.' : `Cambio guardado en ${updates.length} días.`;
          })
        }
        onDelete={(ids) =>
          run(async () => {
            for (const id of ids) await api.deleteGymClass(id);
            return ids.length === 1 ? 'Clase quitada del horario.' : `Quitada de ${ids.length} días.`;
          })
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Avisos                                                              */
/* ------------------------------------------------------------------ */

function Notices({ offline }: { offline: boolean }) {
  const [notices, setNotices] = useState<api.Announcement[] | null>(null);
  const [message, setMessage] = useState('');
  const feedback = useFeedback();
  const { setError } = feedback;

  const load = useCallback(async () => {
    try {
      setNotices(await api.fetchAnnouncements());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se han podido cargar los avisos.');
    }
  }, [setError]);

  useEffect(() => {
    void load();
  }, [load]);

  const disabled = offline || feedback.busy;

  return (
    <div className="space-y-4">
      <form
        aria-label="Nuevo aviso"
        onSubmit={(event) => {
          event.preventDefault();
          void feedback
            .run(async () => {
              await api.createAnnouncement(message);
              return 'Aviso publicado: lo verán todos al abrir la app.';
            }, load)
            .then((done) => {
              if (done) setMessage('');
            });
        }}
        className="space-y-3 rounded-2xl border border-iron-800 bg-iron-900 p-4"
      >
        <label className="block space-y-1">
          <span className="font-semibold text-chalk">Nuevo aviso</span>
          <span className="block text-sm text-iron-400">
            Un cierre, un cambio de horario… Les sale a todos arriba en la app hasta que lo cierran.
          </span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={500}
            rows={3}
            required
            placeholder="El lunes 12 cerramos por festivo."
            className="mt-1 w-full rounded-lg border border-iron-700 bg-iron-850 px-3 py-2.5 text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-iron-400">{message.length}/500</span>
          <button
            type="submit"
            disabled={disabled || message.trim() === ''}
            className="min-h-11 rounded-xl bg-signal-500 px-4 font-semibold text-iron-950 hover:bg-signal-400 disabled:opacity-40"
          >
            Publicar
          </button>
        </div>
      </form>

      <Feedback error={feedback.error} notice={feedback.notice} />

      <section aria-labelledby="notices-title">
        <h3 id="notices-title" className="eyebrow mb-2 block px-1">
          Publicados
        </h3>
        {notices === null ? (
          <p className="text-sm text-iron-400">Cargando…</p>
        ) : notices.length === 0 ? (
          <p className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-6 text-center text-sm text-iron-400">
            No hay avisos publicados.
          </p>
        ) : (
          <ul className="space-y-2">
            {notices.map((notice) => (
              <li
                key={notice.id}
                className="flex items-start gap-3 rounded-2xl border border-iron-800 bg-iron-900 px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block whitespace-pre-line text-sm text-iron-100">{notice.message}</span>
                  <span className="mt-1 block text-xs text-iron-400">
                    {new Date(notice.createdAt).toLocaleDateString('es-ES', {
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (!confirm('¿Quitar este aviso? Deja de salirle a todo el mundo.')) return;
                    void feedback.run(async () => {
                      await api.deleteAnnouncement(notice.id);
                      return 'Aviso quitado.';
                    }, load);
                  }}
                  className="min-h-10 shrink-0 rounded-lg px-2 text-sm font-semibold text-iron-400 hover:bg-effort-500/10 hover:text-effort-300 disabled:opacity-40"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
