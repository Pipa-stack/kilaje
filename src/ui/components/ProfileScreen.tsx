import { useEffect, useRef, useState } from 'react';

import * as api from '../../api/client';
import { ApiError, type Profile } from '../../api/client';
import { formatBestSet, formatDuration } from '../../domain/calculations';
import { Icon } from './Icon';
import { LiftsScreen } from './LiftsScreen';

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
interface ProfileScreenProps {
  email: string;
  /** Opens the settings screen, which used to be stapled below this one. */
  onOpenSettings: () => void;
}

export function ProfileScreen({ email, onOpenSettings }: ProfileScreenProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A view of the profile rather than a fifth tab: four tabs are what fits
  // comfortably under a thumb, and this is somewhere you visit, not somewhere
  // you live.
  const [showingLifts, setShowingLifts] = useState(false);

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

  if (showingLifts) return <LiftsScreen onBack={() => setShowingLifts(false)} />;

  // Records set in the last seven days. `weeksSince` counts whole weeks, so
  // zero is "this week" — the window in which a record is still news.
  const fresh = records.filter((record) => record.weeksSince === 0);

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

      <section className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-signal-500 font-condensed text-2xl font-bold text-iron-950"
          >
            {initials(identity.displayName)}
          </span>

          <div className="min-w-0 flex-1">
            <NameField displayName={identity.displayName} onSaved={reload} />
            <p className="truncate text-sm text-iron-400">{email}</p>
            {/* Wraps rather than truncates: with a long month and a recent
                session this is two lines, and cutting it with an ellipsis
                loses the half that says when you last trained. */}
            <p className="text-xs leading-snug text-iron-600">
              Desde {formatMonth(identity.memberSince)}
              {lastSessionAt ? ` · última sesión ${sinceLabel(lastSessionAt)}` : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenSettings}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-iron-400 hover:bg-iron-850 hover:text-iron-100"
          >
            <Icon name="sliders" size={20} />
            <span className="sr-only">Ajustes</span>
          </button>
        </div>

        {/* The one line in the app that talks to you rather than reporting at
            you. Everything else here is a figure; this says what the figures
            add up to, which is the thing you actually came to find out. */}
        <p className="mt-3 border-t border-iron-800 pt-3 text-sm text-iron-100">
          {greet(profile)}
        </p>
      </section>

      {fresh.length > 0 ? <FreshRecords records={fresh} /> : null}

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
            // A lifetime total is a number nobody has a feel for. Per session
            // is one you can compare against the session you just did.
            note={
              stats.startedSessions > 0
                ? `${Math.round(
                    stats.totalVolumeKg / stats.startedSessions,
                  ).toLocaleString('es-ES')} kg por sesión`
                : 'levantados'
            }
          />
          <Stat label="Ejercicios" value={String(stats.distinctExercises)} note="distintos" />
          <Stat
            label="Duración"
            value={
              stats.averageSessionSeconds === null
                ? '—'
                : formatDuration(stats.averageSessionSeconds)
            }
            note={
              stats.averageSessionSeconds === null ? 'dale a Empezar y sale' : 'de media'
            }
          />
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
          Tu mejor serie en cada ejercicio, de todos tus programas.
        </p>

        {records.length === 0 ? (
          <p className="py-4 text-center text-sm text-iron-400">
            Anota tu primera serie y tu primer récord es esa misma.
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
                  {formatBestSet(record.best)}
                </span>
              </li>
            ))}
          </ol>
        )}

        {records.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowingLifts(true)}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-iron-700 text-sm font-semibold text-iron-100 hover:bg-iron-850"
          >
            Ver todos mis pesos
            <Icon name="chevronRight" size={16} />
          </button>
        ) : null}
      </section>

    </div>
  );
}

/**
 * What the numbers add up to, in a sentence.
 *
 * Ordered by what matters most to say. A long absence outranks a streak,
 * because a streak that ended three weeks ago is not news you want first;
 * and a live streak outranks "trained this week", which it already implies.
 */
function greet(profile: Profile): string {
  const { stats, streakWeeks, lastSessionAt, weeklyActivity } = profile;

  if (stats.startedSessions === 0) {
    return 'Todavía no has anotado ninguna serie. En cuanto lo hagas, esto se llena solo.';
  }

  const days = daysSince(lastSessionAt);
  if (days !== null && days >= 10) {
    return `Hace ${days} días que no entrenas. Cuando vuelvas, seguimos donde lo dejaste.`;
  }

  if (streakWeeks >= 2) {
    return `Llevas ${streakWeeks} semanas seguidas entrenando. Sigue así.`;
  }

  const thisWeek = weeklyActivity.at(-1)?.sessions ?? 0;
  if (thisWeek > 0) {
    return `Ya has entrenado ${thisWeek} ${thisWeek === 1 ? 'vez' : 'veces'} esta semana.`;
  }

  return 'Esta semana todavía no has entrenado.';
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
}

/**
 * Records set in the last week, said out loud.
 *
 * They were always in the list below, indistinguishable from a record set
 * eight months ago. This is the only place in the app that can give you good
 * news without you going looking for it, so it goes at the top and it says so.
 */
function FreshRecords({ records }: { records: Profile['records'] }) {
  return (
    <section
      aria-labelledby="fresh-title"
      className="rounded-2xl border border-signal-500/30 bg-signal-500/5 p-4"
    >
      <h2 id="fresh-title" className="flex items-center gap-2 font-semibold text-signal-300">
        <Icon name="star" size={18} />
        {records.length === 1
          ? 'Has batido un récord esta semana'
          : `Has batido ${records.length} récords esta semana`}
      </h2>

      <ul className="mt-2 space-y-1.5">
        {records.map((record) => (
          <li key={record.exercise} className="flex items-baseline gap-3">
            <span className="line-clamp-1 min-w-0 flex-1 text-sm text-chalk">
              {record.exercise}
            </span>
            <span className="figure shrink-0 text-sm font-bold text-chalk">
              {formatBestSet(record.best)}
            </span>
          </li>
        ))}
      </ul>
    </section>
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

/**
 * Your name, edited where it is shown.
 *
 * It used to be a titled card with its own Save button, sitting at the very
 * bottom — the last thing you scrolled past and the least interesting thing
 * on the screen. Editing a name is not a form; it is correcting a word.
 */
function NameField({ displayName, onSaved }: { displayName: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(displayName);
  const [busy, setBusy] = useState(false);

  const commit = () => {
    setEditing(false);
    const next = name.trim();
    // Nothing typed, or nothing changed: no request, no spinner, no fuss.
    if (next === displayName || next === '') {
      setName(displayName);
      return;
    }
    setBusy(true);
    api
      .updateProfile({ displayName: next })
      .then(onSaved)
      .catch(() => setName(displayName))
      .finally(() => setBusy(false));
  };

  if (editing) {
    return (
      <input
        autoFocus
        aria-label="Tu nombre"
        value={name}
        maxLength={60}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setName(displayName);
            setEditing(false);
          }
        }}
        placeholder="Cómo quieres que te llamemos"
        className="w-full rounded-lg border border-signal-400 bg-iron-850 px-2 py-1 text-2xl font-bold text-chalk focus:outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex max-w-full items-center gap-1.5 rounded-lg text-left hover:text-signal-300"
    >
      <h2 className="truncate text-2xl font-bold text-chalk">{displayName}</h2>
      <Icon name="pencil" size={14} className="shrink-0 text-iron-600" />
      <span className="sr-only">Cambiar tu nombre</span>
    </button>
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
