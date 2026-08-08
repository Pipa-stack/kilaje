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
        alertDone();
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
      className="rounded-2xl border border-iron-800 bg-iron-900 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="rest-timer-title" className="text-sm font-semibold text-chalk">
          Descanso
        </h2>
        {running ? (
          <button
            type="button"
            onClick={stop}
            className="min-h-11 rounded-xl px-3 text-sm font-semibold text-iron-400 hover:bg-iron-850 hover:text-iron-100"
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
            className="figure text-center text-6xl font-bold text-chalk"
          >
            {formatSeconds(remaining)}
          </p>
          <div
            aria-hidden="true"
            className="mt-2 h-2 overflow-hidden rounded-full bg-iron-800"
          >
            <div
              className="h-full rounded-full bg-signal-500 transition-[width] duration-200"
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
                className="figure min-h-12 flex-1 rounded-xl border border-iron-700 text-base font-semibold text-iron-100 hover:border-signal-400 hover:bg-iron-850"
              >
                {formatSeconds(seconds)}
              </button>
            ))}
          </div>
          <p role="status" className="mt-2 text-center text-xs text-iron-600">
            {finished ? '¡Descanso terminado! A por la siguiente serie.' : 'Elige cuánto descansas entre series.'}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Announces the end of the rest.
 *
 * The phone is usually in a pocket or face down on a bench, so a number
 * reaching zero on screen is not an alert. Vibration is the reliable channel;
 * the tone is a fallback for devices without a motor, generated with the
 * Web Audio API so there is no audio file to ship or to fail to load.
 *
 * Both are best-effort: browsers block them until the user has interacted
 * with the page, which by this point they have (they started the timer).
 */
function alertDone(): void {
  try {
    navigator.vibrate?.([220, 120, 220]);
  } catch {
    /* not supported, or blocked */
  }

  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.frequency.value = 880;
    oscillator.type = 'sine';
    // A short envelope instead of a hard stop, which clicks.
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.5);
    oscillator.onended = () => void context.close();
  } catch {
    /* audio unavailable */
  }
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
