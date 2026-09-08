import { useEffect, useState } from 'react';

import * as api from '../../api/client';
import { ApiError, type ExerciseHistory, type HistoryEntry } from '../../api/client';
import { formatBestSet } from '../../domain/calculations';
import { Delta, Sparkline, TrendChart } from './Chart';
import { Icon } from './Icon';

/**
 * Progress across programs.
 *
 * A program is one import of one spreadsheet, so a question like "is my bench
 * going up?" only has an answer that spans several of them. Exercises are
 * matched by name, which is the one thing that survives a re-import.
 */
export function HistoryScreen() {
  const [exercises, setExercises] = useState<ExerciseHistory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .fetchHistory()
      .then((found) => {
        if (!cancelled) setExercises(found);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError && cause.isOffline
            ? 'El histórico necesita conexión: se calcula sobre todos tus programas.'
            : 'No se ha podido cargar el histórico.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p role="status" className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-8 text-center text-sm text-iron-400">
        {error}
      </p>
    );
  }

  if (!exercises) {
    return (
      <p role="status" className="px-4 py-8 text-center text-sm text-iron-400">
        Cargando histórico…
      </p>
    );
  }

  if (exercises.length === 0) {
    return (
      <div role="status" className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-12 text-center">
        <Icon name="chart" size={32} className="mx-auto text-iron-600" />
        <h2 className="mt-2 font-semibold text-chalk">Sin histórico todavía</h2>
        <p className="mx-auto mt-1 max-w-xs text-sm text-iron-400">
          Cuando entrenes un ejercicio en más de una semana verás aquí cómo evoluciona.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-sm text-iron-400">
        {exercises.length} {exercises.length === 1 ? 'ejercicio entrenado' : 'ejercicios entrenados'}{' '}
        en todos tus programas. Toca uno para ver su evolución.
      </p>

      <ul className="space-y-2">
        {exercises.map((exercise) => (
          <li key={exercise.name}>
            <ExerciseRow
              exercise={exercise}
              expanded={open === exercise.name}
              onToggle={() => setOpen(open === exercise.name ? null : exercise.name)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExerciseRow({
  exercise,
  expanded,
  onToggle,
}: {
  exercise: ExerciseHistory;
  expanded: boolean;
  onToggle: () => void;
}) {
  const trend = computeTrend(exercise.entries);
  const weights = exercise.entries
    .map((entry) => entry.best?.weight)
    .filter((weight): weight is number => weight !== undefined);

  return (
    <div className="overflow-hidden rounded-2xl border border-iron-800 bg-iron-900">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-iron-850"
      >
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-semibold text-chalk">{exercise.name}</span>
          <span className="mt-0.5 block text-xs text-iron-600">
            {exercise.sessions} {exercise.sessions === 1 ? 'sesión' : 'sesiones'} ·{' '}
            {exercise.programs} {exercise.programs === 1 ? 'programa' : 'programas'} ·{' '}
            {Math.round(exercise.totalVolume).toLocaleString('es-ES')} kg
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="figure block text-lg font-bold text-chalk">
            {formatBestSet(exercise.best)}
          </span>
          <span className="block text-[10px] uppercase tracking-wide text-iron-600">
            mejor serie
          </span>
        </span>

        {weights.length > 1 ? (
          <Sparkline
            values={weights}
            label={`Evolución de ${exercise.name} a lo largo de ${weights.length} sesiones`}
          />
        ) : (
          <span className="w-16 shrink-0" />
        )}

        <span className="w-14 shrink-0 text-right">
          <Delta value={trend} />
        </span>

        <Icon
          name="chevronRight"
          size={18}
          className={`shrink-0 text-iron-600 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded ? <Timeline entries={exercise.entries} /> : null}
    </div>
  );
}

/**
 * Percentage change in the working weight between the first and last session
 * that produced one. `null` when there is nothing to compare.
 */
function computeTrend(entries: HistoryEntry[]): number | null {
  const weights = entries
    .map((entry) => entry.best?.weight)
    .filter((value): value is number => value !== undefined);

  const first = weights[0];
  const last = weights.at(-1);
  if (first === undefined || last === undefined || weights.length < 2 || first === 0) return null;

  return Math.round(((last - first) / first) * 100);
}

/**
 * One exercise, session by session.
 *
 * The line is the answer to "is this going up"; the list under it is the
 * evidence. It used to be only the list — a bar per session, longest wins —
 * which shows which day was heaviest but not whether the last two months went
 * anywhere.
 */
function Timeline({ entries }: { entries: HistoryEntry[] }) {
  const plotted = entries.filter((entry) => entry.best !== null);
  // Newest first in the list: the most recent session is the one you are
  // comparing against. The chart stays chronological, left to right.
  const newestFirst = [...entries].reverse();

  return (
    <div className="border-t border-iron-800 px-4 py-3">
      {plotted.length > 1 ? (
        <div className="mb-4">
          <TrendChart
            label={`Peso de la mejor serie en cada una de las ${plotted.length} sesiones`}
            height={130}
            baseline="fit"
            points={plotted.map((entry) => ({
              label: formatDate(entry.performedAt),
              value: entry.best?.weight ?? 0,
              detail: formatBestSet(entry.best),
            }))}
            format={(value) => `${value} kg`}
          />
        </div>
      ) : null}

      <h3 className="eyebrow mb-2 block">Sesión a sesión</h3>
      <ol className="space-y-2">
        {newestFirst.map((entry, index) => (
          <li
            key={`${entry.programId}-${entry.weekNumber}-${entry.dayNumber}-${index}`}
            className="flex items-baseline gap-3"
          >
            <span className="w-16 shrink-0 text-xs text-iron-600">
              {formatDate(entry.performedAt)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="figure block text-sm text-chalk">{formatBestSet(entry.best)}</span>
              <span className="block text-xs text-iron-600">{describeSets(entry)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** `82.5×4 · 80×8` — how the session actually went. */
function describeSets(entry: HistoryEntry): string {
  const logged = entry.sets
    .filter((set) => set.weight !== null || set.reps !== null)
    .map((set) => `${set.weight ?? '—'}×${set.reps ?? '—'}`);
  return logged.length > 0 ? logged.join(' · ') : 'sin series';
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}
