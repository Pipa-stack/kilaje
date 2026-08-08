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
import { Icon } from './Icon';

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
        className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="week-summary-title" className="text-xl font-bold text-chalk">
            Semana {week.number}
          </h2>
          {weekCount > 1 ? (
            <span className="text-xs text-iron-600">de {weekCount} semanas</span>
          ) : null}
        </div>

        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-iron-400">
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
            className="h-2 overflow-hidden rounded-full bg-iron-800"
          >
            <div
              className="h-full rounded-full bg-done-500 transition-[width] duration-300"
              style={{ width: `${summary.ratio * 100}%` }}
            />
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            lead
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
            className="flex w-full items-center gap-4 rounded-2xl bg-signal-500 px-4 py-4 text-left text-iron-950 transition-colors hover:bg-signal-400"
          >
            <span className="flex-1">
              <span className="eyebrow block text-iron-950/70">
                {daySessionStatus(nextDay) === 'in-progress' ? 'Continuar' : 'Empezar'}
              </span>
              <span className="block font-condensed text-2xl font-bold uppercase leading-none tracking-tight">
                Día {nextDay.number}
                {nextDay.type ? ` · ${nextDay.type}` : ''}
              </span>
              <span className="block text-sm font-medium text-iron-950/70">
                {nextDay.exercises.length} ejercicios
              </span>
            </span>
            <Icon name="chevronRight" size={24} className="shrink-0" />
          </button>
        </section>
      ) : (
        <p
          role="status"
          className="rounded-2xl border border-done-500/40 bg-done-500/10 px-4 py-4 text-center text-sm font-semibold text-done-300"
        >
          Semana completada. Buen trabajo.
        </p>
      )}

      <section aria-labelledby="days-title">
        <h2 id="days-title" className="eyebrow mb-2 block px-1">
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
  lead = false,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'neutral' | 'positive' | 'warning';
  /** The one figure that carries the week. The rest is context. */
  lead?: boolean;
}) {
  const noteColor =
    tone === 'positive' ? 'text-done-300' : tone === 'warning' ? 'text-amber-300' : 'text-iron-600';

  return (
    <div className="min-w-0">
      <dt className="eyebrow block">{label}</dt>
      <dd className="mt-0.5">
        <span
          className={`figure block truncate font-bold ${
            lead ? 'text-3xl text-chalk' : 'text-xl text-iron-100'
          }`}
        >
          {value}
        </span>
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

  // Status is never colour alone: the word carries it on its own.
  const chip =
    status === 'completed'
      ? 'bg-done-500/15 text-done-300'
      : status === 'in-progress'
        ? 'bg-signal-500/15 text-signal-300'
        : 'bg-iron-800 text-iron-400';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors hover:bg-iron-850 ${
        status === 'pending' ? 'border-iron-800 bg-iron-900' : 'border-iron-700 bg-iron-900'
      }`}
    >
      <span
        aria-hidden="true"
        className={`figure flex size-11 shrink-0 items-center justify-center rounded-xl text-xl font-bold ${chip}`}
      >
        {day.number}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="line-clamp-2 font-semibold text-chalk">
            {/* The number badge is decorative, so the day number is spoken here. */}
            <span className="sr-only">Día {day.number}: </span>
            {day.type ?? `Día ${day.number}`}
          </span>
          <span
            className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${chip}`}
          >
            {status === 'completed' ? <Icon name="check" size={12} /> : null}
            {STATUS_LABEL[status]}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-iron-400">
          {progress.startedExercises}/{progress.totalExercises} ejercicios
          {volume > 0 ? ` · ${Math.round(volume).toLocaleString('es-ES')} kg` : ''}
          {day.notes.trim() !== '' ? ' · con notas' : ''}
        </span>
      </span>

      <Icon name="chevronRight" size={20} className="shrink-0 text-iron-600" />
    </button>
  );
}
