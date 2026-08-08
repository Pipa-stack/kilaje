import {
  bestEstimated1RM,
  dayProgress,
  dayVolume,
  daySessionStatus,
  findNextDay,
  formatNumber,
  weekSummary,
  type SessionStatus,
} from '../../domain/calculations';
import type { Day, Week } from '../../domain/types';

interface HomeScreenProps {
  week: Week;
  weekCount: number;
  onOpenDay: (dayNumber: number) => void;
}

/**
 * The app's entry screen: what to train today, how the week is going, and a
 * way into every session.
 *
 * Everything shown is derived from the program already in memory, so opening
 * the app costs one request and no extra round trips.
 */
export function HomeScreen({ week, weekCount, onOpenDay }: HomeScreenProps) {
  const summary = weekSummary(week);
  const nextDay = findNextDay(week);
  const best = bestEstimated1RM(week);

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="week-summary-title"
        className="rounded-2xl border border-ink-800 bg-ink-900 p-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="week-summary-title" className="text-xl font-bold text-ink-50">
            Semana {week.number}
          </h2>
          {weekCount > 1 ? (
            <span className="text-xs text-ink-600">de {weekCount} semanas</span>
          ) : null}
        </div>

        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-ink-400">
            <span>
              {summary.completedDays} de {summary.totalDays} sesiones completadas
            </span>
            <span className="tabular-nums">{Math.round(summary.ratio * 100)}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={summary.completedDays}
            aria-valuemin={0}
            aria-valuemax={summary.totalDays}
            aria-label="Sesiones completadas esta semana"
            className="h-2 overflow-hidden rounded-full bg-ink-800"
          >
            <div
              className="h-full rounded-full bg-success-500 transition-[width] duration-300"
              style={{ width: `${summary.ratio * 100}%` }}
            />
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            label="Volumen"
            value={`${Math.round(summary.volume).toLocaleString('es-ES')} kg`}
            note={
              summary.changePercent !== null
                ? `${summary.changePercent >= 0 ? '+' : ''}${summary.changePercent}% vs. anterior`
                : undefined
            }
            tone={
              summary.changePercent === null
                ? 'neutral'
                : summary.changePercent >= 0
                  ? 'positive'
                  : 'warning'
            }
          />
          <Metric
            label="Ejercicios"
            value={`${summary.startedExercises}/${summary.totalExercises}`}
            note="empezados"
          />
          <Metric
            label="Sesiones"
            value={`${summary.completedDays}/${summary.totalDays}`}
            note={summary.activeDays > 0 ? `${summary.activeDays} en curso` : 'completadas'}
          />
          <Metric
            label="Mejor 1RM"
            value={best ? `${formatNumber(best.oneRepMax)} kg` : '—'}
            note={best ? best.exerciseName : 'sin datos aún'}
          />
        </dl>
      </section>

      {nextDay ? (
        <section aria-labelledby="next-session-title">
          <h2 id="next-session-title" className="sr-only">
            Siguiente sesión
          </h2>
          <button
            type="button"
            onClick={() => onOpenDay(nextDay.number)}
            className="flex w-full items-center gap-4 rounded-2xl bg-accent-500 px-4 py-4 text-left text-white transition-colors hover:bg-accent-400"
          >
            <span className="flex-1">
              <span className="block text-xs font-semibold uppercase tracking-wide text-white/70">
                {daySessionStatus(nextDay) === 'in-progress' ? 'Continuar' : 'Empezar'}
              </span>
              <span className="block text-lg font-bold leading-tight">
                Día {nextDay.number}
                {nextDay.type ? ` · ${nextDay.type}` : ''}
              </span>
              <span className="block text-sm text-white/80">
                {nextDay.exercises.length} ejercicios
              </span>
            </span>
            <span aria-hidden="true" className="text-2xl">
              →
            </span>
          </button>
        </section>
      ) : (
        <p
          role="status"
          className="rounded-2xl border border-success-500/40 bg-success-500/10 px-4 py-4 text-center text-sm font-semibold text-success-300"
        >
          Semana completada. Buen trabajo.
        </p>
      )}

      <section aria-labelledby="days-title">
        <h2 id="days-title" className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-600">
          Sesiones de la semana
        </h2>
        <ul className="space-y-2">
          {week.days.map((day) => (
            <li key={day.id}>
              <DayCard day={day} onOpen={() => onOpenDay(day.number)} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Metric({
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
  const noteColor =
    tone === 'positive' ? 'text-success-300' : tone === 'warning' ? 'text-amber-300' : 'text-ink-600';

  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-ink-600">{label}</dt>
      <dd className="mt-0.5">
        <span className="block truncate text-lg font-bold tabular-nums text-ink-50">{value}</span>
        {note ? <span className={`block truncate text-xs ${noteColor}`}>{note}</span> : null}
      </dd>
    </div>
  );
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  completed: 'Completada',
  'in-progress': 'En curso',
  pending: 'Pendiente',
};

function DayCard({ day, onOpen }: { day: Day; onOpen: () => void }) {
  const status = daySessionStatus(day);
  const progress = dayProgress(day);
  const volume = dayVolume(day);

  // Status is never colour alone: each state carries a word and a mark.
  const marks: Record<SessionStatus, string> = {
    completed: '✓',
    'in-progress': '▪',
    pending: '·',
  };
  const chip =
    status === 'completed'
      ? 'bg-success-500/15 text-success-300'
      : status === 'in-progress'
        ? 'bg-accent-500/15 text-accent-300'
        : 'bg-ink-800 text-ink-400';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors hover:bg-ink-850 ${
        status === 'pending' ? 'border-ink-800 bg-ink-900' : 'border-ink-700 bg-ink-900'
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${chip}`}
      >
        {day.number}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-semibold text-ink-50">
            {/* The number badge is decorative, so the day number is spoken here. */}
            <span className="sr-only">Día {day.number}: </span>
            {day.type ?? `Día ${day.number}`}
          </span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${chip}`}>
            <span aria-hidden="true">{marks[status]} </span>
            {STATUS_LABEL[status]}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-400">
          {progress.startedExercises}/{progress.totalExercises} ejercicios
          {volume > 0 ? ` · ${Math.round(volume).toLocaleString('es-ES')} kg` : ''}
          {day.notes.trim() !== '' ? ' · con notas' : ''}
        </span>
      </span>

      <span aria-hidden="true" className="shrink-0 text-ink-600">
        →
      </span>
    </button>
  );
}
