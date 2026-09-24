import { useState, type FormEvent } from 'react';

import type { GymClass, GymClassInput } from '../../api/client';
import { Icon } from './Icon';

interface ScheduleEditorProps {
  schedule: GymClass[];
  busy: string | null;
  disabled: boolean;
  /** Cada una resuelve `true` si se guardó. */
  onCreate: (input: GymClassInput) => Promise<boolean>;
  onUpdate: (classId: number, input: GymClassInput) => Promise<boolean>;
  onDelete: (classId: number) => Promise<boolean>;
}

/** 1 = lunes … 7 = domingo, como lo guarda el servidor. */
const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const EMPTY: GymClassInput = {
  name: '',
  coach: null,
  weekday: 1,
  startsAt: '18:00',
  durationMinutes: 60,
  capacity: 12,
};

/**
 * El horario semanal, para quien administra.
 *
 * Una lista por día y un formulario que sirve para añadir y para cambiar. Se
 * edita la semana tipo, no cada fecha: una clase que se repite todos los
 * jueves se escribe una vez. Para saltarse un jueves concreto está «Anular la
 * clase este día» en la propia clase.
 */
export function ScheduleEditor({
  schedule,
  busy,
  disabled,
  onCreate,
  onUpdate,
  onDelete,
}: ScheduleEditorProps) {
  // `null`: formulario cerrado. `'new'`: añadiendo. Un número: cambiando esa.
  const [editing, setEditing] = useState<'new' | number | null>(schedule.length === 0 ? 'new' : null);

  const byDay = WEEKDAYS.map((label, index) => ({
    label,
    classes: schedule.filter((c) => c.weekday === index + 1),
  })).filter((day) => day.classes.length > 0);

  const current = typeof editing === 'number' ? schedule.find((c) => c.id === editing) : undefined;

  return (
    <div className="space-y-4">
      {editing !== null ? (
        <ClassForm
          key={editing}
          initial={current ?? EMPTY}
          isNew={editing === 'new'}
          disabled={disabled}
          saving={busy === (editing === 'new' ? 'schedule:new' : `schedule:${editing}`)}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            // Si falla, el formulario se queda abierto con lo escrito.
            const saved =
              editing === 'new' ? await onCreate(input) : await onUpdate(editing, input);
            if (saved) setEditing(null);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing('new')}
          disabled={disabled}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 font-semibold text-iron-950 hover:bg-signal-400 disabled:opacity-40"
        >
          <Icon name="plus" size={18} />
          Añadir clase
        </button>
      )}

      {byDay.map((day) => (
        <section key={day.label} aria-label={day.label}>
          <h3 className="eyebrow mb-2 block px-1">{day.label}</h3>
          <ul className="space-y-2">
            {day.classes.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-2xl border border-iron-800 bg-iron-900 px-4 py-3"
              >
                <span className="figure w-14 shrink-0 text-lg font-bold text-chalk">
                  {c.startsAt}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-chalk">{c.name}</span>
                  <span className="block truncate text-xs text-iron-400">
                    {c.durationMinutes} min · {c.capacity} plazas
                    {c.coach ? ` · ${c.coach}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(c.id)}
                  disabled={disabled}
                  aria-label={`Cambiar ${c.name} del ${day.label.toLowerCase()} a las ${c.startsAt}`}
                  className="flex size-11 items-center justify-center rounded-xl text-iron-400 hover:bg-iron-850 hover:text-iron-100 disabled:opacity-40"
                >
                  <Icon name="pencil" size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        `¿Quitar ${c.name} de los ${day.label.toLowerCase()} a las ${c.startsAt}? Se borran también sus reservas.`,
                      )
                    ) {
                      void onDelete(c.id);
                    }
                  }}
                  disabled={disabled}
                  aria-label={`Quitar ${c.name} del ${day.label.toLowerCase()} a las ${c.startsAt}`}
                  className="flex size-11 items-center justify-center rounded-xl text-iron-400 hover:bg-iron-850 hover:text-iron-100 disabled:opacity-40"
                >
                  <Icon name="close" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface ClassFormProps {
  initial: GymClassInput;
  isNew: boolean;
  disabled: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (input: GymClassInput) => Promise<void>;
}

function ClassForm({ initial, isNew, disabled, saving, onCancel, onSave }: ClassFormProps) {
  const [name, setName] = useState(initial.name);
  const [coach, setCoach] = useState(initial.coach ?? '');
  const [weekday, setWeekday] = useState(initial.weekday);
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [duration, setDuration] = useState(String(initial.durationMinutes));
  const [capacity, setCapacity] = useState(String(initial.capacity));

  const movesDay = !isNew && weekday !== initial.weekday;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave({
      name: name.trim(),
      coach: coach.trim() || null,
      weekday,
      startsAt,
      durationMinutes: Number.parseInt(duration, 10),
      capacity: Number.parseInt(capacity, 10),
    });
  };

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
          placeholder="Crossfit, Yoga, Spinning…"
        />
      </label>

      <label className="block space-y-1">
        <span className="eyebrow block">Monitor (opcional)</span>
        <input
          className={field}
          value={coach}
          onChange={(event) => setCoach(event.target.value)}
          maxLength={60}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="eyebrow block">Día</span>
          <select
            className={field}
            value={weekday}
            onChange={(event) => setWeekday(Number(event.target.value))}
          >
            {WEEKDAYS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>

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

      {movesDay ? (
        <p className="text-sm text-signal-300">
          Al cambiar el día se borran las reservas que ya había para esta clase.
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={disabled}
          className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-signal-500 px-4 font-semibold text-iron-950 hover:bg-signal-400 disabled:opacity-40"
        >
          {saving ? 'Guardando…' : isNew ? 'Añadir al horario' : 'Guardar'}
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
    </form>
  );
}
