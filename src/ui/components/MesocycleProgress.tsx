import {
  exerciseTrends,
  formatNumber,
  volumeByWeek,
  type ExerciseTrend,
} from '../../domain/calculations';
import type { Week } from '../../domain/types';
import { Icon } from './Icon';

interface MesocycleProgressProps {
  weeks: Week[];
}

/**
 * The whole program, week by week.
 *
 * "Esta semana" answers whether today went well; this answers whether the
 * block is working — which is the question a mesocycle exists to ask, and the
 * one the app could not answer while a program was a single imported week.
 */
export function MesocycleProgress({ weeks }: MesocycleProgressProps) {
  const rows = volumeByWeek(weeks);
  const trends = exerciseTrends(weeks);
  const trained = rows.filter((row) => row.volume > 0);
  const peak = Math.max(...rows.map((row) => row.volume), 1);

  if (trained.length === 0) {
    return (
      <div role="status" className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-12 text-center">
        <Icon name="chart" size={32} className="mx-auto text-iron-600" />
        <h2 className="mt-2 font-semibold text-chalk">Aún no hay semanas que comparar</h2>
        <p className="mx-auto mt-1 max-w-xs text-sm text-iron-400">
          Cuando entrenes al menos una semana verás aquí cómo evoluciona el volumen y el
          peso de cada ejercicio.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="weeks-title"
        className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
      >
        <h2 id="weeks-title" className="mb-1 text-sm font-semibold text-chalk">
          Volumen por semana
        </h2>
        <p className="mb-3 text-xs text-iron-600">
          {trained.length} {trained.length === 1 ? 'semana entrenada' : 'semanas entrenadas'} de{' '}
          {rows.length}.
        </p>

        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.number} className="flex items-center gap-3">
              <span className="figure w-20 shrink-0 text-sm font-semibold text-iron-400">
                Semana {row.number}
              </span>
              <span aria-hidden="true" className="h-3 flex-1 overflow-hidden rounded-full bg-iron-800">
                <span
                  className={`block h-full rounded-full ${
                    row.completedDays === row.totalDays && row.totalDays > 0
                      ? 'bg-done-500'
                      : 'bg-signal-500'
                  }`}
                  style={{ width: `${Math.max((row.volume / peak) * 100, row.volume > 0 ? 4 : 0)}%` }}
                />
              </span>
              <span className="w-28 shrink-0 text-right">
                <span className="figure block text-sm text-iron-100">
                  {row.volume > 0 ? `${Math.round(row.volume).toLocaleString('es-ES')} kg` : '—'}
                </span>
                {row.changePercent !== null ? (
                  <span
                    className={`block text-xs tabular-nums ${
                      row.changePercent >= 0 ? 'text-done-300' : 'text-amber-300'
                    }`}
                  >
                    {row.changePercent >= 0 ? '+' : ''}
                    {row.changePercent}%
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="trends-title"
        className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
      >
        <h2 id="trends-title" className="mb-1 text-sm font-semibold text-chalk">
          Cada ejercicio, semana a semana
        </h2>
        <p className="mb-3 text-xs text-iron-600">
          El peso más alto que moviste cada semana. Las semanas sin anotar no aparecen.
        </p>

        <ul className="divide-y divide-iron-800">
          {trends.map((trend) => (
            <TrendRow key={trend.name} trend={trend} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function TrendRow({ trend }: { trend: ExerciseTrend }) {
  return (
    <li className="py-3">
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-chalk">{trend.name}</span>
        {trend.weightGain !== null && trend.weightGain !== 0 ? (
          <span
            className={`shrink-0 text-xs font-semibold tabular-nums ${
              trend.weightGain > 0 ? 'text-done-300' : 'text-amber-300'
            }`}
          >
            {trend.weightGain > 0 ? '+' : ''}
            {formatNumber(trend.weightGain)} kg
          </span>
        ) : null}
      </div>

      <ol className="mt-1.5 flex flex-wrap gap-1.5">
        {trend.points.map((point) => (
          <li
            key={point.weekNumber}
            className="rounded-lg bg-iron-850 px-2 py-1 text-xs tabular-nums text-iron-100"
            title={`Semana ${point.weekNumber}: ${Math.round(point.volume).toLocaleString('es-ES')} kg de volumen`}
          >
            <span className="text-iron-600">S{point.weekNumber}</span>{' '}
            {point.topWeight !== null ? `${formatNumber(point.topWeight)} kg` : '—'}
          </li>
        ))}
      </ol>
    </li>
  );
}
