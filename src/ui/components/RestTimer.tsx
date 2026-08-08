import { useCallback, useEffect, useState } from 'react';

const PRESETS = [60, 90, 120, 180] as const;

/**
 * Rest timer between sets.
 *
 * Time is measured from a wall-clock deadline rather than by counting
 * intervals: a phone that sleeps mid-rest resumes with the correct number,
 * which a `setInterval` counter would not.
 */
export function RestTimer() {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [duration, setDuration] = useState(90);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (deadline === null) return;

    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        setDeadline(null);
        setFinished(true);
      }
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);

  const start = useCallback((seconds: number) => {
    setDuration(seconds);
    setFinished(false);
    setDeadline(Date.now() + seconds * 1000);
  }, []);

  const stop = useCallback(() => {
    setDeadline(null);
    setRemaining(0);
    setFinished(false);
  }, []);

  const running = deadline !== null;
  const progress = running && duration > 0 ? 1 - remaining / duration : 0;

  return (
    <section
      aria-labelledby="rest-timer-title"
      className="rounded-2xl border border-ink-800 bg-ink-900 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="rest-timer-title" className="text-sm font-semibold text-ink-50">
          Descanso
        </h2>
        {running ? (
          <button
            type="button"
            onClick={stop}
            className="min-h-11 rounded-xl px-3 text-sm font-semibold text-ink-400 hover:bg-ink-850 hover:text-ink-200"
          >
            Parar
          </button>
        ) : null}
      </div>

      {running ? (
        <div className="mt-2">
          <p
            role="timer"
            aria-live="off"
            className="text-center text-4xl font-bold tabular-nums text-ink-50"
          >
            {formatSeconds(remaining)}
          </p>
          <div
            aria-hidden="true"
            className="mt-2 h-2 overflow-hidden rounded-full bg-ink-800"
          >
            <div
              className="h-full rounded-full bg-accent-500 transition-[width] duration-200"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2 flex gap-2">
            {PRESETS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                onClick={() => start(seconds)}
                className="min-h-12 flex-1 rounded-xl border border-ink-700 text-sm font-semibold tabular-nums text-ink-200 hover:border-accent-400 hover:bg-ink-850"
              >
                {formatSeconds(seconds)}
              </button>
            ))}
          </div>
          <p role="status" className="mt-2 text-center text-xs text-ink-600">
            {finished ? '¡Descanso terminado! A por la siguiente serie.' : 'Elige cuánto descansas entre series.'}
          </p>
        </>
      )}
    </section>
  );
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
