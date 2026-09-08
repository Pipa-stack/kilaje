import { useEffect, useMemo, useState } from 'react';

import { ApiError, fetchLifts, type Lift } from '../../api/client';
import { formatBestSet, formatNumber } from '../../domain/calculations';
import { Icon } from './Icon';

type Order = 'weight' | 'gain' | 'stalled';

const ORDERS: { id: Order; label: string; hint: string }[] = [
  { id: 'weight', label: 'Peso', hint: 'Tu mejor serie, de más a menos.' },
  { id: 'gain', label: 'Progreso', hint: 'Lo que más ha subido desde que empezaste.' },
  { id: 'stalled', label: 'Parados', hint: 'Lo que llevas más tiempo sin batir.' },
];

interface LiftsScreenProps {
  onBack: () => void;
}

/**
 * Every movement you have trained, ranked three ways.
 *
 * The profile's records card answers "what are my best lifts" in eight rows.
 * This answers the two questions that card cannot: where is a given exercise
 * going, and which ones have quietly stopped moving. Same data, three orders,
 * because a ranking by weight alone hides a lift that has not budged in
 * months behind the fact that it is heavy.
 */
export function LiftsScreen({ onBack }: LiftsScreenProps) {
  const [lifts, setLifts] = useState<Lift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>('weight');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    fetchLifts()
      .then((result) => {
        if (!cancelled) setLifts(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError ? cause.message : 'No se han podido cargar tus pesos.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(() => {
    if (!lifts) return [];

    const needle = query.trim().toLocaleLowerCase('es');
    const matching = needle
      ? lifts.filter((lift) => lift.exercise.toLocaleLowerCase('es').includes(needle))
      : [...lifts];

    return matching.sort((a, b) => {
      if (order === 'weight') return b.best.weight - a.best.weight;
      if (order === 'stalled') return b.weeksSince - a.weeksSince;
      // Exercises with a single session have no trend to rank, so they go last
      // rather than pretending to a gain of zero.
      if (a.gainKg === null) return b.gainKg === null ? 0 : 1;
      if (b.gainKg === null) return -1;
      return b.gainKg - a.gainKg;
    });
  }, [lifts, order, query]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-iron-400 hover:bg-iron-850 hover:text-iron-100"
        >
          <Icon name="chevronRight" size={18} className="rotate-180" />
          Perfil
        </button>
        <h2 className="text-lg font-bold text-chalk">Mis pesos</h2>
      </div>

      <div className="space-y-3 rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <div>
          <label htmlFor="lifts-search" className="sr-only">
            Buscar un ejercicio
          </label>
          <input
            id="lifts-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar un ejercicio…"
            className="min-h-11 w-full rounded-xl border border-iron-700 bg-iron-850 px-3 text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
          />
        </div>

        <div role="group" aria-label="Ordenar por" className="flex gap-2">
          {ORDERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setOrder(option.id)}
              aria-pressed={order === option.id}
              className={`min-h-11 flex-1 rounded-xl border text-sm font-semibold transition-colors ${
                order === option.id
                  ? 'border-signal-500 bg-signal-500/10 text-signal-300'
                  : 'border-iron-700 text-iron-400 hover:bg-iron-850'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-iron-600">
          {ORDERS.find((option) => option.id === order)?.hint}
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-2xl border border-effort-500/40 bg-effort-500/10 px-4 py-3 text-sm text-effort-300">
          {error}
        </p>
      ) : null}

      {lifts === null && error === null ? (
        <p role="status" className="py-8 text-center text-sm text-iron-400">
          Cargando tus pesos…
        </p>
      ) : null}

      {lifts !== null && shown.length === 0 ? (
        <p role="status" className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-10 text-center text-sm text-iron-400">
          {query.trim()
            ? `Ningún ejercicio se llama así.`
            : 'Cuando registres tu primera serie aparecerá aquí.'}
        </p>
      ) : null}

      {shown.length > 0 ? (
        <ol className="divide-y divide-iron-800 rounded-2xl border border-iron-800 bg-iron-900 px-4">
          {shown.map((lift, index) => (
            <li key={lift.exercise} className="flex items-baseline gap-3 py-3">
              <span aria-hidden="true" className="figure w-5 shrink-0 text-sm text-iron-600">
                {index + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-medium text-chalk">
                  {lift.exercise}
                </span>
                <span className="block text-xs text-iron-600">
                  {lift.sessions} {lift.sessions === 1 ? 'sesión' : 'sesiones'}
                  {lift.weeksSince > 0
                    ? ` · sin batir en ${lift.weeksSince} ${
                        lift.weeksSince === 1 ? 'semana' : 'semanas'
                      }`
                    : ' · batido esta semana'}
                </span>
              </span>

              <span className="shrink-0 text-right">
                <span className="figure block text-base font-bold text-chalk">
                  {formatBestSet(lift.best)}
                </span>
                {lift.gainKg !== null && lift.gainKg !== 0 ? (
                  <span
                    className={`figure block text-xs font-semibold ${
                      lift.gainKg > 0 ? 'text-done-300' : 'text-amber-300'
                    }`}
                  >
                    {lift.gainKg > 0 ? '+' : ''}
                    {formatNumber(lift.gainKg)} kg
                  </span>
                ) : (
                  <span className="block text-xs text-iron-600">
                    {lift.gainKg === 0 ? 'igual' : '—'}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
