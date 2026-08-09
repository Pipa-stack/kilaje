import { Dropzone } from './Dropzone';

interface ImportScreenProps {
  onFile: (file: File) => void;
  importing: boolean;
  error: string | null;
  onDismissError: () => void;
}

const STEPS = [
  'Sube tu plantilla de entrenamiento en .xlsx.',
  'Se detectan automáticamente las semanas, los días y los ejercicios.',
  'Entrena y anota peso, reps y RIR. Todo se guarda en la base de datos.',
];

/** First-run screen: nothing to show until a workbook is imported. */
export function ImportScreen({ onFile, importing, error, onDismissError }: ImportScreenProps) {
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
