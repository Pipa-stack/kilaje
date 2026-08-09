import { useEffect, useState } from 'react';

import * as api from '../../api/client';
import { ApiError, type Profile, type WeightUnit } from '../../api/client';
import { formatNumber } from '../../domain/calculations';
import { Icon } from './Icon';

/**
 * The profile.
 *
 * Modelled on what training apps actually put here — personal records,
 * lifetime totals, body weight — because those are the numbers a lifter
 * comes back to look at. Everything is derived from sets already logged, so
 * nothing new is asked of the user to make the screen worth opening.
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
      <p role="status" className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-8 text-center text-sm text-iron-400">
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

  const { identity, stats, records, bodyWeights } = profile;
  const latestWeight = bodyWeights.at(-1);

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
          <p className="truncate text-sm text-iron-400">{identity.gym ?? email}</p>
          <p className="text-xs text-iron-600">Entrenando desde {formatMonth(identity.memberSince)}</p>
        </div>
      </section>

      <section aria-labelledby="totals-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
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

      <section aria-labelledby="records-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
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

      <BodyWeightSection
        entries={bodyWeights}
        unit={identity.weightUnit}
        latest={latestWeight}
        onSaved={reload}
      />

      <IdentityForm identity={identity} onSaved={reload} />
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

/** Kilos in the database; the preference only changes what is shown. */
function toDisplay(weightKg: number, unit: WeightUnit): number {
  return unit === 'lb' ? Math.round(weightKg * 2.20462 * 10) / 10 : weightKg;
}

function fromDisplay(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? Math.round((value / 2.20462) * 100) / 100 : value;
}

function BodyWeightSection({
  entries,
  unit,
  latest,
  onSaved,
}: {
  entries: Profile['bodyWeights'];
  unit: WeightUnit;
  latest: Profile['bodyWeights'][number] | undefined;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // A flat line tells you nothing; the range is what makes a trend visible.
  const values = entries.map((entry) => entry.weightKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const change = values.length > 1 ? values.at(-1)! - values[0]! : null;

  return (
    <section aria-labelledby="weight-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="weight-title" className="font-semibold text-chalk">
          Peso corporal
        </h2>
        {latest ? (
          <span className="figure text-2xl font-bold text-chalk">
            {formatNumber(toDisplay(latest.weightKg, unit))}
            <span className="ml-1 text-xs font-normal text-iron-600">{unit}</span>
          </span>
        ) : null}
      </div>

      {entries.length > 1 ? (
        <>
          <div aria-hidden="true" className="mt-3 flex h-16 items-end gap-[3px]">
            {entries.slice(-40).map((entry) => (
              <span
                key={entry.measuredOn}
                className="flex-1 rounded-t-[2px] bg-signal-500/70"
                style={{ height: `${20 + ((entry.weightKg - min) / span) * 80}%` }}
              />
            ))}
          </div>
          <p className="mt-1 flex justify-between text-xs text-iron-600">
            <span>{formatDay(entries[0]!.measuredOn)}</span>
            {change !== null ? (
              <span className={change >= 0 ? 'text-iron-400' : 'text-done-300'}>
                {change >= 0 ? '+' : ''}
                {formatNumber(toDisplay(change, unit))} {unit}
              </span>
            ) : null}
            <span>{formatDay(entries.at(-1)!.measuredOn)}</span>
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-iron-400">
          Anota tu peso de vez en cuando y verás la tendencia.
        </p>
      )}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number.parseFloat(draft.replace(',', '.'));
          if (!Number.isFinite(value) || value <= 0) return;

          setBusy(true);
          api
            .recordBodyWeight(fromDisplay(value, unit))
            .then(() => {
              setDraft('');
              onSaved();
            })
            .catch(() => undefined)
            .finally(() => setBusy(false));
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Peso de hoy en {unit}</span>
          <input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Peso de hoy (${unit})`}
            className="w-full rounded-xl border border-iron-700 bg-iron-850 px-3 py-2.5 text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={busy || draft.trim() === ''}
          className="min-h-11 rounded-xl bg-signal-500 px-4 text-sm font-bold text-iron-950 hover:bg-signal-400 disabled:opacity-40"
        >
          Guardar
        </button>
      </form>
    </section>
  );
}

function IdentityForm({
  identity,
  onSaved,
}: {
  identity: Profile['identity'];
  onSaved: () => void;
}) {
  const [name, setName] = useState(identity.displayName);
  const [gym, setGym] = useState(identity.gym ?? '');
  const [unit, setUnit] = useState<WeightUnit>(identity.weightUnit);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <form
      aria-labelledby="identity-title"
      className="space-y-3 rounded-2xl border border-iron-800 bg-iron-900 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setSaved(false);
        api
          .updateProfile({ displayName: name, gym, weightUnit: unit })
          .then(() => {
            setSaved(true);
            onSaved();
          })
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      <h2 id="identity-title" className="font-semibold text-chalk">
        Tus datos
      </h2>

      <label className="block">
        <span className="eyebrow mb-1 block">Nombre</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          className="w-full rounded-xl border border-iron-700 bg-iron-850 px-3 py-2.5 text-chalk focus:border-signal-400 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="eyebrow mb-1 block">Gimnasio</span>
        <input
          value={gym}
          onChange={(event) => setGym(event.target.value)}
          maxLength={80}
          placeholder="Dónde entrenas"
          className="w-full rounded-xl border border-iron-700 bg-iron-850 px-3 py-2.5 text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
        />
      </label>

      <div>
        <span className="eyebrow mb-1 block">Unidad del peso corporal</span>
        <div role="group" aria-label="Unidad" className="flex gap-2">
          {(['kg', 'lb'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setUnit(option)}
              aria-pressed={unit === option}
              className={`min-h-11 flex-1 rounded-xl border text-sm font-semibold uppercase ${
                unit === option
                  ? 'border-signal-500 bg-signal-500/10 text-signal-300'
                  : 'border-iron-700 text-iron-400 hover:bg-iron-850'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-iron-600">
          Solo afecta a tu peso corporal. Los pesos del entrenamiento vienen del Excel y se
          mantienen en kilos.
        </p>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-iron-700 text-sm font-semibold text-iron-100 hover:bg-iron-850 disabled:opacity-60"
      >
        {saved ? <Icon name="check" size={16} /> : null}
        {busy ? 'Guardando…' : saved ? 'Guardado' : 'Guardar cambios'}
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
