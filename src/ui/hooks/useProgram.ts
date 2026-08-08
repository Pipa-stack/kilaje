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

import type { Day, Program, Week } from '../../domain/types';
import {
  addSet as addSetTo,
  removeSet as removeSetFrom,
  resetDay as resetDayIn,
  setDayCompleted,
  setDayNotes,
  updateSet as updateSetIn,
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

/** How long to wait after the last keystroke before writing notes to the API. */
const NOTES_DEBOUNCE_MS = 600;

export interface ProgramState {
  program: StoredProgram | null;
  programs: ProgramSummary[];
  week: Week | null;
  day: Day | null;
  loading: boolean;
  importing: boolean;
  error: string | null;
  /** True when the API is unreachable and the cached program is being shown. */
  offline: boolean;

  importFile: (file: File) => Promise<void>;
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
  toggleCompleted: () => void;
  resetDay: () => void;
  reload: () => Promise<void>;
}

export function useProgram(): ProgramState {
  const [program, setProgram] = useState<StoredProgram | null>(null);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [selection, setSelection] = useState<Selection | null>(() => loadSelection());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  /** Latest program state, readable from callbacks without re-subscribing. */
  const latest = useRef<StoredProgram | null>(null);
  latest.current = program;

  // Cache every version of the program we hold, so a reload while offline
  // still has something to show.
  useEffect(() => {
    if (program) cacheProgram(program);
  }, [program]);

  /**
   * Reports a failed write without discarding what the user typed: local
   * state keeps the edit and the cache keeps it across a reload.
   */
  const reportFailure = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.isOffline) {
      setOffline(true);
      return;
    }
    setError(cause instanceof Error ? cause.message : 'No se ha podido guardar el cambio.');
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
      send: (next: StoredProgram, dayId: string) => Promise<void>,
    ) => {
      const current = latest.current;
      if (!current) return;
      const target = resolveDay(resolveWeek(current, selection), selection);
      if (!target) return;

      const next = apply(current, target.id);
      latest.current = next;
      setProgram(next);

      send(next, target.id)
        .then(() => setOffline(false))
        .catch(reportFailure);
    },
    [reportFailure, selection],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fetched, list] = await Promise.all([api.fetchLatestProgram(), api.fetchPrograms()]);
      setProgram(fetched);
      setPrograms(list);
      setOffline(false);
    } catch (cause) {
      // Offline: show the cached program rather than an empty app.
      const cached = loadCachedProgram();
      if (cached) {
        setProgram(cached);
        setOffline(true);
      } else {
        setError(cause instanceof Error ? cause.message : 'No se ha podido cargar el entrenamiento.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  // Notes fire on every keystroke; only the last one needs to reach the API.
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingNotes = useRef<{ dayId: string; notes: string } | null>(null);

  const flushNotes = useCallback(() => {
    const pending = pendingNotes.current;
    if (!pending) return;
    pendingNotes.current = null;
    api
      .updateSession(pending.dayId, { notes: pending.notes })
      .then(() => setOffline(false))
      .catch(reportFailure);
  }, [reportFailure]);

  useEffect(() => {
    const onHide = () => flushNotes();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      flushNotes();
    };
  }, [flushNotes]);

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
    error,
    offline,

    importFile,
    selectProgram,
    deleteProgram,
    reload: load,
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
          async (next, dayId) => {
            const set = findSet(next, dayId, exerciseId, setIndex);
            if (!set) return;
            await api.saveSet(dayId, { exerciseId: Number(exerciseId), setIndex, ...set });
          },
        );
      },
      [mutate],
    ),

    addSet: useCallback(
      (exerciseId: string) => {
        mutate(
          (current, dayId) => addSetTo(current, dayId, exerciseId),
          async (next, dayId) => {
            const exercise = findExercise(next, dayId, exerciseId);
            const index = (exercise?.currentWeek.length ?? 1) - 1;
            const set = exercise?.currentWeek[index];
            // A seeded weight is worth persisting; an empty slot is not.
            if (!set || (set.weight === null && set.reps === null && set.rir === null)) return;
            await api.saveSet(dayId, { exerciseId: Number(exerciseId), setIndex: index, ...set });
          },
        );
      },
      [mutate],
    ),

    removeSet: useCallback(
      (exerciseId: string, setIndex: number) => {
        mutate(
          (current, dayId) => removeSetFrom(current, dayId, exerciseId, setIndex),
          async (next, dayId) => {
            await api.deleteSet(dayId, { exerciseId: Number(exerciseId), setIndex });
            // Removing a slot above the template shifts the ones after it, so
            // the whole exercise is re-sent to keep indexes truthful.
            if (setIndex >= TEMPLATE_SET_COUNT) {
              await resendSets(next, dayId, exerciseId);
            }
          },
        );
      },
      [mutate],
    ),

    updateNotes: useCallback(
      (notes: string) => {
        mutate(
          (current, dayId) => setDayNotes(current, dayId, notes),
          async (_next, dayId) => {
            pendingNotes.current = { dayId, notes };
            if (notesTimer.current) clearTimeout(notesTimer.current);
            notesTimer.current = setTimeout(flushNotes, NOTES_DEBOUNCE_MS);
          },
        );
      },
      [flushNotes, mutate],
    ),

    toggleCompleted: useCallback(() => {
      const current = latest.current;
      const target = resolveDay(resolveWeek(current, selection), selection);
      if (!current || !target) return;
      const completed = !target.completed;

      setProgram(setDayCompleted(current, target.id, completed));
      api
        .updateSession(target.id, { completed })
        .then(() => setOffline(false))
        .catch(reportFailure);
    }, [reportFailure, selection]),

    resetDay: useCallback(() => {
      mutate(
        (current, dayId) => resetDayIn(current, dayId),
        async (_next, dayId) => {
          await api.resetSession(dayId);
        },
      );
    }, [mutate]),
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

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

/** Re-sends every set of an exercise after indexes have shifted. */
async function resendSets(
  program: Program | null,
  dayId: string,
  exerciseId: string,
): Promise<void> {
  const exercise = findExercise(program, dayId, exerciseId);
  if (!exercise) return;

  for (const [index, set] of exercise.currentWeek.entries()) {
    await api.saveSet(dayId, { exerciseId: Number(exerciseId), setIndex: index, ...set });
  }
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
