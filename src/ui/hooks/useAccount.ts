/**
 * Who is signed in.
 *
 * The session is an httpOnly cookie, so the browser cannot inspect it: the
 * only way to know is to ask the server once on load.
 */

import { useCallback, useEffect, useState } from 'react';

import * as api from '../../api/client';
import { ApiError, type Account } from '../../api/client';

export interface AccountState {
  account: Account | null;
  /** True until the first `/auth/me` answers. */
  checking: boolean;
  /**
   * The server could not be reached, so whether there is a session is
   * unknown. The app carries on with the cached program rather than throwing
   * the user back to a login screen they cannot complete without a network.
   */
  offline: boolean;
  busy: boolean;
  error: string | null;
  submit: (mode: 'login' | 'register', email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAccount(): AccountState {
  const [account, setAccount] = useState<Account | null>(null);
  const [checking, setChecking] = useState(true);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .fetchAccount()
      .then((found) => {
        if (cancelled) return;
        setAccount(found);
        setOffline(false);
      })
      .catch((cause: unknown) => {
        // A 401 already resolved to `null`; reaching here means the request
        // itself failed, which says nothing about whether we are signed in.
        if (!cancelled && cause instanceof ApiError && cause.isOffline) setOffline(true);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(
    async (mode: 'login' | 'register', email: string, password: string) => {
      setBusy(true);
      setError(null);
      try {
        setAccount(
          mode === 'register' ? await api.register(email, password) : await api.login(email, password),
        );
      } catch (cause) {
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'No se ha podido completar la operación. Inténtalo de nuevo.',
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Even if the request fails the local session is over; the cookie is
      // cleared server-side on the next successful call.
    }
    setAccount(null);
  }, []);

  return { account, checking, offline, busy, error, submit, signOut };
}
