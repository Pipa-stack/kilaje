import { useId, useState } from 'react';

import * as api from '../../api/client';
import { ApiError } from '../../api/client';
import { MIN_PASSWORD_LENGTH } from '../../domain/upload';

interface ResetPasswordScreenProps {
  /** Taken from `#reset=` in the link the email carried. */
  token: string;
  /** Called once the password is set, to return to a clean sign-in. */
  onDone: () => void;
}

/** Choosing a new password from a reset link. */
export function ResetPasswordScreen({ token, onDone }: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fieldId = useId();

  if (done) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
        <h1 className="font-condensed text-4xl font-bold uppercase leading-none text-chalk">
          Listo
        </h1>
        <p className="text-iron-400">
          Tu contraseña es nueva y se han cerrado todas las sesiones abiertas. Entra otra vez.
        </p>
        <button
          type="button"
          onClick={onDone}
          className="min-h-12 w-full rounded-xl bg-signal-500 font-condensed text-lg font-bold uppercase tracking-wide text-iron-950 hover:bg-signal-400"
        >
          Ir a entrar
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <header className="space-y-2">
        <h1 className="font-condensed text-4xl font-bold uppercase leading-none text-chalk">
          Nueva contraseña
        </h1>
        <p className="text-iron-400">
          Elige una contraseña. Al guardarla se cerrarán todas las sesiones abiertas, también las
          de quien no debiera tenerlas.
        </p>
      </header>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          api
            .resetPassword(token, password)
            .then(() => setDone(true))
            .catch((cause: unknown) => {
              setError(
                cause instanceof ApiError
                  ? cause.message
                  : 'No se ha podido cambiar la contraseña.',
              );
            })
            .finally(() => setBusy(false));
        }}
      >
        <div>
          <label htmlFor={fieldId} className="eyebrow mb-1 block">
            Contraseña nueva
          </label>
          <input
            id={fieldId}
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
            className="w-full rounded-xl border border-iron-700 bg-iron-850 px-3 py-3 text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
          />
        </div>

        <div role="alert" aria-live="polite">
          {error ? (
            <p className="rounded-xl border border-effort-500/40 bg-effort-500/10 px-3 py-2 text-sm text-effort-300">
              {error}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full rounded-xl bg-signal-500 font-condensed text-lg font-bold uppercase tracking-wide text-iron-950 hover:bg-signal-400 disabled:opacity-60"
        >
          {busy ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>

      <button
        type="button"
        onClick={onDone}
        className="text-center text-sm font-semibold text-signal-300 underline underline-offset-4"
      >
        Cancelar
      </button>
    </main>
  );
}
