import { useState } from 'react';

import { weekVolume } from '../domain/calculations';
import { DayView } from './components/DayView';
import { Dropzone } from './components/Dropzone';
import { ImportScreen } from './components/ImportScreen';
import { useProgram } from './hooks/useProgram';

export default function App() {
  const state = useProgram();
  const [showImport, setShowImport] = useState(false);

  if (state.loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <p role="status" className="text-ink-400">
          Cargando entrenamiento…
        </p>
      </main>
    );
  }

  if (!state.program || !state.week || !state.day) {
    return (
      <ImportScreen
        onFile={state.importFile}
        importing={state.importing}
        error={state.error}
        onDismissError={state.dismissError}
      />
    );
  }

  const { program, week, day } = state;
  const dayIndex = week.days.findIndex((candidate) => candidate.number === day.number);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-16 pt-4">
      <header className="mb-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-ink-50">{program.name}</h1>
            <p className="text-xs text-ink-600">
              Volumen de la semana: {Math.round(weekVolume(week)).toLocaleString('es-ES')} kg
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowImport((current) => !current)}
            aria-expanded={showImport}
            className="min-h-11 shrink-0 rounded-xl border border-ink-700 px-3 text-sm font-semibold text-ink-200 hover:bg-ink-850"
          >
            Importar
          </button>
        </div>

        {state.offline ? (
          <p
            role="alert"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
          >
            Sin conexión con el servidor. Se muestran los últimos datos guardados en este
            dispositivo; los cambios se enviarán cuando vuelva la conexión.
          </p>
        ) : null}

        {showImport ? (
          <div className="space-y-3">
            <Dropzone
              onFile={async (file) => {
                await state.importFile(file);
                setShowImport(false);
              }}
              disabled={state.importing}
              label={state.importing ? 'Importando…' : 'Importar otro Excel'}
              hint="Se crea un programa nuevo. Los anteriores y su historial se conservan."
            />

            {state.programs.length > 1 ? (
              <nav aria-label="Programas guardados">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-600">
                  Programas guardados
                </h2>
                <ul className="space-y-2">
                  {state.programs.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        onClick={async () => {
                          await state.selectProgram(candidate.id);
                          setShowImport(false);
                        }}
                        aria-current={candidate.id === program.id ? 'true' : undefined}
                        className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm ${
                          candidate.id === program.id
                            ? 'bg-ink-700 text-ink-50'
                            : 'bg-ink-900 text-ink-400 hover:bg-ink-850'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate font-semibold">
                          {candidate.name}
                        </span>
                        <span className="shrink-0 text-xs text-ink-600">
                          {candidate.dayCount} días · {candidate.completedDays} completados
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </div>
        ) : null}

        <div role="status" aria-live="polite">
          {state.error ? (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <span className="flex-1">{state.error}</span>
              <button
                type="button"
                onClick={state.dismissError}
                className="rounded-lg px-2 py-1 font-semibold text-red-100 hover:bg-red-500/20"
              >
                Cerrar
              </button>
            </div>
          ) : null}
        </div>

        {program.weeks.length > 1 ? (
          <nav aria-label="Semanas">
            <ul className="flex gap-2 overflow-x-auto pb-1">
              {program.weeks.map((candidate) => (
                <li key={candidate.number}>
                  <button
                    type="button"
                    onClick={() => state.selectWeek(candidate.number)}
                    aria-current={candidate.number === week.number ? 'true' : undefined}
                    className={`min-h-11 whitespace-nowrap rounded-xl px-4 text-sm font-semibold ${
                      candidate.number === week.number
                        ? 'bg-ink-700 text-ink-50'
                        : 'bg-ink-900 text-ink-400 hover:bg-ink-850'
                    }`}
                  >
                    Semana {candidate.number}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <nav aria-label="Días de la semana">
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {week.days.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => state.selectDay(candidate.number)}
                  aria-current={candidate.number === day.number ? 'true' : undefined}
                  className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition-colors ${
                    candidate.number === day.number
                      ? 'bg-accent-500 text-white'
                      : 'bg-ink-900 text-ink-400 hover:bg-ink-850'
                  }`}
                >
                  <span>Día {candidate.number}</span>
                  {candidate.completed ? <span aria-label="completada">✓</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main>
        <DayView
          key={day.id}
          day={day}
          hasPreviousDay={dayIndex > 0}
          hasNextDay={dayIndex >= 0 && dayIndex < week.days.length - 1}
          onNavigate={state.goToAdjacentDay}
          onUpdateSet={state.updateSet}
          onAddSet={state.addSet}
          onRemoveSet={state.removeSet}
          onNotesChange={state.updateNotes}
          onToggleCompleted={state.toggleCompleted}
          onResetDay={state.resetDay}
        />
      </main>
    </div>
  );
}
