import { useEffect, useRef, useState } from 'react';

import * as api from '../../api/client';
import { ApiError, type Profile } from '../../api/client';
import { formatNumber } from '../../domain/calculations';
import { Icon } from './Icon';

/** A best lift nobody has beaten in this long is a stalled lift. */
const STALE_WEEKS = 8;

/**
 * The profile.
 *
 * Answers four questions and stops: who you are, what you have lifted, whether
 * you are training consistently, and where the volume is going. Every number
 * is derived from sets already logged — no field to fill in for the screen to
 * be worth opening.
 */
export function ProfileScreen({ email }: { email: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** False once unmounted, so a slow request cannot set state afterwards. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = () => {
    setError(null);
    api
      .fetchProfile()
      .then((loaded) => {
        if (!alive.current) return;
        setProfile(loaded);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!alive.current) return;
        setError(
          cause instanceof ApiError && cause.isOffline
            ? 'El perfil necesita conexión.'
            : 'No se ha podido cargar el perfil.',
        );
      });
  };

  useEffect(reload, []);

  // Only when there is nothing to show. A refresh that fails after the profile
  // has loaded — saving a name, a passing hiccup — used to replace records,
  // streak and volume with a bare error line that nothing could dismiss.
  if (error && !profile) {
    return (
      <div className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-8 text-center">
        <p role="status" className="text-sm text-iron-400">
          {error}
        </p>
        <button
          type="button"
          onClick={reload}
          className="mt-3 min-h-11 rounded-xl border border-iron-700 px-4 text-sm font-semibold text-iron-100 hover:bg-iron-850"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!profile) {
    return (
      <p role="status" className="px-4 py-8 text-center text-sm text-iron-400">
        Cargando perfil…
      </p>
    );
  }

  const { identity, stats, records, weeklyActivity, streakWeeks, volumeByType, lastSessionAt } =
    profile;

  return (
    <div className="space-y-4">
      {error ? (
        // The profile below is still the last good one; say so rather than
        // replacing it, and leave a way back.
        <p
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-effort-500/30 bg-effort-500/10 px-3 py-2 text-sm text-effort-300"
        >
          {error}
          <button type="button" onClick={reload} className="shrink-0 font-semibold underline">
            Reintentar
          </button>
        </p>
      ) : null}

      <section className="flex items-center gap-4 rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <span
          aria-hidden="true"
          className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-signal-500 font-condensed text-2xl font-bold text-iron-950"
        >
          {initials(identity.displayName)}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-bold text-chalk">{identity.displayName}</h2>
          <p className="truncate text-sm text-iron-400">{email}</p>
          <p className="text-xs text-iron-600">
            Desde {formatMonth(identity.memberSince)}
            {lastSessionAt ? ` · última sesión ${sinceLabel(lastSessionAt)}` : ''}
          </p>
        </div>
      </section>

      <section
        aria-labelledby="totals-title"
        className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
      >
        <h2 id="totals-title" className="eyebrow mb-3 block">
          En total
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Sesiones" value={String(stats.completedSessions)} note="completadas" />
          <Stat
            label="Volumen"
            value={`${Math.round(stats.totalVolumeKg).toLocaleString('es-ES')} kg`}
            note="levantados"
          />
          <Stat label="Ejercicios" value={String(stats.distinctExercises)} note="distintos" />
          <Stat label="Series" value={String(stats.totalSets)} note="registradas" />
        </dl>
      </section>

      <Consistency weeks={weeklyActivity} streak={streakWeeks} />

      {volumeByType.some((entry) => entry.volumeKg > 0) ? (
        <VolumeSplit entries={volumeByType.filter((entry) => entry.volumeKg > 0)} />
      ) : null}

      <section
        aria-labelledby="records-title"
        className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
      >
        <h2 id="records-title" className="mb-1 font-semibold text-chalk">
          Récords personales
        </h2>
        <p className="mb-3 text-xs text-iron-600">
          Mejor 1RM estimado de cada ejercicio, de todos tus programas.
        </p>

        {records.length === 0 ? (
          <p className="py-4 text-center text-sm text-iron-400">
            Cuando registres tu primera serie aparecerán aquí.
          </p>
        ) : (
          <ol className="divide-y divide-iron-800">
            {records.map((record, index) => (
              <li key={record.exercise} className="flex items-baseline gap-3 py-2">
                <span aria-hidden="true" className="figure w-5 shrink-0 text-sm text-iron-600">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-medium text-chalk">
                    {record.exercise}
                  </span>
                  <span className="block text-xs text-iron-600">
                    {record.topWeight !== null ? `tope ${formatNumber(record.topWeight)} kg · ` : ''}
                    {formatMonth(record.achievedAt)}
                  </span>
                  {record.weeksSince >= STALE_WEEKS ? (
                    // Neutral on purpose: red is reserved for effort and
                    // failure, and a lift you have not beaten yet is neither.
                    // The words carry the status, so no colour needs to.
                    <span className="mt-1 inline-block rounded-full border border-iron-700 px-2 py-0.5 text-[11px] font-semibold text-iron-400">
                      sin batir en {record.weeksSince} semanas
                    </span>
                  ) : null}
                </span>
                <span className="figure shrink-0 text-right text-lg font-bold text-chalk">
                  {formatNumber(record.oneRepMax)}
                  <span className="ml-1 text-xs font-normal text-iron-600">kg</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <NameForm displayName={identity.displayName} onSaved={reload} />
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow block">{label}</dt>
      <dd className="mt-0.5">
        <span className="figure block truncate text-xl font-bold text-chalk">{value}</span>
        <span className="block truncate text-xs text-iron-600">{note}</span>
      </dd>
    </div>
  );
}

/**
 * Sessions per week over the last three months.
 *
 * One series, so there is no legend: the heading names it. No number on any
 * bar either — the shape is the message and a value per bar is noise. Weeks
 * without training are drawn as empty slots instead of being skipped, because
 * a chart that hides the weeks you missed reports a habit you do not have.
 */
function Consistency({ weeks, streak }: { weeks: Profile['weeklyActivity']; streak: number }) {
  const peak = Math.max(...weeks.map((week) => week.sessions), 1);
  const trained = weeks.filter((week) => week.sessions > 0).length;
  const first = weeks[0];

  return (
    <section
      aria-labelledby="consistency-title"
      className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="consistency-title" className="font-semibold text-chalk">
          Constancia
        </h2>
        <span className="figure shrink-0 text-2xl font-bold text-chalk">
          {streak}
          <span className="ml-1 text-xs font-normal text-iron-600">
            {streak === 1 ? 'semana seguida' : 'semanas seguidas'}
          </span>
        </span>
      </div>

      <p className="mt-0.5 text-xs text-iron-600">
        Has entrenado {trained} de las últimas {weeks.length} semanas.
      </p>

      <div aria-hidden="true" className="mt-3 flex h-20 items-end gap-[2px]">
        {weeks.map((week) => (
          <span
            key={week.weekStart}
            title={`${formatDay(week.weekStart)}: ${week.sessions} ${
              week.sessions === 1 ? 'sesión' : 'sesiones'
            }`}
            className="flex h-full flex-1 items-end rounded-t-[4px] bg-iron-800/60"
          >
            <span
              className="block w-full rounded-t-[4px] bg-signal-500"
              style={{ height: `${(week.sessions / peak) * 100}%` }}
            />
          </span>
        ))}
      </div>

      <p className="mt-1 flex justify-between text-xs text-iron-600">
        <span>{first ? formatDay(first.weekStart) : ''}</span>
        <span>esta semana</span>
      </p>

      {/* The chart is decorative; this is the same data, readable aloud. */}
      <ul className="sr-only">
        {weeks.map((week) => (
          <li key={week.weekStart}>
            Semana del {formatDay(week.weekStart)}: {week.sessions} sesiones
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Where the volume actually went.
 *
 * Ranked bars in a single tint, with the name beside each. A categorical
 * palette would mean inventing five hues for an app built on one accent, and
 * identity here is carried perfectly well by the label.
 */
function VolumeSplit({ entries }: { entries: Profile['volumeByType'] }) {
  const total = entries.reduce((sum, entry) => sum + entry.volumeKg, 0) || 1;

  return (
    <section
      aria-labelledby="split-title"
      className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
    >
      <h2 id="split-title" className="mb-1 font-semibold text-chalk">
        Reparto del volumen
      </h2>
      <p className="mb-3 text-xs text-iron-600">Por tipo de sesión, de todo lo registrado.</p>

      <ul className="space-y-2.5">
        {entries.map((entry) => (
          <li key={entry.type}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-chalk">{entry.type}</span>
              <span className="figure shrink-0 text-sm text-iron-100">
                {Math.round((entry.volumeKg / total) * 100)}%
                <span className="ml-2 text-xs text-iron-600">
                  {Math.round(entry.volumeKg).toLocaleString('es-ES')} kg
                </span>
              </span>
            </div>
            <span
              aria-hidden="true"
              className="mt-1 block h-2 overflow-hidden rounded-full bg-iron-800"
            >
              <span
                className="block h-full rounded-full bg-signal-500"
                style={{ width: `${(entry.volumeKg / total) * 100}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NameForm({ displayName, onSaved }: { displayName: string; onSaved: () => void }) {
  const [name, setName] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <form
      aria-labelledby="name-title"
      className="space-y-3 rounded-2xl border border-iron-800 bg-iron-900 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setSaved(false);
        api
          .updateProfile({ displayName: name })
          .then(() => {
            setSaved(true);
            onSaved();
          })
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      <label htmlFor="profile-name" className="block">
        <h2 id="name-title" className="mb-1 font-semibold text-chalk">
          Tu nombre
        </h2>
      </label>
      <input
        id="profile-name"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setSaved(false);
        }}
        maxLength={60}
        placeholder="Cómo quieres que te llamemos"
        className="w-full rounded-xl border border-iron-700 bg-iron-850 px-3 py-2.5 text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
      />

      <button
        type="submit"
        disabled={busy || name === displayName}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-iron-700 text-sm font-semibold text-iron-100 hover:bg-iron-850 disabled:opacity-40"
      >
        {saved ? <Icon name="check" size={16} /> : null}
        {busy ? 'Guardando…' : saved ? 'Guardado' : 'Guardar'}
      </button>
    </form>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}

function formatMonth(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/** "hoy", "hace 3 días", "hace 2 semanas" — a raw date needs arithmetic to read. */
function sinceLabel(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / (24 * 60 * 60 * 1000));
  if (!Number.isFinite(days) || days < 0) return '';
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 14) return `hace ${days} días`;
  const weeks = Math.floor(days / 7);
  return weeks < 9 ? `hace ${weeks} semanas` : `hace ${Math.floor(days / 30)} meses`;
}
