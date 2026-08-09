import { useEffect, useState } from 'react';

import * as api from '../../api/client';
import { ApiError, type ExerciseHistory, type HistoryEntry } from '../../api/client';
import { formatNumber } from '../../domain/calculations';
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
            {exercise.bestOneRepMax !== null ? `${formatNumber(exercise.bestOneRepMax)}` : '—'}
          </span>
          <span className="block text-[10px] uppercase tracking-wide text-iron-600">
            mejor 1RM
          </span>
        </span>

        {trend !== null ? (
          <span
            className={`figure w-14 shrink-0 text-right text-sm font-semibold ${
              trend >= 0 ? 'text-done-300' : 'text-effort-300'
            }`}
          >
            {trend >= 0 ? '+' : ''}
            {trend}%
          </span>
        ) : (
          <span className="w-14 shrink-0" />
        )}

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
 * Percentage change in estimated 1RM between the first and last session that
 * produced one. `null` when there is nothing to compare.
 */
function computeTrend(entries: HistoryEntry[]): number | null {
  const maxes = entries
    .map((entry) => entry.oneRepMax)
    .filter((value): value is number => value !== null);

  const first = maxes[0];
  const last = maxes.at(-1);
  if (first === undefined || last === undefined || maxes.length < 2 || first === 0) return null;

  return Math.round(((last - first) / first) * 100);
}

function Timeline({ entries }: { entries: HistoryEntry[] }) {
  const peak = Math.max(...entries.map((entry) => entry.oneRepMax ?? 0), 1);
  // Newest first: the last session is the one being compared against.
  const newestFirst = [...entries].reverse();

  return (
    <div className="border-t border-iron-800 px-4 py-3">
      <h3 className="eyebrow mb-2 block">Sesión a sesión</h3>
      <ol className="space-y-2">
        {newestFirst.map((entry, index) => (
          <li key={`${entry.programId}-${entry.weekNumber}-${entry.dayNumber}-${index}`}>
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-iron-600">
                {formatDate(entry.performedAt)}
              </span>

              <span aria-hidden="true" className="h-2.5 flex-1 overflow-hidden rounded-full bg-iron-800">
                <span
                  className="block h-full rounded-full bg-signal-500"
                  style={{ width: `${((entry.oneRepMax ?? 0) / peak) * 100}%` }}
                />
              </span>

              <span className="figure w-16 shrink-0 text-right text-sm text-chalk">
                {entry.oneRepMax !== null ? `${formatNumber(entry.oneRepMax)} kg` : '—'}
              </span>
            </div>

            <p className="mt-0.5 pl-20 text-xs text-iron-600">
              {entry.programName} · semana {entry.weekNumber}, día {entry.dayNumber} ·{' '}
              {describeSets(entry)}
            </p>
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
