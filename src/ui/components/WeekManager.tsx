import { useState } from 'react';

import type { Week } from '../../domain/types';
import { Icon } from './Icon';

interface WeekManagerProps {
  weeks: Week[];
  currentWeek: Week;
  busy: boolean;
  offline: boolean;
  onSelectWeek: (weekNumber: number) => void;
  onAddWeek: (options: { copyWeights: boolean }) => void;
  onDeleteWeek: (weekNumber: number) => void;
}

/**
 * The week strip, plus the two things you can do to a week.
 *
 * The panel is collapsed by default: starting a week is a once-a-week action
 * and deleting one is rarer still, so neither earns permanent space above a
 * screen used between sets.
 */
export function WeekManager({
  weeks,
  currentWeek,
  busy,
  offline,
  onSelectWeek,
  onAddWeek,
  onDeleteWeek,
}: WeekManagerProps) {
  const [open, setOpen] = useState(false);

  const nextNumber = (weeks.at(-1)?.number ?? 0) + 1;
  const last = weeks.at(-1);
  // Only the last week can go, and never the only one: deleting from the
  // middle would leave a gap the week numbers cannot express.
  const removable = weeks.length > 1 && last ? last.number : null;

  return (
    <nav aria-label="Semanas">
      <ul data-no-swipe className="flex gap-2 overflow-x-auto pb-1">
        {weeks.map((candidate) => (
          <li key={candidate.number}>
            <button
              type="button"
              onClick={() => onSelectWeek(candidate.number)}
              aria-current={candidate.number === currentWeek.number ? 'true' : undefined}
              className={`min-h-11 whitespace-nowrap rounded-xl px-4 text-sm font-semibold ${
                candidate.number === currentWeek.number
                  ? 'bg-iron-700 text-chalk'
                  : 'bg-iron-900 text-iron-400 hover:bg-iron-850'
              }`}
            >
              Semana {candidate.number}
            </button>
          </li>
        ))}

        <li>
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls="week-manager-panel"
            className="flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-xl border border-dashed border-iron-700 px-4 text-sm font-semibold text-iron-400 hover:border-iron-600 hover:bg-iron-850 hover:text-iron-100"
          >
            <Icon name="chevronRight" size={14} className={open ? '-rotate-90' : 'rotate-90'} />
            Gestionar semanas
          </button>
        </li>
      </ul>

      {open ? (
        <div
          id="week-manager-panel"
          data-no-swipe
          className="mt-2 space-y-2 rounded-2xl border border-iron-800 bg-iron-900 p-3"
        >
          <p className="text-xs text-iron-400">
            El Excel solo trae las semanas que tuviera escritas. Aquí empiezas la siguiente
            sin volver a importar nada.
          </p>

          <button
            type="button"
            onClick={() => onAddWeek({ copyWeights: false })}
            disabled={busy || offline}
            className="min-h-11 w-full rounded-xl bg-signal-500 px-4 text-sm font-bold text-iron-950 hover:bg-signal-400 disabled:pointer-events-none disabled:opacity-40"
          >
            {busy ? 'Creando…' : `Empezar la semana ${nextNumber} en blanco`}
          </button>

          <button
            type="button"
            onClick={() => onAddWeek({ copyWeights: true })}
            disabled={busy || offline}
            className="min-h-11 w-full rounded-xl border border-iron-700 px-4 text-sm font-semibold text-iron-100 hover:bg-iron-850 disabled:pointer-events-none disabled:opacity-40"
          >
            Empezar la semana {nextNumber} con los pesos de la {nextNumber - 1}
          </button>

          <p className="text-xs text-iron-600">
            Los pesos se copian, las repeticiones no: hasta que no anotes las reps, esa
            serie no cuenta como entrenada.
          </p>

          {removable !== null ? (
            <button
              type="button"
              onClick={() => {
                if (confirm(`¿Borrar la semana ${removable}?`)) onDeleteWeek(removable);
              }}
              disabled={busy || offline}
              className="min-h-11 w-full rounded-xl text-sm font-semibold text-iron-600 hover:bg-iron-850 hover:text-red-300 disabled:pointer-events-none disabled:opacity-40"
            >
              Borrar la semana {removable}
            </button>
          ) : null}

          {offline ? (
            <p role="status" className="text-xs text-signal-300">
              Sin conexión no se pueden crear ni borrar semanas.
            </p>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
