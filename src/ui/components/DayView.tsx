import {
  dayPreviousVolume,
  dayProgress,
  dayVolume,
  formatVolume,
  volumeChangePercent,
} from '../../domain/calculations';
import type { SetPatch } from '../../domain/mutations';
import type { Day } from '../../domain/types';
import { ExerciseCard } from './ExerciseCard';
import { Icon } from './Icon';

interface DayViewProps {
  day: Day;
  hasPreviousDay: boolean;
  hasNextDay: boolean;
  onNavigate: (offset: number) => void;
  onUpdateSet: (exerciseId: string, setIndex: number, patch: SetPatch) => void;
  onAddSet: (exerciseId: string) => void;
  onRemoveSet: (exerciseId: string, setIndex: number) => void;
  onNotesChange: (notes: string) => void;
  onToggleCompleted: () => void;
  onResetDay: () => void;
}

export function DayView({
  day,
  hasPreviousDay,
  hasNextDay,
  onNavigate,
  onUpdateSet,
  onAddSet,
  onRemoveSet,
  onNotesChange,
  onToggleCompleted,
  onResetDay,
}: DayViewProps) {
  const volume = dayVolume(day);
  const previousVolume = dayPreviousVolume(day);
  const change = volumeChangePercent(volume, previousVolume);
  const progress = dayProgress(day);

  return (
    <div key={day.id} className="day-enter space-y-4">
      <section
        aria-label="Resumen del día"
        className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold text-chalk">
            Día {day.number}
            {day.type ? <span className="ml-2 text-base font-medium text-signal-300">{day.type}</span> : null}
          </h2>
          {day.completed ? (
            <span className="shrink-0 rounded-full bg-done-500/15 px-3 py-1 text-xs font-bold text-done-300">
              Completada
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <span className="eyebrow block">Volumen del día</span>
            <span className="figure text-4xl font-bold text-chalk">{formatVolume(volume)}</span>
          </div>
          {change !== null ? (
            <span
              className={`pb-1 text-sm font-semibold tabular-nums ${
                change >= 0 ? 'text-done-300' : 'text-amber-300'
              }`}
            >
              {change >= 0 ? '+' : ''}
              {change}% vs. semana anterior
            </span>
          ) : null}
        </div>

        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-iron-400">
            <span>
              {progress.startedExercises} de {progress.totalExercises} ejercicios
            </span>
            <span className="tabular-nums">{Math.round(progress.ratio * 100)}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={progress.startedExercises}
            aria-valuemin={0}
            aria-valuemax={progress.totalExercises}
            aria-label="Ejercicios empezados"
            className="h-2 overflow-hidden rounded-full bg-iron-800"
          >
            <div
              className="h-full rounded-full bg-signal-500 transition-[width] duration-300"
              style={{ width: `${progress.ratio * 100}%` }}
            />
          </div>
        </div>
      </section>

      <ol className="space-y-4">
        {day.exercises.map((exercise) => (
          <li key={exercise.id}>
            <ExerciseCard
              exercise={exercise}
              onUpdateSet={onUpdateSet}
              onAddSet={onAddSet}
              onRemoveSet={onRemoveSet}
            />
          </li>
        ))}
      </ol>

      <section className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <label htmlFor={`${day.id}-notes`} className="mb-2 block font-semibold text-chalk">
          Notas de la sesión
        </label>
        <textarea
          id={`${day.id}-notes`}
          value={day.notes}
          onChange={(event) => onNotesChange(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Sensaciones, molestias, cambios de material…"
          className="w-full resize-y rounded-xl border border-iron-700 bg-iron-850 px-3 py-2 text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
        />
      </section>

      <section className="space-y-3 rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <button
          type="button"
          onClick={onToggleCompleted}
          aria-pressed={day.completed}
          className={`min-h-12 w-full rounded-xl px-4 font-bold transition-colors ${
            day.completed
              ? 'bg-done-500/15 text-done-300 hover:bg-done-500/25'
              : 'bg-done-500 text-white hover:bg-done-500/90'
          }`}
        >
          {day.completed ? (
            <span className="flex items-center justify-center gap-2">
              <Icon name="check" size={18} />
              Sesión completada — marcar como pendiente
            </span>
          ) : (
            'Completar sesión'
          )}
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onNavigate(-1)}
            disabled={!hasPreviousDay}
            className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-iron-700 px-3 font-semibold text-iron-100 hover:bg-iron-850 disabled:opacity-30"
          >
            <Icon name="chevronRight" size={18} className="rotate-180" />
            Día anterior
          </button>
          <button
            type="button"
            onClick={() => onNavigate(1)}
            disabled={!hasNextDay}
            className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-iron-700 px-3 font-semibold text-iron-100 hover:bg-iron-850 disabled:opacity-30"
          >
            Día siguiente
            <Icon name="chevronRight" size={18} />
          </button>
        </div>

        <p className="text-center text-xs text-iron-600">
          También puedes deslizar a los lados para cambiar de día.
        </p>

        <button
          type="button"
          onClick={() => {
            if (confirm(`¿Borrar todo lo anotado en el día ${day.number}?`)) onResetDay();
          }}
          className="min-h-11 w-full rounded-xl text-sm font-semibold text-iron-600 hover:bg-iron-850 hover:text-iron-400"
        >
          Vaciar los datos de este día
        </button>
      </section>
    </div>
  );
}
