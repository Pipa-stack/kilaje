import { useState } from 'react';

import { Dropzone } from './Dropzone';

interface ImportScreenProps {
  onFile: (file: File) => void;
  /** Starts an empty plan with this many sessions a week. */
  onCreateBlank: (days: number) => void;
  importing: boolean;
  error: string | null;
  onDismissError: () => void;
}

/** What a week of training usually looks like. Beyond this, edit it after. */
const DAY_CHOICES = [2, 3, 4, 5, 6] as const;

const STEPS = [
  'Sube tu plantilla de entrenamiento en .xlsx.',
  'Se detectan automáticamente las semanas, los días y los ejercicios.',
  'Entrena y anota peso, reps y RIR. Todo se guarda en la base de datos.',
];

/** First-run screen: nothing to show until a workbook is imported. */
export function ImportScreen({
  onFile,
  onCreateBlank,
  importing,
  error,
  onDismissError,
}: ImportScreenProps) {
  const [choosing, setChoosing] = useState(false);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-8 px-4 py-12">
      <header className="space-y-3 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-chalk">Kilaje</h1>
        <p className="text-balance text-iron-400">
          Tu plantilla de Excel, convertida en algo que se puede usar con una mano entre serie
          y serie.
        </p>
      </header>

      <Dropzone
        onFile={onFile}
        disabled={importing}
        label={importing ? 'Importando…' : 'Arrastra tu Excel o toca para elegirlo'}
        hint="Archivos .xlsx hasta 10 MB. Se procesa en el servidor y se guarda en tu base de datos."
      />

      {/* The second door.
          Until this existed the app had exactly one way in — a coach's
          spreadsheet — so anybody without one got as far as this screen and
          no further. The plan editor could already build a day from nothing;
          all that was missing was something to build it into. */}
      <div className="space-y-3">
        <p className="flex items-center gap-3 text-xs uppercase tracking-wide text-iron-600">
          <span aria-hidden="true" className="h-px flex-1 bg-iron-800" />
          o
          <span aria-hidden="true" className="h-px flex-1 bg-iron-800" />
        </p>

        {choosing ? (
          <div className="rounded-2xl border border-iron-700 bg-iron-900 p-4">
            <p className="mb-3 text-center text-sm text-iron-100">
              ¿Cuántos días entrenas a la semana?
            </p>
            <div className="flex justify-center gap-2">
              {DAY_CHOICES.map((days) => (
                <button
                  key={days}
                  type="button"
                  disabled={importing}
                  onClick={() => onCreateBlank(days)}
                  className="figure size-12 rounded-xl border border-iron-700 text-lg font-bold text-chalk hover:border-signal-400 hover:bg-iron-850 disabled:opacity-40"
                >
                  {days}
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-iron-600">
              Podrás añadir o quitar semanas y ejercicios cuando quieras.
            </p>
          </div>
        ) : (
          <button
            type="button"
            disabled={importing}
            onClick={() => setChoosing(true)}
            className="min-h-12 w-full rounded-2xl border border-iron-700 text-sm font-semibold text-iron-100 hover:border-signal-400 hover:bg-iron-900 disabled:opacity-40"
          >
            Empezar un plan desde cero
          </button>
        )}
      </div>

      <div role="status" aria-live="polite">
        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={onDismissError}
              className="rounded-lg px-2 py-1 font-semibold text-red-100 hover:bg-red-500/20"
            >
              Cerrar
            </button>
          </div>
        ) : null}
      </div>

      <ol className="space-y-3 text-sm text-iron-400">
        {STEPS.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-iron-800 text-xs font-bold text-iron-100">
              {index + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
