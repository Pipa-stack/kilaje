import { useMemo, useState } from 'react';

import {
  exerciseBestSet,
  exerciseProgression,
  exerciseVolume,
  formatBestSet,
  formatVolume,
  isBetterSet,
  isExerciseStarted,
  parseProtocolSetCount,
  type BestSet,
} from '../../domain/calculations';
import { MAX_SETS, type SetPatch } from '../../domain/mutations';
import { TEMPLATE_SET_COUNT, isSetEmpty, isSetWorked, type Exercise } from '../../domain/types';
import { Icon } from './Icon';
import { PlateMath } from './PlateMath';
import { NumberField } from './NumberField';

interface ExerciseCardProps {
  exercise: Exercise;
  /**
   * The best set logged for this movement in *earlier* weeks.
   *
   * The mark to beat. It excludes the week on screen, or the set being typed
   * would be part of the history it is compared against and nothing could
   * ever be a record.
   */
  previousBest: BestSet | null;
  onUpdateSet: (exerciseId: string, setIndex: number, patch: SetPatch) => void;
  onAddSet: (exerciseId: string) => void;
  onRemoveSet: (exerciseId: string, setIndex: number) => void;
  /** The permanent setup note, shared by every week of the program. */
  onSetupChange: (exerciseId: string, setup: string) => void;
  /** This session's note for this exercise. */
  onNotesChange: (exerciseId: string, notes: string) => void;
}

export function ExerciseCard({
  exercise,
  previousBest,
  onUpdateSet,
  onAddSet,
  onRemoveSet,
  onSetupChange,
  onNotesChange,
}: ExerciseCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  // Opened by a tap rather than always shown: on a phone, four exercises each
  // carrying an open text box push the sets you came here to fill off screen.
  const [editingSetup, setEditingSetup] = useState(false);
  const [showNote, setShowNote] = useState(false);

  const best = exerciseBestSet(exercise);
  const volume = exerciseVolume(exercise.currentWeek);
  const progression = exerciseProgression(exercise);
  const started = isExerciseStarted(exercise);
  const plannedSets = parseProtocolSetCount(exercise.protocol);

  // Which set, if any, is the one that broke the record. Only the best set of
  // the day gets the mark: three sets over the old best are one record, not
  // three, and starring all of them would say the opposite.
  const recordIndex =
    best !== null && (previousBest === null || isBetterSet(best, previousBest)) ? best.setIndex : null;

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
          <span className="font-semibold text-iron-400">Del entrenador: </span>
          {exercise.comments}
        </p>
      ) : null}

      <div className="border-b border-iron-800 px-4 py-2">
        {editingSetup ? (
          <>
            <label htmlFor={`${exercise.id}-setup`} className="eyebrow mb-1 block">
              Cómo lo montas
            </label>
            <textarea
              id={`${exercise.id}-setup`}
              autoFocus
              rows={2}
              maxLength={1000}
              value={exercise.setup ?? ''}
              onChange={(event) => onSetupChange(exercise.id, event.target.value)}
              onBlur={() => setEditingSetup(false)}
              placeholder="Banco pin 4, agarre ancho…"
              className="w-full resize-y rounded-xl border border-iron-700 bg-iron-850 px-3 py-2 text-sm text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
            />
            <p className="mt-1 text-xs text-iron-600">
              Se guarda para todas las semanas de este programa.
            </p>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditingSetup(true)}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg text-left text-sm text-iron-400 hover:text-iron-100"
          >
            <Icon name="wrench" size={15} className="shrink-0" />
            {exercise.setup ? (
              <span className="text-iron-100">{exercise.setup}</span>
            ) : (
              <span>Añadir cómo montas este ejercicio</span>
            )}
          </button>
        )}
      </div>

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
                {index === recordIndex && isSetWorked(set) ? (
                  <p className="mt-1 flex items-center gap-1.5 pl-10 text-xs font-semibold text-signal-300">
                    <Icon name="star" size={14} />
                    <span>
                      Récord
                      {previousBest ? (
                        <span className="font-normal text-iron-400">
                          {' '}— antes {formatBestSet(previousBest)}
                        </span>
                      ) : (
                        <span className="font-normal text-iron-400"> — tu primera marca</span>
                      )}
                    </span>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>

        {showNote || exercise.notes ? (
          <div className="mt-3">
            <label htmlFor={`${exercise.id}-note`} className="eyebrow mb-1 block">
              Nota de hoy
            </label>
            <textarea
              id={`${exercise.id}-note`}
              autoFocus={showNote && exercise.notes === ''}
              rows={2}
              maxLength={1000}
              value={exercise.notes}
              onChange={(event) => onNotesChange(exercise.id, event.target.value)}
              placeholder="Cómo ha ido, molestias, qué cambiar…"
              className="w-full resize-y rounded-xl border border-iron-700 bg-iron-850 px-3 py-2 text-sm text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNote(true)}
            className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-lg text-left text-sm text-iron-400 hover:text-iron-100"
          >
            <Icon name="pencil" size={15} className="shrink-0" />
            Anotar algo de hoy
          </button>
        )}

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
        <Stat
          label="Mejor serie"
          value={formatBestSet(best ?? previousBest)}
          hint={
            best === null && previousBest !== null
              ? 'Tu mejor serie hasta ahora en este ejercicio'
              : 'La serie más pesada que has hecho hoy aquí'
          }
        />
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
