import { useId, useState } from 'react';

import * as api from '../../api/client';
import { MIN_PASSWORD_LENGTH } from '../../domain/upload';

interface AuthScreenProps {
  onSubmit: (mode: 'login' | 'register', email: string, password: string) => Promise<void>;
  busy: boolean;
  error: string | null;
}

/** Sign in, or create the account. Nothing else is reachable without one. */
export function AuthScreen({ onSubmit, busy, error }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [recovery, setRecovery] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const emailId = useId();
  const passwordId = useId();

  const registering = mode === 'register';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-4 py-12">
      <header className="space-y-2">
        <h1 className="font-condensed text-5xl font-bold uppercase leading-none tracking-tight text-chalk">
          Kilaje
        </h1>
        <p className="text-iron-400">
          Tu plantilla de Excel, convertida en algo que se puede usar con una mano entre serie
          y serie.
        </p>
      </header>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(mode, email, password);
        }}
      >
        <div>
          <label htmlFor={emailId} className="eyebrow mb-1 block">
            Correo
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-iron-700 bg-iron-850 px-3 py-3 text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
            placeholder="tu@correo.com"
          />
        </div>

        <div>
          <label htmlFor={passwordId} className="eyebrow mb-1 block">
            Contraseña
          </label>
          <input
            id={passwordId}
            type="password"
            // Tells the password manager whether to offer a saved entry or
            // to generate a new one.
            autoComplete={registering ? 'new-password' : 'current-password'}
            required
            minLength={registering ? MIN_PASSWORD_LENGTH : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-iron-700 bg-iron-850 px-3 py-3 text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
            placeholder={registering ? `Mínimo ${MIN_PASSWORD_LENGTH} caracteres` : ''}
          />
          {registering ? (
            <p className="mt-1 text-xs text-iron-600">
              Mínimo {MIN_PASSWORD_LENGTH} caracteres. Se guarda cifrada con scrypt; nadie puede
              leerla, tampoco nosotros.
            </p>
          ) : null}
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
          className="min-h-12 w-full rounded-xl bg-signal-500 font-condensed text-lg font-bold uppercase tracking-wide text-iron-950 transition-colors hover:bg-signal-400 disabled:opacity-60"
        >
          {busy ? 'Un momento…' : registering ? 'Crear cuenta' : 'Entrar'}
        </button>
      </form>

      {!registering ? (
        <div className="text-center">
          {recovery === 'sent' ? (
            <p role="status" className="text-sm text-iron-400">
              Si ese correo tiene cuenta, te llegará un enlace para elegir contraseña nueva.
              Caduca en una hora.
            </p>
          ) : (
            <button
              type="button"
              disabled={recovery === 'sending' || email.trim() === ''}
              onClick={() => {
                setRecovery('sending');
                // The answer is the same whether or not the address exists, so
                // there is nothing to branch on here either.
                void api.requestPasswordReset(email).finally(() => setRecovery('sent'));
              }}
              className="text-sm font-semibold text-signal-300 underline underline-offset-4 disabled:no-underline disabled:opacity-50"
            >
              {recovery === 'sending'
                ? 'Enviando…'
                : email.trim() === ''
                  ? 'Escribe tu correo para recuperarla'
                  : 'He olvidado la contraseña'}
            </button>
          )}
        </div>
      ) : null}

      <p className="text-center text-sm text-iron-400">
        {registering ? '¿Ya tienes cuenta?' : '¿Primera vez?'}{' '}
        <button
          type="button"
          onClick={() => setMode(registering ? 'login' : 'register')}
          className="font-semibold text-signal-300 underline underline-offset-4 hover:text-signal-400"
        >
          {registering ? 'Entrar' : 'Crear una cuenta'}
        </button>
      </p>
    </main>
  );
}
