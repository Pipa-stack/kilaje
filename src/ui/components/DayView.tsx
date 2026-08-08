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
    <div className="space-y-4">
      <section
        aria-label="Resumen del día"
        className="rounded-2xl border border-ink-800 bg-ink-900 p-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold text-ink-50">
            Día {day.number}
            {day.type ? <span className="ml-2 text-base font-medium text-accent-300">{day.type}</span> : null}
          </h2>
          {day.completed ? (
            <span className="shrink-0 rounded-full bg-success-500/15 px-3 py-1 text-xs font-bold text-success-300">
              Completada
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <span className="block text-xs uppercase tracking-wide text-ink-600">Volumen del día</span>
            <span className="text-2xl font-bold tabular-nums text-ink-50">{formatVolume(volume)}</span>
          </div>
          {change !== null ? (
            <span
              className={`pb-1 text-sm font-semibold tabular-nums ${
                change >= 0 ? 'text-success-300' : 'text-amber-300'
              }`}
            >
              {change >= 0 ? '+' : ''}
              {change}% vs. semana anterior
            </span>
          ) : null}
        </div>

        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-ink-400">
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
            className="h-2 overflow-hidden rounded-full bg-ink-800"
          >
            <div
              className="h-full rounded-full bg-accent-500 transition-[width] duration-300"
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

      <section className="rounded-2xl border border-ink-800 bg-ink-900 p-4">
        <label htmlFor={`${day.id}-notes`} className="mb-2 block font-semibold text-ink-50">
          Notas de la sesión
        </label>
        <textarea
          id={`${day.id}-notes`}
          value={day.notes}
          onChange={(event) => onNotesChange(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Sensaciones, molestias, cambios de material…"
          className="w-full resize-y rounded-xl border border-ink-700 bg-ink-850 px-3 py-2 text-ink-50 placeholder:text-ink-600 focus:border-accent-400 focus:outline-none"
        />
      </section>

      <section className="space-y-3 rounded-2xl border border-ink-800 bg-ink-900 p-4">
        <button
          type="button"
          onClick={onToggleCompleted}
          aria-pressed={day.completed}
          className={`min-h-12 w-full rounded-xl px-4 font-bold transition-colors ${
            day.completed
              ? 'bg-success-500/15 text-success-300 hover:bg-success-500/25'
              : 'bg-success-500 text-white hover:bg-success-500/90'
          }`}
        >
          {day.completed ? '✓ Sesión completada — marcar como pendiente' : 'Completar sesión'}
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onNavigate(-1)}
            disabled={!hasPreviousDay}
            className="min-h-12 flex-1 rounded-xl border border-ink-700 px-3 font-semibold text-ink-200 hover:bg-ink-850 disabled:opacity-30"
          >
            ← Día anterior
          </button>
          <button
            type="button"
            onClick={() => onNavigate(1)}
            disabled={!hasNextDay}
            className="min-h-12 flex-1 rounded-xl border border-ink-700 px-3 font-semibold text-ink-200 hover:bg-ink-850 disabled:opacity-30"
          >
            Día siguiente →
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            if (confirm(`¿Borrar todo lo anotado en el día ${day.number}?`)) onResetDay();
          }}
          className="min-h-11 w-full rounded-xl text-sm font-semibold text-ink-600 hover:bg-ink-850 hover:text-ink-400"
        >
          Vaciar los datos de este día
        </button>
      </section>
    </div>
  );
}
