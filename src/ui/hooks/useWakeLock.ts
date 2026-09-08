import { useEffect, useRef } from 'react';

/**
 * Keeps the screen awake while something is in progress.
 *
 * Between two sets a phone locks itself, and unlocking it with chalk on your
 * hands to write down 100 × 5 is the kind of friction that ends with the set
 * not being written down at all.
 *
 * Best-effort by design. `wakeLock` is missing on some browsers and refused on
 * others (an unfocused tab, a battery-saver mode), and none of that is worth
 * an error: the failure mode is the screen behaving exactly as it does today.
 * So every call is wrapped and every rejection swallowed.
 */
export function useWakeLock(active: boolean): void {
  const sentinel = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    const request = async () => {
      // The browser drops the lock whenever the page is hidden, and does not
      // give it back on return. Asking again on visibility change is what
      // makes the lock survive a glance at a message mid-session.
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        sentinel.current = await navigator.wakeLock.request('screen');
      } catch {
        /* unsupported, or refused; the screen just behaves normally */
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void request();
    };

    void request();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel.current?.release().catch(() => {
        /* already gone */
      });
      sentinel.current = null;
    };
  }, [active]);
}
