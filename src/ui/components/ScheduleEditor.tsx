import { useState, type FormEvent } from 'react';

import type { GymClass, GymClassInput } from '../../api/client';
import { endTime } from '../classDates';
import { Icon } from './Icon';

interface ScheduleEditorProps {
  schedule: GymClass[];
  busy: boolean;
  disabled: boolean;
  /** Abre directamente el formulario de esta clase (desde la agenda). */
  initialEditId?: number | null;
  /** Cada una resuelve `true` si se guardó. */
  onCreate: (inputs: GymClassInput[]) => Promise<boolean>;
  onUpdate: (updates: { id: number; input: GymClassInput }[]) => Promise<boolean>;
  onDelete: (ids: number[]) => Promise<boolean>;
}

/** 1 = lunes … 7 = domingo, como lo guarda el servidor. */
const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const WEEKDAY_INITIAL = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const EMPTY: GymClassInput = {
  name: '',
  coach: null,
  weekday: 1,
  startsAt: '18:00',
  durationMinutes: 60,
  capacity: 12,
};

/** El mismo turno en otros días: mismo nombre y misma hora. */
function siblingsOf(schedule: GymClass[], target: GymClass): GymClass[] {
  return schedule.filter(
    (c) => c.id !== target.id && c.name === target.name && c.startsAt === target.startsAt,
  );
}

/**
 * El horario semanal.
 *
 * Un gimnasio repite casi todo de lunes a viernes, así que se trabaja como en
 * las apps de gestión: se elige el día arriba, una clase nueva se crea en
 * varios días de una vez, y al cambiar un turno se puede aplicar a todos los
 * días que lo tienen a esa hora. Para saltarse una fecha concreta está
 * «Anular esta clase» en la agenda.
 */
export function ScheduleEditor({
  schedule,
  busy,
  disabled,
  initialEditId = null,
  onCreate,
  onUpdate,
  onDelete,
}: ScheduleEditorProps) {
  const initialClass = schedule.find((c) => c.id === initialEditId);
  const firstDay = schedule[0]?.weekday ?? 1;
  const [day, setDay] = useState(initialClass?.weekday ?? firstDay);
  // `null`: formulario cerrado. `'new'`: añadiendo. Un número: cambiando esa.
  const [editing, setEditing] = useState<'new' | number | null>(
    initialClass ? initialClass.id : schedule.length === 0 ? 'new' : null,
  );

  const classes = schedule.filter((c) => c.weekday === day);
  const current = typeof editing === 'number' ? schedule.find((c) => c.id === editing) : undefined;

  return (
    <div className="space-y-4">
      <nav aria-label="Día del horario">
        <ul className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((label, index) => {
            const weekday = index + 1;
            const count = schedule.filter((c) => c.weekday === weekday).length;
            const active = weekday === day;
            return (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => {
                    setDay(weekday);
                    if (typeof editing === 'number') setEditing(null);
                  }}
                  aria-current={active ? 'true' : undefined}
                  aria-label={`${label}: ${count} ${count === 1 ? 'clase' : 'clases'}`}
                  className={`flex min-h-14 w-full flex-col items-center justify-center rounded-xl transition-colors ${
                    active ? 'bg-signal-500 text-ink' : 'bg-iron-900 text-iron-400 hover:bg-iron-850'
                  }`}
                >
                  <span className="font-condensed text-lg font-bold">{WEEKDAY_INITIAL[index]}</span>
                  <span className="text-[11px] font-semibold">{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {editing !== null ? (
        <ClassForm
          key={String(editing)}
          classId={current?.id ?? null}
          initial={current ?? { ...EMPTY, weekday: day }}
          siblings={current ? siblingsOf(schedule, current) : []}
          isNew={editing === 'new'}
          disabled={disabled}
          saving={busy}
          onCancel={() => setEditing(null)}
          onCreate={async (inputs) => {
            if (await onCreate(inputs)) setEditing(null);
          }}
          onUpdate={async (updates) => {
            if (await onUpdate(updates)) setEditing(null);
          }}
          onDelete={async (ids) => {
            if (await onDelete(ids)) setEditing(null);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing('new')}
          disabled={disabled}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 font-semibold text-ink hover:bg-signal-400 disabled:opacity-40"
        >
          <Icon name="plus" size={18} />
          Añadir clase
        </button>
      )}

      <section aria-label={WEEKDAYS[day - 1]}>
        <h3 className="eyebrow mb-2 block px-1">
          {WEEKDAYS[day - 1]} · {classes.length} {classes.length === 1 ? 'clase' : 'clases'}
        </h3>
        {classes.length === 0 ? (
          <p className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-6 text-center text-sm text-iron-400">
            Este día no hay clases.
          </p>
        ) : (
          <ul className="space-y-2">
            {classes.map((c) => {
              const siblings = siblingsOf(schedule, c);
              return (
                <li
                  key={c.id}
                  className={`flex items-center gap-3 rounded-2xl border bg-iron-900 px-4 py-3 ${
                    editing === c.id ? 'border-signal-500/60' : 'border-iron-800'
                  }`}
                >
                  <span className="w-14 shrink-0">
                    <span className="figure block text-lg font-bold leading-none text-chalk">{c.startsAt}</span>
                    <span className="figure block text-xs text-iron-400">
                      {endTime(c.startsAt, c.durationMinutes)}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-chalk">{c.name}</span>
                    <span className="block truncate text-xs text-iron-400">
                      {c.capacity} plazas{c.coach ? ` · ${c.coach}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing(c.id)}
                    disabled={disabled}
                    aria-label={`Cambiar ${c.name} de las ${c.startsAt}`}
                    className="flex size-11 items-center justify-center rounded-xl text-iron-400 hover:bg-iron-850 hover:text-iron-100 disabled:opacity-40"
                  >
                    <Icon name="pencil" size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          `¿Quitar ${c.name} de las ${c.startsAt} del ${WEEKDAYS[day - 1]!.toLowerCase()}? Se borran también sus reservas.` +
                            (siblings.length > 0
                              ? `

Solo este día. Para quitarla de todos, ábrela con el lápiz.`
                              : ''),
                        )
                      ) {
                        void onDelete([c.id]);
                      }
                    }}
                    disabled={disabled}
                    aria-label={`Quitar ${c.name} de las ${c.startsAt}`}
                    className="flex size-11 items-center justify-center rounded-xl text-iron-400 hover:bg-iron-850 hover:text-iron-100 disabled:opacity-40"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

interface ClassFormProps {
  /** La clase que se cambia; `null` al crear. */
  classId: number | null;
  initial: GymClassInput;
  /** Mismo nombre y hora en otros días: a los que se puede aplicar el cambio. */
  siblings: GymClass[];
  isNew: boolean;
  disabled: boolean;
  saving: boolean;
  onCancel: () => void;
  onCreate: (inputs: GymClassInput[]) => Promise<void>;
  onUpdate: (updates: { id: number; input: GymClassInput }[]) => Promise<void>;
  onDelete: (ids: number[]) => Promise<void>;
}

function ClassForm({
  classId,
  initial,
  siblings,
  isNew,
  disabled,
  saving,
  onCancel,
  onCreate,
  onUpdate,
  onDelete,
}: ClassFormProps) {
  const [name, setName] = useState(initial.name);
  const [coach, setCoach] = useState(initial.coach ?? '');
  const [days, setDays] = useState<number[]>([initial.weekday]);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [duration, setDuration] = useState(String(initial.durationMinutes));
  const [capacity, setCapacity] = useState(String(initial.capacity));
  const [applyToAll, setApplyToAll] = useState(siblings.length > 0);

  const movesDay = !isNew && weekday !== initial.weekday;

  const fields = (day: number): GymClassInput => ({
    name: name.trim(),
    coach: coach.trim() || null,
    weekday: day,
    startsAt,
    durationMinutes: Number.parseInt(duration, 10),
    capacity: Number.parseInt(capacity, 10),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isNew || classId === null) {
      void onCreate([...days].sort().map(fields));
      return;
    }
    // Al aplicar a todos, cada turno conserva su día: solo cambia lo demás.
    const updates = [{ id: classId, input: fields(weekday) }];
    void onUpdate(
      applyToAll && !movesDay
        ? [
            ...updates,
            ...siblings.map((sibling) => ({ id: sibling.id, input: fields(sibling.weekday) })),
          ]
        : updates,
    );
  };

  const toggleDay = (day: number) =>
    setDays((current) =>
      current.includes(day) ? current.filter((candidate) => candidate !== day) : [...current, day],
    );

  const field =
    'w-full rounded-lg border border-iron-700 bg-iron-850 px-3 py-2.5 text-chalk focus:border-signal-400 focus:outline-none';

  return (
    <form
      onSubmit={submit}
      aria-label={isNew ? 'Nueva clase' : 'Cambiar clase'}
      className="space-y-3 rounded-2xl border border-iron-700 bg-iron-900 p-4"
    >
      <h3 className="font-semibold text-chalk">{isNew ? 'Nueva clase' : 'Cambiar clase'}</h3>

      <label className="block space-y-1">
        <span className="eyebrow block">Nombre</span>
        <input
          className={field}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          required
          placeholder="Turno, Crossfit, Yoga…"
        />
      </label>

      {isNew ? (
        <fieldset className="space-y-1">
          <legend className="eyebrow block">Días</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((label, index) => {
              const day = index + 1;
              const on = days.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-pressed={on}
                  aria-label={label}
                  className={`size-11 rounded-xl font-condensed text-lg font-bold ${
                    on ? 'bg-signal-500 text-ink' : 'border border-iron-700 text-iron-400'
                  }`}
                >
                  {WEEKDAY_INITIAL[index]}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setDays([1, 2, 3, 4, 5])}
              className="min-h-11 rounded-xl border border-iron-700 px-3 text-sm font-semibold text-iron-100 hover:bg-iron-850"
            >
              Lunes a viernes
            </button>
          </div>
        </fieldset>
      ) : (
        <label className="block space-y-1">
          <span className="eyebrow block">Día</span>
          <select className={field} value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
            {WEEKDAYS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-3 gap-3">
        <label className="block space-y-1">
          <span className="eyebrow block">Hora</span>
          <input
            type="time"
            className={field}
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="eyebrow block">Minutos</span>
          <input
            type="number"
            inputMode="numeric"
            min={10}
            max={240}
            className={field}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="eyebrow block">Plazas</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            className={field}
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            required
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="eyebrow block">Monitor (opcional)</span>
        <input className={field} value={coach} onChange={(event) => setCoach(event.target.value)} maxLength={60} />
      </label>

      {!isNew && siblings.length > 0 && !movesDay ? (
        <label className="flex items-start gap-3 rounded-xl bg-iron-850 px-3 py-3 text-sm text-iron-100">
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={(event) => setApplyToAll(event.target.checked)}
            className="mt-0.5 size-5 accent-signal-500"
          />
          <span>
            Aplicar también a los otros {siblings.length} días con «{initial.name}» a las {initial.startsAt}
          </span>
        </label>
      ) : null}

      {movesDay ? (
        <p className="text-sm text-signal-300">
          Al cambiar el día se borran las reservas que ya había para esta clase.
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={disabled || (isNew && days.length === 0)}
          className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-signal-500 px-4 font-semibold text-ink hover:bg-signal-400 disabled:opacity-40"
        >
          {saving
            ? 'Guardando…'
            : isNew
              ? days.length > 1
                ? `Añadir en ${days.length} días`
                : 'Añadir al horario'
              : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex min-h-11 items-center justify-center rounded-xl border border-iron-700 px-4 font-semibold text-iron-100 hover:bg-iron-850 disabled:opacity-40"
        >
          Cancelar
        </button>
      </div>

      {!isNew && classId !== null ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const all = applyToAll && siblings.length > 0;
            const count = all ? siblings.length + 1 : 1;
            const message = all
              ? `¿Quitar «${initial.name}» de las ${initial.startsAt} de los ${count} días? Se borran también sus reservas.`
              : `¿Quitar «${initial.name}» de las ${initial.startsAt} de este día? Se borran también sus reservas.`;
            if (confirm(message)) void onDelete(all ? [classId, ...siblings.map((s) => s.id)] : [classId]);
          }}
          className="w-full rounded-xl px-3 py-2 text-sm font-semibold text-iron-400 hover:bg-effort-500/10 hover:text-effort-300 disabled:opacity-40"
        >
          {applyToAll && siblings.length > 0
            ? `Quitar del horario (los ${siblings.length + 1} días)`
            : 'Quitar del horario'}
        </button>
      ) : null}
    </form>
  );
}
