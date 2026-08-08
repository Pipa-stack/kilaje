import {
  bestEstimated1RM,
  exerciseProgress,
  formatNumber,
  volumeByDay,
  weekSummary,
} from '../../domain/calculations';
import type { Week } from '../../domain/types';

interface ProgressScreenProps {
  week: Week;
}

/** What the week actually produced: volume per session and per exercise. */
export function ProgressScreen({ week }: ProgressScreenProps) {
  const summary = weekSummary(week);
  const days = volumeByDay(week);
  const exercises = exerciseProgress(week);
  const best = bestEstimated1RM(week);
  const peak = Math.max(...days.map((day) => day.volume), 1);

  if (summary.startedExercises === 0) {
    return (
      <div role="status" className="rounded-2xl border border-ink-800 bg-ink-900 px-4 py-12 text-center">
        <p aria-hidden="true" className="text-3xl">
          📈
        </p>
        <h2 className="mt-2 font-semibold text-ink-50">Todavía no hay progreso</h2>
        <p className="mx-auto mt-1 max-w-xs text-sm text-ink-400">
          En cuanto anotes tu primera serie verás aquí el volumen por sesión y tus mejores
          levantamientos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="totals-title"
        className="rounded-2xl border border-ink-800 bg-ink-900 p-4"
      >
        <h2 id="totals-title" className="text-lg font-bold text-ink-50">
          Semana {week.number}
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Stat label="Volumen total" value={`${Math.round(summary.volume).toLocaleString('es-ES')} kg`} />
          <Stat
            label="Frente a la anterior"
            value={summary.changePercent === null ? '—' : `${summary.changePercent >= 0 ? '+' : ''}${summary.changePercent}%`}
            tone={
              summary.changePercent === null
                ? 'neutral'
                : summary.changePercent >= 0
                  ? 'positive'
                  : 'warning'
            }
          />
          <Stat label="Sesiones completadas" value={`${summary.completedDays}/${summary.totalDays}`} />
          <Stat
            label="Mejor 1RM estimado"
            value={best ? `${formatNumber(best.oneRepMax)} kg` : '—'}
            note={best?.exerciseName}
          />
        </dl>
      </section>

      <section
        aria-labelledby="by-day-title"
        className="rounded-2xl border border-ink-800 bg-ink-900 p-4"
      >
        <h2 id="by-day-title" className="mb-3 text-sm font-semibold text-ink-50">
          Volumen por sesión
        </h2>
        <ul className="space-y-2">
          {days.map((day) => (
            <li key={day.dayNumber} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-xs font-semibold text-ink-400">
                Día {day.dayNumber}
              </span>
              {/* The bar is decorative; the figure beside it carries the value. */}
              <span aria-hidden="true" className="h-3 flex-1 overflow-hidden rounded-full bg-ink-800">
                <span
                  className={`block h-full rounded-full ${
                    day.completed ? 'bg-success-500' : 'bg-accent-500'
                  }`}
                  style={{ width: `${Math.max((day.volume / peak) * 100, day.volume > 0 ? 4 : 0)}%` }}
                />
              </span>
              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-ink-200">
                {day.volume > 0 ? `${Math.round(day.volume).toLocaleString('es-ES')} kg` : '—'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="by-exercise-title"
        className="rounded-2xl border border-ink-800 bg-ink-900 p-4"
      >
        <h2 id="by-exercise-title" className="mb-1 text-sm font-semibold text-ink-50">
          Ejercicios entrenados
        </h2>
        <p className="mb-3 text-xs text-ink-600">Ordenados por volumen acumulado.</p>

        <ul className="divide-y divide-ink-800">
          {exercises.map((row) => (
            <li key={row.exerciseId} className="flex items-baseline gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-50">{row.name}</span>
                <span className="block text-xs text-ink-600">
                  Día {row.dayNumber} · {row.loggedSets}{' '}
                  {row.loggedSets === 1 ? 'serie' : 'series'}
                  {row.topWeight !== null ? ` · tope ${formatNumber(row.topWeight)} kg` : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums text-ink-50">
                  {Math.round(row.volume).toLocaleString('es-ES')} kg
                </span>
                {row.oneRepMax !== null ? (
                  <span className="block text-xs tabular-nums text-ink-600">
                    1RM {formatNumber(row.oneRepMax)}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'neutral' | 'positive' | 'warning';
}) {
  const color =
    tone === 'positive' ? 'text-success-300' : tone === 'warning' ? 'text-amber-300' : 'text-ink-50';

  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-ink-600">{label}</dt>
      <dd className={`mt-0.5 truncate text-lg font-bold tabular-nums ${color}`}>
        {value}
        {note ? <span className="block truncate text-xs font-normal text-ink-600">{note}</span> : null}
      </dd>
    </div>
  );
}
