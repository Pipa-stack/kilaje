import { useState } from 'react';

import { BottomNav, type Tab } from './components/BottomNav';
import { DayView } from './components/DayView';
import { HomeScreen } from './components/HomeScreen';
import { Icon } from './components/Icon';
import { ImportScreen } from './components/ImportScreen';
import { ProgressScreen } from './components/ProgressScreen';
import { RestTimer } from './components/RestTimer';
import { SettingsScreen } from './components/SettingsScreen';
import { useProgram } from './hooks/useProgram';

export default function App() {
  const state = useProgram();
  const [tab, setTab] = useState<Tab>('home');

  if (state.loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <p role="status" className="text-iron-400">
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

  const openDay = (dayNumber: number) => {
    state.selectDay(dayNumber);
    setTab('day');
  };

  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-24 pt-4">
      <header className="mb-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-chalk">{program.name}</h1>
            <p className="truncate text-xs text-iron-600">
              {program.weeks.length} {program.weeks.length === 1 ? 'semana' : 'semanas'} ·{' '}
              {week.days.length} sesiones
            </p>
          </div>
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

        {program.weeks.length > 1 && tab !== 'settings' ? (
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
                        ? 'bg-iron-700 text-chalk'
                        : 'bg-iron-900 text-iron-400 hover:bg-iron-850'
                    }`}
                  >
                    Semana {candidate.number}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {tab === 'day' ? (
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
                        ? 'bg-signal-500 text-iron-950'
                        : 'bg-iron-900 text-iron-400 hover:bg-iron-850'
                    }`}
                  >
                    <span>Día {candidate.number}</span>
                    {candidate.completed ? (
                      <>
                        <Icon name="check" size={14} />
                        <span className="sr-only">completada</span>
                      </>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>

      <main>
        {tab === 'home' ? (
          <HomeScreen week={week} weekCount={program.weeks.length} onOpenDay={openDay} />
        ) : null}

        {tab === 'day' ? (
          <div className="space-y-4">
            <RestTimer />
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
          </div>
        ) : null}

        {tab === 'progress' ? <ProgressScreen week={week} /> : null}

        {tab === 'settings' ? (
          <SettingsScreen
            programs={state.programs}
            currentProgramId={program.id}
            currentProgramName={program.name}
            importing={state.importing}
            offline={state.offline}
            onFile={async (file) => {
              await state.importFile(file);
              setTab('home');
            }}
            onSelectProgram={async (programId) => {
              await state.selectProgram(programId);
              setTab('home');
            }}
            onDeleteProgram={async (programId) => {
              await state.deleteProgram(programId);
            }}
          />
        ) : null}
      </main>

      <BottomNav
        current={tab}
        onChange={setTab}
        dayLabel={day.type ? `Día ${day.number}` : `Día ${day.number}`}
      />
    </div>
  );
}
