import { useMemo, useState } from 'react';

import {
  exercise1RM,
  exerciseProgression,
  exerciseVolume,
  formatNumber,
  formatVolume,
  isExerciseStarted,
  parseProtocolSetCount,
} from '../../domain/calculations';
import { MAX_SETS, type SetPatch } from '../../domain/mutations';
import { TEMPLATE_SET_COUNT, isSetEmpty, type Exercise } from '../../domain/types';
import { Icon } from './Icon';
import { PlateMath } from './PlateMath';
import { NumberField } from './NumberField';

interface ExerciseCardProps {
  exercise: Exercise;
  onUpdateSet: (exerciseId: string, setIndex: number, patch: SetPatch) => void;
  onAddSet: (exerciseId: string) => void;
  onRemoveSet: (exerciseId: string, setIndex: number) => void;
}

export function ExerciseCard({
  exercise,
  onUpdateSet,
  onAddSet,
  onRemoveSet,
}: ExerciseCardProps) {
  const [showHistory, setShowHistory] = useState(false);

  const oneRepMax = exercise1RM(exercise);
  const volume = exerciseVolume(exercise.currentWeek);
  const progression = exerciseProgression(exercise);
  const started = isExerciseStarted(exercise);
  const plannedSets = parseProtocolSetCount(exercise.protocol);

  const hasHistory = useMemo(
    () => exercise.previousWeek.some((set) => !isSetEmpty(set)),
    [exercise.previousWeek],
  );

  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-iron-900 transition-colors ${
        started ? 'border-signal-500/40' : 'border-iron-800'
      }`}
      aria-labelledby={`${exercise.id}-title`}
    >
      <header className="flex items-start gap-3 border-b border-iron-800 px-4 py-3">
        <span
          aria-hidden="true"
          className={`figure mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-lg font-bold ${
            started ? 'bg-signal-500 text-iron-950' : 'bg-iron-800 text-iron-400'
          }`}
        >
          {exercise.number}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`${exercise.id}-title`} className="text-balance font-semibold leading-snug text-chalk">
            {exercise.name || `Ejercicio ${exercise.number}`}
          </h3>
          {exercise.protocol ? (
            <p className="mt-1 text-sm leading-snug text-iron-400">{exercise.protocol}</p>
          ) : null}
        </div>
        {exercise.video ? (
          <a
            href={exercise.video}
            target="_blank"
            rel="noopener noreferrer"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-iron-800 text-lg hover:bg-iron-700"
            title="Ver vídeo del ejercicio"
          >
            <Icon name="play" size={18} />
            <span className="sr-only">Ver vídeo de {exercise.name}</span>
          </a>
        ) : null}
      </header>

      {exercise.comments ? (
        <p className="border-b border-iron-800 bg-iron-850 px-4 py-2 text-sm text-iron-100">
          <span className="font-semibold text-iron-400">Nota: </span>
          {exercise.comments}
        </p>
      ) : null}

      <div className="px-4 py-3">
        <div className="eyebrow mb-2 flex items-center gap-2 px-1">
          <span className="w-8">Set</span>
          <span className="flex-1 text-center">Peso</span>
          <span className="flex-1 text-center">Reps</span>
          <span className="flex-1 text-center">RIR</span>
          <span className="w-9" />
        </div>

        <ul className="space-y-2">
          {exercise.currentWeek.map((set, index) => {
            const reference = exercise.previousWeek[index];
            const beyondPlan = plannedSets !== null && index >= plannedSets;

            return (
              <li key={index}>
                <div className="flex items-start gap-2">
                <span
                  className={`figure mt-3 w-8 shrink-0 text-base font-bold ${
                    beyondPlan ? 'text-iron-600' : 'text-iron-400'
                  }`}
                >
                  {index + 1}
                </span>
                <NumberField
                  label={`Peso de la serie ${index + 1} de ${exercise.name}, en kilos`}
                  value={set.weight}
                  reference={reference?.weight ?? null}
                  max={1000}
                  onChange={(weight) => onUpdateSet(exercise.id, index, { weight })}
                />
                <NumberField
                  label={`Repeticiones de la serie ${index + 1} de ${exercise.name}`}
                  value={set.reps}
                  reference={reference?.reps ?? null}
                  max={999}
                  onChange={(reps) => onUpdateSet(exercise.id, index, { reps })}
                />
                <NumberField
                  label={`RIR de la serie ${index + 1} de ${exercise.name}`}
                  value={set.rir}
                  reference={reference?.rir ?? null}
                  max={10}
                  onChange={(rir) => onUpdateSet(exercise.id, index, { rir })}
                />
                <button
                  type="button"
                  onClick={() => onRemoveSet(exercise.id, index)}
                  disabled={isSetEmpty(set) && index < TEMPLATE_SET_COUNT}
                  className="mt-1 flex size-11 shrink-0 items-center justify-center rounded-xl text-iron-600 hover:bg-iron-800 hover:text-iron-100 disabled:pointer-events-none disabled:opacity-30"
                  title={index < TEMPLATE_SET_COUNT ? 'Vaciar serie' : 'Eliminar serie'}
                >
                  <Icon name="close" size={18} />
                  <span className="sr-only">
                    {index < TEMPLATE_SET_COUNT ? 'Vaciar' : 'Eliminar'} serie {index + 1}
                  </span>
                </button>
                </div>
                <PlateMath weightKg={set.weight} />
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => onAddSet(exercise.id)}
          disabled={exercise.currentWeek.length >= MAX_SETS}
          className="mt-3 min-h-11 w-full rounded-xl border border-dashed border-iron-700 text-sm font-semibold text-iron-400 hover:border-iron-600 hover:bg-iron-850 hover:text-iron-100 disabled:pointer-events-none disabled:opacity-40"
        >
          + Añadir serie
        </button>
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-iron-800 bg-iron-850 px-4 py-3 text-sm">
        <Stat label="Volumen" value={volume > 0 ? formatVolume(volume) : '—'} />
        <Stat label="1RM est." value={oneRepMax !== null ? `${formatNumber(oneRepMax)} kg` : '—'} />
        <Stat label="Progresión" value={progression.text} hint="Sugerido según el RIR de la semana anterior" />
        {hasHistory ? (
          <button
            type="button"
            onClick={() => setShowHistory((current) => !current)}
            aria-expanded={showHistory}
            className="ml-auto min-h-11 rounded-lg px-2 text-xs font-semibold text-signal-300 hover:bg-iron-800"
          >
            {showHistory ? 'Ocultar semana anterior' : 'Ver semana anterior'}
          </button>
        ) : null}
      </footer>

      {showHistory && hasHistory ? (
        <div className="border-t border-iron-800 px-4 py-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-iron-600">
            Semana anterior
          </h4>
          <ul className="space-y-1 text-sm text-iron-100">
            {exercise.previousWeek.map((set, index) =>
              isSetEmpty(set) ? null : (
                <li key={index} className="flex gap-3 tabular-nums">
                  <span className="w-10 text-iron-600">S{index + 1}</span>
                  <span>{set.weight ?? '—'} kg</span>
                  <span>× {set.reps ?? '—'}</span>
                  <span className="text-iron-400">RIR {set.rir ?? '—'}</span>
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <span className="eyebrow block">{label}</span>
      <span className="figure text-lg font-semibold text-chalk">{value}</span>
    </div>
  );
}
