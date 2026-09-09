import {
  exerciseTrends,
  formatBestSet,
  formatNumber,
  topWeights,
  volumeByWeek,
  type ExerciseTrend,
} from '../../domain/calculations';
import type { Week } from '../../domain/types';
import { kilos } from '../format';
import { Delta, Sparkline, TrendChart } from './Chart';
import { Icon } from './Icon';

interface MesocycleProgressProps {
  weeks: Week[];
}

/**
 * The whole program, week by week.
 *
 * "Esta semana" answers whether today went well; this answers whether the
 * block is working — the question a mesocycle exists to ask. It used to
 * answer it with a column of horizontal bars and a wall of chips, which is
 * the data without the shape: you had to read every number and hold them in
 * your head to see a trend that a line states in one glance.
 */
export function MesocycleProgress({ weeks }: MesocycleProgressProps) {
  const rows = volumeByWeek(weeks);
  const trends = exerciseTrends(weeks);
  const trained = rows.filter((row) => row.volume > 0);

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

  const last = trained.at(-1);
  const climbing = trends.filter((trend) => (trend.weightGain ?? 0) > 0).length;

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="weeks-title"
        className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="weeks-title" className="text-sm font-semibold text-chalk">
            Volumen por semana
          </h2>
          <Delta value={last?.changePercent ?? null} />
        </div>

        <TrendChart
          label={`Volumen de cada semana del programa, de la semana ${rows[0]?.number ?? 1} a la ${
            rows.at(-1)?.number ?? 1
          }`}
          points={trained.map((row) => ({
            label: `S${row.number}`,
            value: row.volume,
            detail: `${row.completedDays}/${row.totalDays} sesiones`,
          }))}
          format={kilos}
        />

        <p className="mt-1 text-xs text-iron-600">
          {trained.length} {trained.length === 1 ? 'semana entrenada' : 'semanas entrenadas'} de{' '}
          {rows.length}. Toca un punto para ver esa semana.
        </p>
      </section>

      <section
        aria-labelledby="trends-title"
        className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
      >
        <h2 id="trends-title" className="mb-1 text-sm font-semibold text-chalk">
          Cada ejercicio, semana a semana
        </h2>
        <p className="mb-3 text-xs text-iron-600">
          {climbing > 0
            ? `${climbing} ${climbing === 1 ? 'ejercicio sube' : 'ejercicios suben'} de peso en el bloque.`
            : 'El peso más alto que moviste cada semana.'}
        </p>

        <ul className="divide-y divide-iron-800">
          {trends.map((trend) => (
            <TrendRow key={trend.key} trend={trend} />
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * One movement across the block: name, shape, and where it ended up.
 *
 * The sparkline is the point of the row — twenty of these scroll past and the
 * three that are climbing announce themselves without a number being read.
 */
function TrendRow({ trend }: { trend: ExerciseTrend }) {
  const weights = topWeights(trend.points);
  const latest = trend.points.at(-1)?.best ?? null;

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="line-clamp-1 text-sm font-medium text-chalk">{trend.name}</span>
        <span className="block text-xs text-iron-600">
          {trend.points.length} {trend.points.length === 1 ? 'semana' : 'semanas'} ·{' '}
          {formatBestSet(latest)}
        </span>
      </span>

      {weights.length > 1 ? (
        <Sparkline
          values={weights}
          label={`Evolución del peso de ${trend.name}: ${weights.map(formatNumber).join(', ')} kg`}
        />
      ) : (
        <span className="w-16" />
      )}

      <span className="w-16 shrink-0 text-right">
        {trend.weightGain !== null ? (
          <Delta value={trend.weightGain} unit=" kg" />
        ) : (
          <span className="text-xs text-iron-600">1ª vez</span>
        )}
      </span>
    </li>
  );
}
