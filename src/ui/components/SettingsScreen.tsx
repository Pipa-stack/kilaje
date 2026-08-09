import { useState } from 'react';

import * as api from '../../api/client';
import { ApiError, type ProgramSummary } from '../../api/client';
import { MIN_PASSWORD_LENGTH } from '../../domain/upload';
import type { ThemeChoice } from '../hooks/useTheme';
import { Dropzone } from './Dropzone';

interface SettingsScreenProps {
  programs: ProgramSummary[];
  currentProgramId: number;
  currentProgramName: string;
  importing: boolean;
  offline: boolean;
  onFile: (file: File) => Promise<void>;
  onSelectProgram: (programId: number) => Promise<void>;
  onDeleteProgram: (programId: number) => Promise<void>;
  email: string;
  theme: { choice: ThemeChoice; select: (choice: ThemeChoice) => void };
  onSignOut: () => Promise<void>;
}

const THEME_OPTIONS: { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'Sistema' },
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Oscuro' },
];

/** Programs, importing, and what the app is doing with the data. */
export function SettingsScreen({
  programs,
  currentProgramId,
  currentProgramName,
  importing,
  offline,
  onFile,
  onSelectProgram,
  onDeleteProgram,
  email,
  theme,
  onSignOut,
}: SettingsScreenProps) {
  return (
    <div className="space-y-4">
      <section aria-labelledby="theme-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <h2 id="theme-title" className="mb-1 font-semibold text-chalk">
          Aspecto
        </h2>
        <p className="mb-3 text-sm text-iron-400">
          «Sistema» sigue la preferencia del móvil y cambia sola al anochecer.
        </p>
        <div role="group" aria-label="Tema" className="flex gap-2">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => theme.select(option.id)}
              aria-pressed={theme.choice === option.id}
              className={`min-h-11 flex-1 rounded-xl border text-sm font-semibold transition-colors ${
                theme.choice === option.id
                  ? 'border-signal-500 bg-signal-500/10 text-signal-300'
                  : 'border-iron-700 text-iron-400 hover:bg-iron-850'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="import-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <h2 id="import-title" className="mb-1 font-semibold text-chalk">
          Importar entrenamiento
        </h2>
        <p className="mb-3 text-sm text-iron-400">
          Sube tu plantilla .xlsx. Se crea un programa nuevo: los anteriores y su historial
          se conservan.
        </p>
        <Dropzone
          onFile={onFile}
          disabled={importing || offline}
          label={importing ? 'Importando…' : 'Arrastra tu Excel o toca para elegirlo'}
          hint={
            offline
              ? 'Necesitas conexión para importar.'
              : 'Archivos .xlsx hasta 10 MB. Se procesa en el servidor.'
          }
        />
      </section>

      <section aria-labelledby="programs-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <h2 id="programs-title" className="mb-1 font-semibold text-chalk">
          Programas guardados
        </h2>
        <p className="mb-3 text-sm text-iron-400">
          {programs.length} {programs.length === 1 ? 'programa' : 'programas'} en la base de datos.
        </p>

        <ul className="space-y-2">
          {programs.map((program) => {
            const isCurrent = program.id === currentProgramId;
            return (
              <li
                key={program.id}
                className={`rounded-xl border px-3 py-3 ${
                  isCurrent ? 'border-signal-500/50 bg-signal-500/5' : 'border-iron-800 bg-iron-850'
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <h3 className="min-w-0 flex-1 truncate font-semibold text-chalk">
                    {program.name}
                  </h3>
                  {isCurrent ? (
                    <span className="shrink-0 rounded-full bg-signal-500/20 px-2 py-0.5 text-xs font-semibold text-signal-300">
                      En uso
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-iron-600">
                  {program.weekCount} {program.weekCount === 1 ? 'semana' : 'semanas'} ·{' '}
                  {program.dayCount} sesiones · {program.completedDays} completadas ·{' '}
                  {formatDate(program.importedAt)}
                </p>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={isCurrent}
                    onClick={() => void onSelectProgram(program.id)}
                    className="min-h-11 flex-1 rounded-xl border border-iron-700 px-3 text-sm font-semibold text-iron-100 hover:bg-iron-800 disabled:pointer-events-none disabled:opacity-40"
                  >
                    {isCurrent ? 'Abierto' : 'Abrir'}
                  </button>
                  <button
                    type="button"
                    disabled={programs.length === 1}
                    onClick={() => {
                      const message =
                        `¿Borrar "${program.name}"?\n\n` +
                        'Se eliminan también todas las series, notas y sesiones ' +
                        'registradas en ese programa. No se puede deshacer.';
                      if (confirm(message)) void onDeleteProgram(program.id);
                    }}
                    className="min-h-11 rounded-xl px-3 text-sm font-semibold text-iron-600 hover:bg-red-500/10 hover:text-red-300 disabled:pointer-events-none disabled:opacity-30"
                  >
                    Borrar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="about-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <h2 id="about-title" className="mb-2 font-semibold text-chalk">
          Sobre tus datos
        </h2>
        <ul className="space-y-2 text-sm text-iron-400">
          <Fact label="Guardado en">PostgreSQL. Se conserva aunque cambies de dispositivo.</Fact>
          <Fact label="Sin conexión">
            Se guarda una copia en este navegador para poder consultar el entrenamiento.
          </Fact>
          <Fact label="Programa actual">{currentProgramName}</Fact>
          <Fact label="Cálculos">
            1RM por Epley sobre la serie 1, volumen como Σ peso × reps, y progresión según el
            RIR de la semana anterior — las mismas fórmulas del Excel.
          </Fact>
        </ul>
      </section>

      <section aria-labelledby="account-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <h2 id="account-title" className="mb-1 font-semibold text-chalk">
          Tu cuenta
        </h2>
        <p className="mb-3 break-all text-sm text-iron-400">{email}</p>

        <PasswordForm />

        <button
          type="button"
          onClick={() => void onSignOut()}
          className="mt-3 min-h-11 w-full rounded-xl border border-iron-700 text-sm font-semibold text-iron-100 hover:bg-iron-850"
        >
          Cerrar sesión
        </button>
      </section>
    </div>
  );
}

/**
 * Changing the password.
 *
 * The current one is required, so a session left open on a shared phone
 * cannot be used to lock the owner out. On success the server also revokes
 * every other session, which is the point of changing it.
 */
function PasswordForm() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setDone(false);
        }}
        className="min-h-11 w-full rounded-xl border border-iron-700 text-sm font-semibold text-iron-100 hover:bg-iron-850"
      >
        {done ? 'Contraseña cambiada' : 'Cambiar contraseña'}
      </button>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        api
          .changePassword(current, next)
          .then(() => {
            setOpen(false);
            setDone(true);
            setCurrent('');
            setNext('');
          })
          .catch((cause: unknown) => {
            setError(
              cause instanceof ApiError ? cause.message : 'No se ha podido cambiar la contraseña.',
            );
          })
          .finally(() => setBusy(false));
      }}
    >
      <label className="block">
        <span className="eyebrow mb-1 block">Contraseña actual</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          className="w-full rounded-xl border border-iron-700 bg-iron-850 px-3 py-2.5 text-chalk focus:border-signal-400 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="eyebrow mb-1 block">Contraseña nueva</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          className="w-full rounded-xl border border-iron-700 bg-iron-850 px-3 py-2.5 text-chalk focus:border-signal-400 focus:outline-none"
        />
      </label>

      <p className="text-xs text-iron-600">
        Mínimo {MIN_PASSWORD_LENGTH} caracteres. Se cerrarán las sesiones abiertas en otros
        dispositivos.
      </p>

      <div role="alert" aria-live="polite">
        {error ? (
          <p className="rounded-xl border border-effort-500/40 bg-effort-500/10 px-3 py-2 text-sm text-effort-300">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 flex-1 rounded-xl bg-signal-500 text-sm font-bold text-iron-950 hover:bg-signal-400 disabled:opacity-60"
        >
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="min-h-11 rounded-xl px-4 text-sm font-semibold text-iron-400 hover:bg-iron-850"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li>
      <span className="block text-xs uppercase tracking-wide text-iron-600">{label}</span>
      <span className="block text-iron-100">{children}</span>
    </li>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'fecha desconocida';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}
