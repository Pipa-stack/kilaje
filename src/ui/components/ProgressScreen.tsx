import { useState } from 'react';

import {
  bestLiftOfWeek,
  exerciseProgress,
  formatBestSet,
  volumeByDay,
  weekSummary,
} from '../../domain/calculations';
import type { Week } from '../../domain/types';
import { Bars, Delta } from './Chart';
import { HistoryScreen } from './HistoryScreen';
import { Icon } from './Icon';
import { MesocycleProgress } from './MesocycleProgress';

interface ProgressScreenProps {
  week: Week;
  /** Every week of the program, for the block view. */
  weeks: Week[];
}

type View = 'week' | 'mesocycle' | 'history';

/**
 * Three questions, three views: how this week is going, whether the block is
 * working, and whether the numbers move across programs.
 */
export function ProgressScreen({ week, weeks }: ProgressScreenProps) {
  const [view, setView] = useState<View>('week');

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Periodo" className="flex gap-2">
        {([
          { id: 'week' as const, label: 'Esta semana' },
          { id: 'mesocycle' as const, label: 'Semanas' },
          { id: 'history' as const, label: 'Histórico' },
        ]).map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setView(option.id)}
            aria-pressed={view === option.id}
            className={`min-h-11 flex-1 rounded-xl border text-sm font-semibold transition-colors ${
              view === option.id
                ? 'border-signal-500 bg-signal-500/10 text-signal-300'
                : 'border-iron-700 text-iron-400 hover:bg-iron-850'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {view === 'week' ? <WeekProgress week={week} /> : null}
      {view === 'mesocycle' ? <MesocycleProgress weeks={weeks} /> : null}
      {view === 'history' ? <HistoryScreen /> : null}
    </div>
  );
}

/** What the week actually produced: volume per session and per exercise. */
function WeekProgress({ week }: { week: Week }) {
  const summary = weekSummary(week);
  const days = volumeByDay(week);
  const exercises = exerciseProgress(week);
  const best = bestLiftOfWeek(week);

  if (summary.startedExercises === 0) {
    return (
      <div role="status" className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-12 text-center">
        <Icon name="chart" size={32} className="mx-auto text-iron-600" />
        <h2 className="mt-2 font-semibold text-chalk">Todavía no hay progreso</h2>
        <p className="mx-auto mt-1 max-w-xs text-sm text-iron-400">
          En cuanto anotes tu primera serie verás aquí el volumen por sesión y tus mejores
          levantamientos.
        </p>
      </div>
    );
  }

  const heaviestVolume = Math.max(...exercises.map((row) => row.volume), 1);

  return (
    <div className="space-y-4">
      {/* The headline is one number and its direction. Four equal tiles made
          the reader hunt for which one mattered; the volume and whether it is
          climbing is the answer to "how is the week going". */}
      <section
        aria-labelledby="totals-title"
        className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="totals-title" className="text-sm font-semibold text-chalk">
            Semana {week.number}
          </h2>
          <span className="text-xs text-iron-600">
            {summary.completedDays}/{summary.totalDays} sesiones completadas
          </span>
        </div>

        <div className="mt-1 flex items-baseline gap-3">
          <span className="figure text-4xl font-bold text-chalk">
            {Math.round(summary.volume).toLocaleString('es-ES')} kg
          </span>
          <Delta value={summary.changePercent} />
        </div>
        <p className="text-xs text-iron-600">
          de volumen{summary.changePercent !== null ? ' frente a la semana anterior' : ''}
        </p>

        <div className="mt-4">
          <h3 className="eyebrow mb-2 block">Volumen por sesión</h3>
          <Bars
            label={`Volumen de cada sesión de la semana ${week.number}`}
            legend={{ done: 'completada', pending: 'sin terminar' }}
            format={(value) => Math.round(value).toLocaleString('es-ES')}
            points={days.map((day) => ({
              label: `D${day.dayNumber}`,
              value: day.volume,
              done: day.completed,
            }))}
          />
        </div>
      </section>

      {best ? (
        <section
          aria-label="Mejor levantamiento de la semana"
          className="flex items-center gap-3 rounded-2xl border border-signal-500/30 bg-signal-500/5 px-4 py-3"
        >
          <Icon name="star" size={20} className="shrink-0 text-signal-400" />
          <div className="min-w-0">
            <span className="eyebrow block">Lo más pesado de la semana</span>
            <span className="figure block text-lg font-bold text-chalk">
              {formatBestSet(best.best)}
            </span>
            <span className="line-clamp-1 text-xs text-iron-400">{best.exerciseName}</span>
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="by-exercise-title"
        className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
      >
        <h2 id="by-exercise-title" className="mb-1 text-sm font-semibold text-chalk">
          Ejercicios entrenados
        </h2>
        <p className="mb-3 text-xs text-iron-600">Ordenados por volumen acumulado.</p>

        <ul className="space-y-2.5">
          {exercises.map((row) => (
            <li key={row.exerciseId}>
              <div className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-chalk">
                  {row.name}
                </span>
                <span className="figure shrink-0 text-sm font-semibold tabular-nums text-chalk">
                  {formatBestSet(row.best)}
                </span>
              </div>
              {/* The bar is the comparison; the figures beside it are the
                  values. Neither has to be read to get the other. */}
              <div className="mt-1 flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-iron-850"
                >
                  <span
                    className="block h-full rounded-full bg-signal-500/70"
                    style={{ width: `${Math.max((row.volume / heaviestVolume) * 100, 3)}%` }}
                  />
                </span>
                <span className="figure w-28 shrink-0 text-right text-xs text-iron-600">
                  {Math.round(row.volume).toLocaleString('es-ES')} kg · {row.loggedSets}{' '}
                  {row.loggedSets === 1 ? 'serie' : 'series'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
