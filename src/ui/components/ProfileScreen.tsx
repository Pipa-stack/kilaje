import { useEffect, useState } from 'react';

import * as api from '../../api/client';
import { ApiError, type Profile } from '../../api/client';
import { formatNumber } from '../../domain/calculations';
import { Icon } from './Icon';

/**
 * The profile.
 *
 * Two things only: what you have lifted, and what to call you. Every number
 * comes from sets already logged — the screen exists to show the training,
 * not to collect fields nobody looks at twice.
 */
export function ProfileScreen({ email }: { email: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    api
      .fetchProfile()
      .then(setProfile)
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiError && cause.isOffline
            ? 'El perfil necesita conexión.'
            : 'No se ha podido cargar el perfil.',
        );
      });
  };

  useEffect(reload, []);

  if (error) {
    return (
      <p
        role="status"
        className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-8 text-center text-sm text-iron-400"
      >
        {error}
      </p>
    );
  }

  if (!profile) {
    return (
      <p role="status" className="px-4 py-8 text-center text-sm text-iron-400">
        Cargando perfil…
      </p>
    );
  }

  const { identity, stats, records } = profile;

  return (
    <div className="space-y-4">
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
            Entrenando desde {formatMonth(identity.memberSince)}
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
