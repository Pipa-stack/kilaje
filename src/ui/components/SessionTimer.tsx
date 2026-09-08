import { useEffect, useState } from 'react';

import { formatDuration, isTimerRunaway, sessionSeconds } from '../../domain/calculations';
import type { Day } from '../../domain/types';
import { useWakeLock } from '../hooks/useWakeLock';
import { Icon } from './Icon';

interface SessionTimerProps {
  day: Day;
  onSetRunning: (running: boolean) => void;
  /** Throws away the time banked so far, for a clock left running overnight. */
  onDiscard: () => void;
}

/**
 * How long this session has taken.
 *
 * A different clock from {@link RestTimer}, which counts down between sets.
 * This one counts up across the whole session and is saved with it, so the
 * question "am I taking 50 minutes or 80?" has an answer next month.
 *
 * The number comes from a stored instant, never from a counter, so closing
 * the app or letting the phone sleep does not lose or invent time.
 */
export function SessionTimer({ day, onSetRunning, onDiscard }: SessionTimerProps) {
  const running = day.timerStartedAt !== null;
  const [seconds, setSeconds] = useState(() => sessionSeconds(day));

  // The screen stays lit only while the clock runs — not for the whole visit
  // to the day, which would burn a phone's battery while you read the plan.
  useWakeLock(running);

  useEffect(() => {
    setSeconds(sessionSeconds(day));
    if (!running) return;

    const id = setInterval(() => setSeconds(sessionSeconds(day)), 1000);
    return () => clearInterval(id);
  }, [day, running]);

  // Left running rather than used: the phone went into a bag with the clock
  // on. Adding those hours in silence would poison the average for good, so
  // the decision goes back to the person who was there.
  if (isTimerRunaway(day)) {
    return (
      <section
        aria-labelledby="session-timer-title"
        className="rounded-xl border border-signal-500/40 bg-signal-500/10 p-3"
      >
        <h3 id="session-timer-title" className="text-sm font-semibold text-signal-300">
          El cronómetro lleva {formatDuration(seconds)} en marcha
        </h3>
        <p className="mt-1 text-sm text-iron-100">
          Parece que se quedó puesto. ¿Guardo ese tiempo o lo descarto?
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onSetRunning(false)}
            className="min-h-11 flex-1 rounded-xl border border-iron-700 px-3 text-sm font-semibold text-iron-100 hover:bg-iron-850"
          >
            Guardarlo
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="min-h-11 flex-1 rounded-xl bg-signal-500 px-3 text-sm font-bold text-iron-950 hover:bg-signal-400"
          >
            Descartarlo
          </button>
        </div>
      </section>
    );
  }

  const started = running || seconds > 0;

  return (
    <div className="flex items-center gap-3">
      <div>
        <span className="eyebrow block">Duración</span>
        <span
          role="timer"
          aria-label="Duración de la sesión"
          aria-live="off"
          className={`figure text-2xl font-bold tabular-nums ${
            running ? 'text-chalk' : 'text-iron-400'
          }`}
        >
          {formatDuration(seconds)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onSetRunning(!running)}
        className={`flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold transition-colors ${
          running
            ? 'border border-iron-700 text-iron-100 hover:bg-iron-850'
            : 'bg-signal-500 text-iron-950 hover:bg-signal-400'
        }`}
      >
        <Icon name={running ? 'pause' : 'play'} size={16} />
        {running ? 'Pausar' : started ? 'Reanudar' : 'Empezar'}
      </button>
    </div>
  );
}
