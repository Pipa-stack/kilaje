import { useState, type FormEvent } from 'react';

import * as api from '../../api/client';

interface DeleteAccountProps {
  /** Lo que hay que hacer después: vaciar el dispositivo y volver a la entrada. */
  onDeleted: () => Promise<void>;
}

/**
 * Darse de baja.
 *
 * Escondido detrás de un segundo paso y con la contraseña, como cambiarla:
 * no hay forma de deshacerlo, así que no puede pasar de un toque sin querer.
 */
export function DeleteAccount({ onDeleted }: DeleteAccountProps) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 min-h-11 w-full rounded-xl text-sm font-semibold text-iron-400 hover:bg-effort-500/10 hover:text-effort-300"
      >
        Borrar mi cuenta
      </button>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      await onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se ha podido borrar la cuenta.');
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-label="Borrar mi cuenta"
      className="mt-3 space-y-3 rounded-xl border border-effort-500/40 bg-effort-500/5 p-3"
    >
      <p className="text-sm text-iron-100">
        Se borran tu cuenta, tus planes, todo lo que has anotado y tus reservas. <strong>No se puede
        deshacer.</strong>
      </p>
      <label className="block space-y-1">
        <span className="eyebrow block">Tu contraseña</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="w-full rounded-lg border border-iron-700 bg-iron-850 px-3 py-2.5 text-chalk focus:border-signal-400 focus:outline-none"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-effort-300">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || password === ''}
          className="min-h-11 flex-1 rounded-xl bg-effort-500 px-3 text-sm font-semibold text-white hover:bg-effort-500/90 disabled:opacity-40"
        >
          {busy ? 'Borrando…' : 'Borrar para siempre'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPassword('');
            setError(null);
          }}
          disabled={busy}
          className="min-h-11 rounded-xl border border-iron-700 px-4 text-sm font-semibold text-iron-100 hover:bg-iron-850"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
