/**
 * The app's single source of state.
 *
 * PostgreSQL is the source of truth. Every edit is applied to local state
 * immediately (so the UI never lags behind a thumb between sets) and sent to
 * the API right after; `localStorage` is kept as an offline cache so a dropped
 * connection in a basement gym shows the last known workout instead of an
 * empty screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { sessionSeconds } from '../../domain/calculations';
import type { Day, Program, Week } from '../../domain/types';
import {
  addSet as addSetTo,
  removeSet as removeSetFrom,
  resetDay as resetDayIn,
  setDayCompleted,
  setDayNotes,
  setDayTimer,
  setExerciseFields,
  setExerciseNotes,
  setExerciseSetup,
  updateSet as updateSetIn,
  type ExerciseFields,
  type SetPatch,
} from '../../domain/mutations';
import { TEMPLATE_SET_COUNT } from '../../domain/types';
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, TemplateError } from '../../domain/upload';
import * as api from '../../api/client';
import { ApiError, type ProgramSummary, type StoredProgram } from '../../api/client';
import {
  cacheProgram,
  loadCachedProgram,
  loadSelection,
  saveSelection,
  type Selection,
} from '../../storage/storage';
import {
  enqueue,
  operationKey,
  readOutbox,
  removeSent,
  type PendingOperation,
} from '../../storage/outbox';

/**
 * Performs one queued operation.
 *
 * Live writes and replayed ones go through here, so a change that failed
 * offline is retried by exactly the same code that would have sent it.
 */
async function performOperation(operation: PendingOperation): Promise<void> {
  switch (operation.kind) {
    case 'set':
      return api.saveSet(operation.dayId, {
        exerciseId: operation.exerciseId,
        setIndex: operation.setIndex,
        weight: operation.weight,
        reps: operation.reps,
        rir: operation.rir,
      });
    case 'deleteSet':
      return api.deleteSet(operation.dayId, {
        exerciseId: operation.exerciseId,
        setIndex: operation.setIndex,
      });
    case 'session':
      return api.updateSession(operation.dayId, {
        ...(operation.notes !== undefined ? { notes: operation.notes } : {}),
        ...(operation.completed !== undefined ? { completed: operation.completed } : {}),
        ...(operation.elapsedSeconds !== undefined
          ? { elapsedSeconds: operation.elapsedSeconds }
          : {}),
        ...(operation.timerRunning !== undefined ? { timerRunning: operation.timerRunning } : {}),
      });
    case 'exerciseNote':
      return api.saveExerciseNote(operation.dayId, operation.exerciseId, operation.note);
    case 'exerciseSetup':
      return api.saveExerciseSetup(operation.exerciseId, operation.note);
    case 'resetSession':
      return api.resetSession(operation.dayId);
  }
}

/** How long to wait after the last keystroke before writing notes to the API. */
const NOTES_DEBOUNCE_MS = 600;

/** 24 h, the same ceiling the column's CHECK enforces. */
const MAX_SESSION_SECONDS = 86_400;

export interface ProgramState {
  program: StoredProgram | null;
  programs: ProgramSummary[];
  week: Week | null;
  day: Day | null;
  loading: boolean;
  importing: boolean;
  /** True while the next week is being created on the server. */
  addingWeek: boolean;
  /** True while a structural edit to the plan is in flight. */
  editingPlan: boolean;
  error: string | null;
  /** True when the API is unreachable and the cached program is being shown. */
  offline: boolean;
  /** How many edits are waiting to reach the server. */
  pendingWrites: number;
  /** True once those edits have been waiting long enough to be worth saying. */
  syncStalled: boolean;

  importFile: (file: File) => Promise<void>;
  /** Starts an empty plan with `days` sessions, and opens it. */
  createBlank: (days: number) => Promise<void>;
  /** Appends a week cloned from the last one, then opens it. */
  addWeek: (options?: { copyWeights?: boolean }) => Promise<void>;
  /** Deletes a week. Refused by the server if it has training logged. */
  deleteWeek: (weekNumber: number) => Promise<void>;
  addExercise: (name: string) => Promise<void>;
  updateExercise: (exerciseId: string, fields: ExerciseFields) => void;
  moveExercise: (exerciseId: string, offset: -1 | 1) => Promise<void>;
  removeExercise: (exerciseId: string) => Promise<void>;
  selectProgram: (programId: number) => Promise<void>;
  deleteProgram: (programId: number) => Promise<void>;
  dismissError: () => void;
  selectWeek: (weekNumber: number) => void;
  selectDay: (dayNumber: number) => void;
  goToAdjacentDay: (offset: number) => void;
  updateSet: (exerciseId: string, setIndex: number, patch: SetPatch) => void;
  addSet: (exerciseId: string) => void;
  removeSet: (exerciseId: string, setIndex: number) => void;
  updateNotes: (notes: string) => void;
  /** What happened today on one exercise. Debounced like the day's notes. */
  updateExerciseNotes: (exerciseId: string, notes: string) => void;
  /** The permanent setup note, written to every week of the program. */
  updateExerciseSetup: (exerciseId: string, setup: string) => void;
  /** Starts or pauses the session clock, banking the seconds so far. */
  setTimerRunning: (running: boolean) => void;
  /** Throws the clock away, for one left running overnight. */
  resetTimer: () => void;
  toggleCompleted: () => void;
  resetDay: () => void;
}

export function useProgram(): ProgramState {
  const [program, setProgram] = useState<StoredProgram | null>(null);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [selection, setSelection] = useState<Selection | null>(() => loadSelection());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [addingWeek, setAddingWeek] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [pendingWrites, setPendingWrites] = useState(() => readOutbox().length);
  /**
   * True only once the queue has been stuck for a moment.
   *
   * Every write now passes through the queue, so `pendingWrites` ticks up and
   * back down on each keystroke. Wiring a banner straight to that would flash
   * "enviando…" over the screen while somebody types a weight. What is worth
   * telling them is that a write is *not* going through.
   */
  const [syncStalled, setSyncStalled] = useState(false);

  /** Latest program state, readable from callbacks without re-subscribing. */
  const latest = useRef<StoredProgram | null>(null);
  latest.current = program;

  /** Guards against two replays of the queue running at once. */
  const flushing = useRef(false);

  // Cache every version of the program we hold, so a reload while offline
  // still has something to show.
  useEffect(() => {
    if (program) cacheProgram(program);
  }, [program]);

  /**
   * Replays queued writes.
   *
   * Runs oldest first and stops at the first failure, so the queue keeps its
   * order and a still-dead connection does not burn through every entry. An
   * entry the server rejects on its merits (a 4xx: the day was deleted, the
   * value is invalid) is dropped rather than retried forever — but said out
   * loud, because it exists nowhere else.
   */
  const flushOutbox = useCallback(async () => {
    // Three things start a flush — a new write, the `online` event and a 20 s
    // poll — and a slow connection is exactly when they overlap. Without this
    // guard two flushes send the same entry twice and race each other's
    // removals.
    if (flushing.current) return;
    flushing.current = true;

    const rejected: PendingOperation[] = [];

    try {
      // Re-read each time round: an edit made while this was in flight belongs
      // to this pass too, and `removeSent` keys on the timestamp so a
      // correction that landed mid-send is never mistaken for what was sent.
      for (let entry = readOutbox()[0]; entry; entry = readOutbox()[0]) {
        try {
          await performOperation(entry.operation);
          setPendingWrites(removeSent(entry).length);
        } catch (cause) {
          if (cause instanceof ApiError && !cause.isOffline && cause.status < 500) {
            // The server refuses this one on its merits, so retrying forever
            // would only block the queue behind it. Dropping it is right;
            // dropping it in silence was not: the set was logged in a basement
            // with no signal, exists nowhere else, and the person had every
            // reason to believe it was saved. Say what was lost, and where.
            rejected.push(entry.operation);
            setPendingWrites(removeSent(entry).length);
            continue;
          }
          setOffline(true);
          return;
        }
      }
      setOffline(false);
    } finally {
      flushing.current = false;
      if (rejected.length > 0) setError(describeRejected(rejected));
    }
  }, []);

  /**
   * Records a write.
   *
   * Everything goes through the queue, including writes made with a perfectly
   * good connection. It looks like a detour and it is the only thing that
   * makes the order correct: while live writes went straight out and only
   * failures were queued, a value queued offline could be replayed on top of a
   * newer one sent live seconds later — the server ending up with the number
   * the user had already corrected — and a day cleared online came back from
   * the dead when the queue replayed the sets it had superseded.
   *
   * `enqueue` collapses repeats of the same target and lets a reset supersede
   * that day's pending sets, which is only true if the reset is in the queue
   * with them.
   */
  const send = useCallback(
    (operation: PendingOperation) => {
      setPendingWrites(enqueue(operation).length);
      void flushOutbox();
    },
    [flushOutbox],
  );

  /**
   * The program on screen and the day within it that an edit applies to.
   *
   * Read from the ref rather than from `program`, so a callback captured a
   * render ago still edits the state as it is now.
   */
  const currentTarget = useCallback((): { program: StoredProgram; day: Day } | null => {
    const current = latest.current;
    const day = resolveDay(resolveWeek(current, selection), selection);
    return current && day ? { program: current, day } : null;
  }, [selection]);

  /**
   * Puts a new program on the screen.
   *
   * The ref as well as the state, always. A second change in the same React
   * batch reads the program from the ref, and a ref left behind hands it the
   * state from before this edit — which is how a completed flag once wrote
   * itself straight back out.
   */
  const publish = useCallback((next: StoredProgram) => {
    latest.current = next;
    setProgram(next);
  }, []);

  /**
   * Applies a change locally first, then sends it.
   *
   * `send` receives the *already updated* program. Reading it back from the
   * ref instead would see the state from before this edit, because React has
   * not re-rendered yet — which silently dropped newly added sets.
   */
  const mutate = useCallback(
    (
      apply: (current: StoredProgram, dayId: string) => StoredProgram,
      describe: (next: StoredProgram, dayId: string) => PendingOperation | null,
    ) => {
      const target = currentTarget();
      if (!target) return;

      const next = apply(target.program, target.day.id);
      publish(next);

      const operation = describe(next, target.day.id);
      if (operation) send(operation);
    },
    [currentTarget, publish, send],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fetched, list] = await Promise.all([api.fetchLatestProgram(), api.fetchPrograms()]);
      setProgram(fetched);
      setPrograms(list);
      setOffline(false);
    } catch (cause) {
      const cached = loadCachedProgram();
      if (!cached) {
        setError(cause instanceof Error ? cause.message : 'No se ha podido cargar el entrenamiento.');
      } else if (cause instanceof ApiError && cause.isOffline) {
        // Genuinely offline: show the cached program rather than an empty app.
        setProgram(cached);
        setOffline(true);
      } else {
        // The server answered, it just answered badly — a revoked session, a
        // 500. Writes are only queued when the failure is `isOffline`, so the
        // offline banner would promise a sync that never happens and the user
        // would train a whole session believing it was being saved.
        setProgram(cached);
        setError(cause instanceof Error ? cause.message : 'No se ha podido cargar el entrenamiento.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (pendingWrites === 0) {
      setSyncStalled(false);
      return;
    }
    const timer = setTimeout(() => setSyncStalled(true), 1500);
    return () => clearTimeout(timer);
  }, [pendingWrites]);

  // Retry when the browser says the network is back, and once on load for a
  // queue left over from a previous session.
  useEffect(() => {
    void flushOutbox();

    const onOnline = () => void flushOutbox();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flushOutbox]);

  // `online` does not fire when the phone had signal but the server was down,
  // so a slow poll covers that case while anything is still queued.
  useEffect(() => {
    if (pendingWrites === 0) return;
    const timer = setInterval(() => void flushOutbox(), 20_000);
    return () => clearInterval(timer);
  }, [flushOutbox, pendingWrites]);

  const week = useMemo(() => resolveWeek(program, selection), [program, selection]);
  const day = useMemo(() => resolveDay(week, selection), [week, selection]);

  const select = useCallback((next: Selection) => {
    setSelection(next);
    saveSelection(next);
  }, []);

  const openProgram = useCallback(
    (next: StoredProgram) => {
      setProgram(next);
      const firstWeek = next.weeks[0];
      const firstDay = firstWeek?.days[0];
      if (firstWeek && firstDay) {
        select({ weekNumber: firstWeek.number, dayNumber: firstDay.number });
      }
    },
    [select],
  );

  const importFile = useCallback(
    async (file: File) => {
      setImporting(true);
      setError(null);
      try {
        validateFile(file);
        const imported = await api.importProgram(file);
        openProgram(imported);
        setPrograms(await api.fetchPrograms());
        setOffline(false);
      } catch (cause) {
        setError(toMessage(cause));
      } finally {
        setImporting(false);
      }
    },
    [openProgram],
  );

  const createBlank = useCallback(
    async (days: number) => {
      setImporting(true);
      setError(null);
      try {
        openProgram(await api.createBlankProgram(days));
        setPrograms(await api.fetchPrograms());
        setOffline(false);
      } catch (cause) {
        setError(
          cause instanceof ApiError ? cause.message : 'No se ha podido crear el plan.',
        );
      } finally {
        setImporting(false);
      }
    },
    [openProgram],
  );

  /**
   * Starts the next week and moves to it.
   *
   * Structural, so it never goes through the offline outbox: replaying a week
   * creation after the fact would race the reload that already has one.
   */
  const addWeek = useCallback(async (options: { copyWeights?: boolean } = {}) => {
    const current = latest.current;
    if (!current || addingWeek) return;

    setAddingWeek(true);
    setError(null);
    try {
      const next = await api.addWeek(current.id, options);
      publish(next);

      const added = next.weeks.at(-1);
      const firstDay = added?.days[0];
      if (added && firstDay) select({ weekNumber: added.number, dayNumber: firstDay.number });

      setPrograms(await api.fetchPrograms());
      setOffline(false);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'No se ha podido crear la semana siguiente.',
      );
    } finally {
      setAddingWeek(false);
    }
  }, [addingWeek, publish, select]);

  /**
   * Applies a structural change to the plan.
   *
   * These come back as a whole program because ids and positions move in ways
   * the client cannot predict, so there is no optimistic local version to
   * apply first — the screen waits for the server, which for a once-in-a-while
   * edit is honest rather than slow.
   */
  const editPlan = useCallback(
    async (change: (program: StoredProgram) => Promise<StoredProgram>) => {
      const current = latest.current;
      if (!current || editingPlan) return;

      setEditingPlan(true);
      setError(null);
      try {
        publish(await change(current));
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'No se ha podido cambiar el plan.');
      } finally {
        setEditingPlan(false);
      }
    },
    [editingPlan, publish],
  );

  const selectProgram = useCallback(
    async (programId: number) => {
      setError(null);
      try {
        openProgram(await api.fetchProgram(programId));
      } catch (cause) {
        setError(toMessage(cause));
      }
    },
    [openProgram],
  );

  /**
   * Deletes a program and its history. If it was the one on screen, the app
   * falls back to whatever remains rather than showing a program that no
   * longer exists.
   */
  const deleteProgram = useCallback(
    async (programId: number) => {
      setError(null);
      try {
        await api.deleteProgram(programId);
        const remaining = await api.fetchPrograms();
        setPrograms(remaining);

        if (latest.current?.id === programId) {
          const next = await api.fetchLatestProgram();
          if (next) openProgram(next);
          else setProgram(null);
        }
      } catch (cause) {
        setError(toMessage(cause));
      }
    },
    [openProgram],
  );

  /**
   * Text fields fire on every keystroke; only the last one needs to be sent.
   *
   * Keyed by what is being written — the day's notes, one exercise's note,
   * one setup note — rather than a single pending slot. With one slot, typing
   * in a second box within the debounce window discarded the first, which
   * then never reached the server and was lost on the next reload. Now every
   * box waits its own 600 ms and none can evict another.
   */
  const noteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingText = useRef(new Map<string, PendingOperation>());

  const flushText = useCallback(
    (key: string) => {
      const timer = noteTimers.current.get(key);
      if (timer) clearTimeout(timer);
      noteTimers.current.delete(key);

      const operation = pendingText.current.get(key);
      if (!operation) return;
      pendingText.current.delete(key);
      send(operation);
    },
    [send],
  );

  const flushAllText = useCallback(() => {
    for (const key of [...pendingText.current.keys()]) flushText(key);
  }, [flushText]);

  const debounceText = useCallback(
    (operation: PendingOperation) => {
      const key = operationKey(operation);
      pendingText.current.set(key, operation);

      const existing = noteTimers.current.get(key);
      if (existing) clearTimeout(existing);
      noteTimers.current.set(key, setTimeout(() => flushText(key), NOTES_DEBOUNCE_MS));
    },
    [flushText],
  );

  // Closing the tab or backgrounding the app must not eat what was typed in
  // the last 600 ms.
  useEffect(() => {
    const onHide = () => flushAllText();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    const timers = noteTimers.current;
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      for (const timer of timers.values()) clearTimeout(timer);
      flushAllText();
    };
  }, [flushAllText]);

  const goToAdjacentDay = useCallback(
    (offset: number) => {
      if (!week || !day) return;
      const index = week.days.findIndex((candidate) => candidate.number === day.number);
      const next = week.days[index + offset];
      if (next) select({ weekNumber: week.number, dayNumber: next.number });
    },
    [day, select, week],
  );

  return {
    program,
    programs,
    week,
    day,
    loading,
    importing,
    addingWeek,
    editingPlan,
    error,
    offline,
    pendingWrites,
    syncStalled,

    importFile,
    createBlank,
    addWeek,
    selectProgram,

    deleteWeek: useCallback(
      async (weekNumber: number) => {
        const current = latest.current;
        if (!current) return;
        await editPlan(async (program) => {
          const next = await api.removeWeek(program.id, weekNumber);
          // Standing on the week that just disappeared: fall back to the last
          // one left rather than leaving the app pointing at nothing.
          const fallback = next.weeks.at(-1);
          const firstDay = fallback?.days[0];
          if (fallback && firstDay) {
            select({ weekNumber: fallback.number, dayNumber: firstDay.number });
          }
          return next;
        });
      },
      [editPlan, select],
    ),

    addExercise: useCallback(
      async (name: string) => {
        const target = currentTarget();
        if (!target) return;
        await editPlan(() => api.addExercise(target.day.id, { name }));
      },
      [currentTarget, editPlan],
    ),

    /**
     * Renames an exercise, or edits its protocol, note or video.
     *
     * Applied locally and sent, like a set: the values are already known, so
     * waiting for a round trip to see your own typing would be silly.
     */
    updateExercise: useCallback(
      (exerciseId: string, fields: ExerciseFields) => {
        const target = currentTarget();
        if (!target) return;

        publish(setExerciseFields(target.program, target.day.id, exerciseId, fields));

        // Not queued, unlike a set: the plan is structural and replaying a
        // rename over a plan that has since been reorganised is worse than
        // not replaying it. So on failure the local copy is put back to
        // whatever the server actually holds, rather than left showing a name
        // that only exists on this phone.
        api.updateExercise(exerciseId, fields).catch((cause: unknown) => {
          setError(
            cause instanceof ApiError ? cause.message : 'No se ha podido guardar el ejercicio.',
          );
          api
            .fetchProgram(target.program.id)
            .then(publish)
            .catch(() => {
              /* offline too: the banner already says so */
            });
        });
      },
      [currentTarget, publish],
    ),

    moveExercise: useCallback(
      async (exerciseId: string, offset: -1 | 1) => {
        await editPlan(() => api.moveExercise(exerciseId, offset));
      },
      [editPlan],
    ),

    removeExercise: useCallback(
      async (exerciseId: string) => {
        await editPlan(() => api.removeExercise(exerciseId));
      },
      [editPlan],
    ),

    deleteProgram,
    dismissError: useCallback(() => setError(null), []),

    selectWeek: useCallback(
      (weekNumber: number) => {
        const target = program?.weeks.find((candidate) => candidate.number === weekNumber);
        const firstDay = target?.days[0];
        if (target && firstDay) select({ weekNumber, dayNumber: firstDay.number });
      },
      [program, select],
    ),

    selectDay: useCallback(
      (dayNumber: number) => {
        if (week) select({ weekNumber: week.number, dayNumber });
      },
      [select, week],
    ),

    goToAdjacentDay,

    updateSet: useCallback(
      (exerciseId: string, setIndex: number, patch: SetPatch) => {
        mutate(
          (current, dayId) => updateSetIn(current, dayId, exerciseId, setIndex, patch),
          (next, dayId) => {
            const set = findSet(next, dayId, exerciseId, setIndex);
            if (!set) return null;
            return { kind: 'set', dayId, exerciseId: Number(exerciseId), setIndex, ...set };
          },
        );
      },
      [mutate],
    ),

    addSet: useCallback(
      (exerciseId: string) => {
        mutate(
          (current, dayId) => addSetTo(current, dayId, exerciseId),
          (next, dayId) => {
            const exercise = findExercise(next, dayId, exerciseId);
            const index = (exercise?.currentWeek.length ?? 1) - 1;
            const set = exercise?.currentWeek[index];
            // A seeded weight is worth persisting; an empty slot is not.
            if (!set || (set.weight === null && set.reps === null && set.rir === null)) return null;
            return { kind: 'set', dayId, exerciseId: Number(exerciseId), setIndex: index, ...set };
          },
        );
      },
      [mutate],
    ),

    removeSet: useCallback(
      (exerciseId: string, setIndex: number) => {
        mutate(
          (current, dayId) => removeSetFrom(current, dayId, exerciseId, setIndex),
          (next, dayId) => {
            const exercise = Number(exerciseId);

            // A template slot is emptied in place: the row stays, the values go.
            if (setIndex < TEMPLATE_SET_COUNT) {
              return { kind: 'deleteSet', dayId, exerciseId: exercise, setIndex };
            }

            // An extra slot really disappears, so everything after it moves
            // down one index. Rewrite those, then delete what is now the
            // trailing index — deleting `setIndex` instead would leave the old
            // last set orphaned on the server, where the next reload finds it
            // and shows a duplicated set that also inflates the volume.
            const remaining = findExercise(next, dayId, exerciseId)?.currentWeek ?? [];
            for (let index = setIndex; index < remaining.length; index += 1) {
              const set = remaining[index];
              if (set) send({ kind: 'set', dayId, exerciseId: exercise, setIndex: index, ...set });
            }
            return { kind: 'deleteSet', dayId, exerciseId: exercise, setIndex: remaining.length };
          },
        );
      },
      [mutate, send],
    ),

    updateNotes: useCallback(
      (notes: string) => {
        mutate(
          (current, dayId) => setDayNotes(current, dayId, notes),
          (_next, dayId) => {
            debounceText({ kind: 'session', dayId, notes });
            return null;
          },
        );
      },
      [debounceText, mutate],
    ),

    updateExerciseNotes: useCallback(
      (exerciseId: string, notes: string) => {
        mutate(
          (current, dayId) => setExerciseNotes(current, dayId, exerciseId, notes),
          (_next, dayId) => {
            debounceText({
              kind: 'exerciseNote',
              dayId,
              exerciseId: Number(exerciseId),
              note: notes,
            });
            return null;
          },
        );
      },
      [debounceText, mutate],
    ),

    /**
     * The permanent setup note.
     *
     * Not routed through `mutate`, which edits within the day on screen: this
     * one rewrites every week of the program at once, because it describes
     * the movement rather than the session. The server does the same on its
     * side, keyed by lineage.
     */
    updateExerciseSetup: useCallback(
      (exerciseId: string, setup: string) => {
        const target = currentTarget();
        if (!target) return;

        const exercise = findExercise(target.program, target.day.id, exerciseId);
        if (!exercise) return;

        publish(setExerciseSetup(target.program, exercise.lineage, setup));

        debounceText({
          kind: 'exerciseSetup',
          dayId: target.day.id,
          exerciseId: Number(exerciseId),
          note: setup,
        });
      },
      [currentTarget, debounceText, publish],
    ),

    /**
     * Starts or pauses the session clock.
     *
     * The seconds run so far are banked here, on the device that watched them
     * pass. The server stores what it is told rather than stamping its own
     * clock: a pause that waits an hour in the offline queue must not arrive
     * as an hour of training.
     */
    setTimerRunning: useCallback(
      (running: boolean) => {
        const target = currentTarget();
        if (!target) return;

        const elapsedSeconds = Math.min(sessionSeconds(target.day), MAX_SESSION_SECONDS);
        publish(
          setDayTimer(target.program, target.day.id, {
            elapsedSeconds,
            timerStartedAt: running ? new Date().toISOString() : null,
          }),
        );

        send({ kind: 'session', dayId: target.day.id, elapsedSeconds, timerRunning: running });
      },
      [currentTarget, publish, send],
    ),

    resetTimer: useCallback(() => {
      const target = currentTarget();
      if (!target) return;

      publish(
        setDayTimer(target.program, target.day.id, { elapsedSeconds: 0, timerStartedAt: null }),
      );

      send({ kind: 'session', dayId: target.day.id, elapsedSeconds: 0, timerRunning: false });
    }, [currentTarget, publish, send]),

    toggleCompleted: useCallback(() => {
      const target = currentTarget();
      if (!target) return;

      const { program: current, day } = target;
      const completed = !day.completed;
      let next = setDayCompleted(current, day.id, completed);

      // Finishing the session stops the clock. Left running, it would carry on
      // counting the shower and the walk home as training.
      if (completed && day.timerStartedAt !== null) {
        const elapsedSeconds = Math.min(sessionSeconds(day), MAX_SESSION_SECONDS);
        next = setDayTimer(next, day.id, { elapsedSeconds, timerStartedAt: null });
        send({ kind: 'session', dayId: day.id, elapsedSeconds, timerRunning: false });
      }

      publish(next);

      send({ kind: 'session', dayId: day.id, completed });
    }, [currentTarget, publish, send]),

    resetDay: useCallback(() => {
      mutate(
        (current, dayId) => resetDayIn(current, dayId),
        (_next, dayId) => ({ kind: 'resetSession', dayId }),
      );
    }, [mutate]),
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Names what the server refused, in the user's terms.
 *
 * Vague enough to be true — the queue holds ids, not exercise names — and
 * specific enough to act on: it says which day to go and check.
 */
function describeRejected(operations: readonly PendingOperation[]): string {
  const days = [...new Set(operations.map((operation) => operation.dayId))];
  const count = operations.length;
  const what = count === 1 ? 'Un cambio que hiciste' : `${count} cambios que hiciste`;
  const verb = count === 1 ? 'se ha' : 'se han';

  return (
    `${what} sin conexión ${verb} rechazado al enviarlo y no ${verb} guardado. ` +
    `Revisa ${days.length === 1 ? 'el día' : 'los días'} donde estabas entrenando y vuelve a anotarlo.`
  );
}

function resolveWeek(program: Program | null, selection: Selection | null): Week | null {
  if (!program || program.weeks.length === 0) return null;
  const match = program.weeks.find((week) => week.number === selection?.weekNumber);
  return match ?? program.weeks[0] ?? null;
}

function resolveDay(week: Week | null, selection: Selection | null): Day | null {
  if (!week || week.days.length === 0) return null;
  const match = week.days.find((day) => day.number === selection?.dayNumber);
  return match ?? week.days[0] ?? null;
}

function findExercise(program: Program | null, dayId: string, exerciseId: string) {
  return program?.weeks
    .flatMap((week) => week.days)
    .find((day) => day.id === dayId)
    ?.exercises.find((exercise) => exercise.id === exerciseId);
}

function findSet(program: Program | null, dayId: string, exerciseId: string, index: number) {
  return findExercise(program, dayId, exerciseId)?.currentWeek[index] ?? null;
}

function validateFile(file: File): void {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    throw new TemplateError('Sube un archivo .xlsx (el .xls antiguo no está soportado).');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new TemplateError('El archivo supera el límite de 10 MB.');
  }
  if (file.size === 0) {
    throw new TemplateError('El archivo está vacío.');
  }
}

function toMessage(cause: unknown): string {
  if (cause instanceof TemplateError || cause instanceof ApiError) return cause.message;
  if (cause instanceof Error) return `No se ha podido importar el archivo: ${cause.message}`;
  return 'No se ha podido importar el archivo.';
}
