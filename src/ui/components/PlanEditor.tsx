import { useState } from 'react';

import type { ExerciseFields } from '../../domain/mutations';
import { isSetEmpty, type Day } from '../../domain/types';
import { Icon } from './Icon';

interface PlanEditorProps {
  day: Day;
  busy: boolean;
  offline: boolean;
  onUpdate: (exerciseId: string, fields: ExerciseFields) => void;
  onMove: (exerciseId: string, offset: -1 | 1) => void;
  onRemove: (exerciseId: string) => void;
  onAdd: (name: string) => void;
  onClose: () => void;
}

/**
 * Editing the plan of one day: rename, reorder, remove, add.
 *
 * Deliberately a separate mode rather than controls on every card. The
 * training screen is used one-handed between sets, and a delete button sitting
 * next to a weight input is a mis-tap away from losing a session.
 */
export function PlanEditor({
  day,
  busy,
  offline,
  onUpdate,
  onMove,
  onRemove,
  onAdd,
  onClose,
}: PlanEditorProps) {
  const [newName, setNewName] = useState('');

  const add = () => {
    const name = newName.trim();
    if (name === '') return;
    onAdd(name);
    setNewName('');
  };

  return (
    <section
      aria-label={`Editar el plan del día ${day.number}`}
      className="space-y-3 rounded-2xl border border-signal-500/40 bg-iron-900 p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-bold text-chalk">Editar el plan</h3>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-lg px-3 text-sm font-semibold text-signal-300 hover:bg-iron-850"
        >
          Hecho
        </button>
      </div>

      <p className="text-xs text-iron-400">
        Cambia el nombre o el protocolo, reordena, quita lo que no hagas y añade lo que sí.
        Solo afecta a esta semana.
      </p>

      <ul className="space-y-3">
        {day.exercises.map((exercise, index) => {
          const logged = exercise.currentWeek.filter((set) => !isSetEmpty(set)).length;

          return (
            <li key={exercise.id} className="rounded-xl border border-iron-800 bg-iron-850 p-3">
              <div className="flex items-start gap-2">
                <span className="figure mt-2 w-6 shrink-0 text-sm font-bold text-iron-600">
                  {exercise.number}
                </span>

                <div className="min-w-0 flex-1 space-y-2">
                  <label className="block">
                    <span className="sr-only">Nombre del ejercicio {exercise.number}</span>
                    <input
                      type="text"
                      defaultValue={exercise.name}
                      maxLength={200}
                      // On blur, not on every keystroke: one write per edit
                      // instead of one per letter.
                      onBlur={(event) => {
                        const name = event.target.value.trim();
                        if (name === '' || name === exercise.name) {
                          event.target.value = exercise.name;
                          return;
                        }
                        onUpdate(exercise.id, {
                          name,
                          protocol: exercise.protocol,
                          comments: exercise.comments,
                          video: exercise.video,
                        });
                      }}
                      className="min-h-11 w-full rounded-lg border border-iron-700 bg-iron-900 px-3 font-semibold text-chalk focus:border-signal-400 focus:outline-none"
                    />
                  </label>

                  <label className="block">
                    <span className="sr-only">Protocolo del ejercicio {exercise.number}</span>
                    <input
                      type="text"
                      defaultValue={exercise.protocol ?? ''}
                      maxLength={500}
                      placeholder="3 SETS X 8-10 REPS (RIR 1)"
                      onBlur={(event) => {
                        const protocol = event.target.value.trim() || null;
                        if (protocol === exercise.protocol) return;
                        onUpdate(exercise.id, {
                          name: exercise.name,
                          protocol,
                          comments: exercise.comments,
                          video: exercise.video,
                        });
                      }}
                      className="min-h-11 w-full rounded-lg border border-iron-700 bg-iron-900 px-3 text-sm text-iron-100 placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
                    />
                  </label>
                </div>

                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => onMove(exercise.id, -1)}
                    disabled={index === 0 || busy || offline}
                    aria-label={`Subir ${exercise.name}`}
                    className="flex size-9 items-center justify-center rounded-lg text-iron-400 hover:bg-iron-800 hover:text-chalk disabled:pointer-events-none disabled:opacity-25"
                  >
                    <Icon name="chevronRight" size={16} className="-rotate-90" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(exercise.id, 1)}
                    disabled={index === day.exercises.length - 1 || busy || offline}
                    aria-label={`Bajar ${exercise.name}`}
                    className="flex size-9 items-center justify-center rounded-lg text-iron-400 hover:bg-iron-800 hover:text-chalk disabled:pointer-events-none disabled:opacity-25"
                  >
                    <Icon name="chevronRight" size={16} className="rotate-90" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  // Deleting takes the logged sets with it, so the warning
                  // says so in the number of series about to disappear.
                  const warning =
                    logged > 0
                      ? `¿Quitar "${exercise.name}"? Se borrarán también ${logged} ${
                          logged === 1 ? 'serie anotada' : 'series anotadas'
                        }.`
                      : `¿Quitar "${exercise.name}" del plan?`;
                  if (confirm(warning)) onRemove(exercise.id);
                }}
                disabled={busy || offline}
                className="mt-2 min-h-9 w-full rounded-lg text-xs font-semibold text-iron-600 hover:bg-iron-800 hover:text-red-300 disabled:pointer-events-none disabled:opacity-40"
              >
                Quitar del plan
                {logged > 0 ? ` (y ${logged} ${logged === 1 ? 'serie' : 'series'})` : ''}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Nombre del ejercicio nuevo</span>
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            maxLength={200}
            placeholder="Añadir un ejercicio…"
            className="min-h-11 w-full rounded-xl border border-iron-700 bg-iron-850 px-3 text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={add}
          disabled={newName.trim() === '' || busy || offline}
          className="min-h-11 shrink-0 rounded-xl bg-signal-500 px-4 text-sm font-bold text-iron-950 hover:bg-signal-400 disabled:pointer-events-none disabled:opacity-40"
        >
          Añadir
        </button>
      </div>

      {offline ? (
        <p role="status" className="text-xs text-signal-300">
          Sin conexión no se puede cambiar el plan. Lo que anotes en las series sí se guarda.
        </p>
      ) : null}
    </section>
  );
}
