import { useState } from 'react';

import { Dropzone } from './Dropzone';
import { Icon } from './Icon';

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

/** Which road the person took. `null` while they have not chosen. */
type Route = 'excel' | 'blank';

/**
 * First run: two ways in, and you pick.
 *
 * This screen used to lead with the file picker and hide "start from scratch"
 * underneath it, which read as *the* way to use the app plus a fallback for
 * people doing it wrong. They are two equal starting points — one for whoever
 * has a coach and one for whoever writes their own plan — so the screen asks
 * the question instead of assuming the answer.
 *
 * Nothing is preselected. A default here would be a recommendation, and there
 * is no reason to recommend either.
 */
export function ImportScreen({
  onFile,
  onCreateBlank,
  importing,
  error,
  onDismissError,
}: ImportScreenProps) {
  const [route, setRoute] = useState<Route | null>(null);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-8 px-4 py-12">
      <header className="space-y-3 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-chalk">Kilaje</h1>
        <p className="text-balance text-iron-400">
          Tu entrenamiento en algo que se puede usar con una mano entre serie y serie.
        </p>
      </header>

      <div role="status" aria-live="polite">
        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-effort-500/40 bg-effort-500/10 px-4 py-3 text-sm text-effort-300">
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={onDismissError}
              className="rounded-lg px-2 py-1 font-semibold text-chalk hover:bg-effort-500/20"
            >
              Cerrar
            </button>
          </div>
        ) : null}
      </div>

      {route === null ? (
        <div className="space-y-3">
          <h2 className="text-center text-sm font-semibold text-iron-100">
            ¿Cómo quieres empezar?
          </h2>

          <Choice
            title="Tengo una plantilla en Excel"
            detail="La que te pasó tu entrenador. Se leen solas las semanas, los días y los ejercicios."
            onClick={() => setRoute('excel')}
          />
          <Choice
            title="Quiero montarlo yo"
            detail="Empiezas con la semana vacía y añades tus ejercicios a mano."
            onClick={() => setRoute('blank')}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setRoute(null)}
            disabled={importing}
            className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-iron-400 hover:bg-iron-900 hover:text-iron-100 disabled:opacity-40"
          >
            <Icon name="chevronRight" size={18} className="rotate-180" />
            Elegir otra forma
          </button>

          {route === 'excel' ? (
            <>
              <Dropzone
                onFile={onFile}
                disabled={importing}
                label={importing ? 'Importando…' : 'Arrastra tu Excel o toca para elegirlo'}
                hint="Archivos .xlsx hasta 10 MB. Se procesa en el servidor y se guarda en tu base de datos."
              />
              <ol className="space-y-3 text-sm text-iron-400">
                {[
                  'Se detectan las semanas, los días y los ejercicios.',
                  'Entrenas y anotas peso, reps y RIR.',
                  'Puedes descargarlo otra vez en Excel cuando quieras.',
                ].map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-iron-800 text-xs font-bold text-iron-100">
                      {index + 1}
                    </span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="rounded-2xl border border-iron-700 bg-iron-900 p-5">
              <h3 className="text-center font-semibold text-chalk">
                ¿Cuántos días entrenas a la semana?
              </h3>
              <div className="mt-4 flex justify-center gap-2">
                {DAY_CHOICES.map((days) => (
                  <button
                    key={days}
                    type="button"
                    disabled={importing}
                    onClick={() => onCreateBlank(days)}
                    className="figure size-14 rounded-xl border border-iron-700 text-xl font-bold text-chalk hover:border-signal-400 hover:bg-iron-850 disabled:opacity-40"
                  >
                    {days}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-center text-xs text-iron-600">
                {importing
                  ? 'Creando tu plan…'
                  : 'No es definitivo: puedes añadir o quitar días, semanas y ejercicios cuando quieras.'}
              </p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function Choice({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-iron-700 bg-iron-900 p-4 text-left hover:border-signal-400 hover:bg-iron-850"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-chalk">{title}</span>
        <span className="mt-0.5 block text-sm leading-snug text-iron-400">{detail}</span>
      </span>
      <Icon name="chevronRight" size={20} className="shrink-0 text-iron-600" />
    </button>
  );
}
