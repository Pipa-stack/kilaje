import { useState } from 'react';

import { AuthScreen } from './components/AuthScreen';
import { BottomNav, type Tab } from './components/BottomNav';
import { DayView } from './components/DayView';
import { HomeScreen } from './components/HomeScreen';
import { Icon } from './components/Icon';
import { ImportScreen } from './components/ImportScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { ProgressScreen } from './components/ProgressScreen';
import { WeekManager } from './components/WeekManager';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { RestTimer } from './components/RestTimer';
import { SettingsScreen } from './components/SettingsScreen';
import { useAccount } from './hooks/useAccount';
import { useProgram } from './hooks/useProgram';
import { useSwipe } from './hooks/useSwipe';
import { useTheme } from './hooks/useTheme';

/**
 * The token an emailed reset link carries, if this is one.
 *
 * The fragment is where new links put it, because a fragment never reaches a
 * server and so never reaches a log. The query string is still read so that a
 * link sent before this change still works for the hour it stays valid.
 */
function readResetToken(): string {
  const fromFragment = new URLSearchParams(window.location.hash.slice(1)).get('reset');
  return fromFragment ?? new URLSearchParams(window.location.search).get('reset') ?? '';
}

export default function App() {
  const auth = useAccount();
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('home');
  const [resetToken, setResetToken] = useState(readResetToken);

  // A reset link outranks everything: the person following it cannot sign in,
  // which is the whole reason they are here.
  if (resetToken) {
    return (
      <ResetPasswordScreen
        token={resetToken}
        onDone={() => {
          window.history.replaceState(null, '', window.location.pathname);
          setResetToken('');
        }}
      />
    );
  }

  // Nothing loads the training data until we know who is asking.
  if (auth.checking) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <p role="status" className="text-iron-400">
          Un momento…
        </p>
      </main>
    );
  }

  // Offline, whether there is a session is unknown. Showing a login form
  // nobody can submit would be worse than showing the cached workout.
  if (!auth.account && !auth.offline) {
    return <AuthScreen onSubmit={auth.submit} busy={auth.busy} error={auth.error} />;
  }

  return (
    <SignedIn
      theme={theme}
      onSignOut={auth.signOut}
      email={auth.account?.email ?? 'sin conexión'}
      tab={tab}
      setTab={setTab}
    />
  );
}

interface SignedInProps {
  theme: ReturnType<typeof useTheme>;
  onSignOut: () => Promise<void>;
  email: string;
  tab: Tab;
  setTab: (tab: Tab) => void;
}

/** The app proper. Mounted only once there is a session. */
function SignedIn({ theme, onSignOut, email, tab, setTab }: SignedInProps) {
  const state = useProgram();

  // Swiping left goes forward, the way pages turn. Declared before any early
  // return, because hooks must run in the same order on every render. The
  // prev/next buttons stay: a gesture is invisible and unreachable by keyboard.
  const swipeArea = useSwipe<HTMLDivElement>({
    enabled: tab === 'day',
    onSwipeLeft: () => state.goToAdjacentDay(1),
    onSwipeRight: () => state.goToAdjacentDay(-1),
  });

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
            className="rounded-xl border border-signal-500/40 bg-signal-500/10 px-3 py-2 text-sm text-signal-300"
          >
            Sin conexión con el servidor. Puedes seguir entrenando: se muestran los últimos
            datos de este dispositivo y lo que anotes se envía solo cuando vuelva la conexión.
            {state.pendingWrites > 0 ? (
              <span className="mt-1 block font-semibold">
                {state.pendingWrites} {state.pendingWrites === 1 ? 'cambio' : 'cambios'} en espera.
              </span>
            ) : null}
          </p>
        ) : state.syncStalled && state.pendingWrites > 0 ? (
          <p role="status" className="rounded-xl border border-iron-700 px-3 py-2 text-sm text-iron-400">
            Enviando {state.pendingWrites} {state.pendingWrites === 1 ? 'cambio' : 'cambios'}…
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

        {tab !== 'settings' ? (
          <WeekManager
            weeks={program.weeks}
            currentWeek={week}
            busy={state.addingWeek || state.editingPlan}
            offline={state.offline}
            onSelectWeek={state.selectWeek}
            onAddWeek={({ copyWeights }) => void state.addWeek({ copyWeights })}
            onDeleteWeek={(weekNumber) => void state.deleteWeek(weekNumber)}
          />
        ) : null}

        {tab === 'day' ? (
          <nav aria-label="Días de la semana">
            <ul data-no-swipe className="flex gap-2 overflow-x-auto pb-1">
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
          <div ref={swipeArea} className="space-y-4">
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
              editingPlan={state.editingPlan}
              offline={state.offline}
              onUpdateExercise={state.updateExercise}
              onMoveExercise={(exerciseId, offset) => void state.moveExercise(exerciseId, offset)}
              onRemoveExercise={(exerciseId) => void state.removeExercise(exerciseId)}
              onAddExercise={(name) => void state.addExercise(name)}
            />
          </div>
        ) : null}

        {tab === 'progress' ? <ProgressScreen week={week} weeks={program.weeks} /> : null}

        {tab === 'settings' ? (
          <div className="space-y-4">
            <ProfileScreen email={email} />
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
              email={email}
              theme={theme}
              onSignOut={onSignOut}
            />
          </div>
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
