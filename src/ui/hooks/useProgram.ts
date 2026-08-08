/**
 * The app's single source of state: the program, the current selection, and
 * every way of changing them.
 *
 * All business logic lives in `domain/` and `storage/`; this hook only wires
 * it to React and keeps `localStorage` in sync.
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
import { MAX_FILE_BYTES, TemplateError } from '../../parser/errors';
import {
  clearProgram,
  isStorageAvailable,
  loadProgram,
  loadSelection,
  mergeProgram,
  saveProgram,
  saveSelection,
  type Selection,
} from '../../storage/storage';

/** How long to wait after the last keystroke before writing to storage. */
const SAVE_DEBOUNCE_MS = 300;

export interface ProgramState {
  program: Program | null;
  week: Week | null;
  day: Day | null;
  weekNumber: number | null;
  dayNumber: number | null;
  importing: boolean;
  error: string | null;
  /** Set when the device cannot persist, so the UI can warn once. */
  storageBlocked: boolean;

  importFile: (file: File) => Promise<void>;
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
  discardProgram: () => void;
}

export function useProgram(): ProgramState {
  const [program, setProgram] = useState<Program | null>(() => loadProgram());
  const [selection, setSelection] = useState<Selection | null>(() => loadSelection());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(() => !isStorageAvailable());

  // Debounced persistence: typing a set should not hit storage on every key.
  // `unsaved` always holds the newest state that has not reached storage yet,
  // so no code path can drop the user's last few hundred milliseconds of work.
  const unsaved = useRef<Program | null>(null);

  useEffect(() => {
    if (!program) return;

    unsaved.current = program;
    const timer = setTimeout(() => {
      if (saveProgram(program)) unsaved.current = null;
      else setStorageBlocked(true);
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [program]);

  // Flush on unmount: the pending timer above is cancelled when it runs.
  useEffect(
    () => () => {
      if (unsaved.current) saveProgram(unsaved.current);
    },
    [],
  );

  // A backgrounded phone can be killed without warning, and `pagehide` is the
  // only teardown event Safari reliably fires.
  useEffect(() => {
    const flush = () => {
      if (unsaved.current) saveProgram(unsaved.current);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  const week = useMemo(() => resolveWeek(program, selection), [program, selection]);
  const day = useMemo(() => resolveDay(week, selection), [week, selection]);

  const select = useCallback((next: Selection) => {
    setSelection(next);
    saveSelection(next);
  }, []);

  const importFile = useCallback(
    async (file: File) => {
      setImporting(true);
      setError(null);
      try {
        validateFile(file);
        // SheetJS is ~600 kB; it is only needed when a file is actually
        // imported, so it stays out of the initial bundle.
        const { parseWorkbook } = await import('../../parser/excelParser');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = parseWorkbook(bytes, file.name);
        const merged = mergeProgram(parsed, loadProgram());

        setProgram(merged);
        const first = merged.weeks[0];
        const firstDay = first?.days[0];
        if (first && firstDay) select({ weekNumber: first.number, dayNumber: firstDay.number });
      } catch (cause) {
        setError(toMessage(cause));
      } finally {
        setImporting(false);
      }
    },
    [select],
  );

  const mutateDay = useCallback(
    (mutation: (current: Program, dayId: string) => Program) => {
      setProgram((current) => {
        if (!current) return current;
        const target = resolveDay(resolveWeek(current, selection), selection);
        return target ? mutation(current, target.id) : current;
      });
    },
    [selection],
  );

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
    week,
    day,
    weekNumber: week?.number ?? null,
    dayNumber: day?.number ?? null,
    importing,
    error,
    storageBlocked,

    importFile,
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
        mutateDay((current, dayId) => updateSetIn(current, dayId, exerciseId, setIndex, patch));
      },
      [mutateDay],
    ),

    addSet: useCallback(
      (exerciseId: string) => mutateDay((current, dayId) => addSetTo(current, dayId, exerciseId)),
      [mutateDay],
    ),

    removeSet: useCallback(
      (exerciseId: string, setIndex: number) =>
        mutateDay((current, dayId) => removeSetFrom(current, dayId, exerciseId, setIndex)),
      [mutateDay],
    ),

    updateNotes: useCallback(
      (notes: string) => mutateDay((current, dayId) => setDayNotes(current, dayId, notes)),
      [mutateDay],
    ),

    toggleCompleted: useCallback(() => {
      mutateDay((current, dayId) => {
        const target = current.weeks.flatMap((w) => w.days).find((d) => d.id === dayId);
        return setDayCompleted(current, dayId, !target?.completed);
      });
    }, [mutateDay]),

    resetDay: useCallback(
      () => mutateDay((current, dayId) => resetDayIn(current, dayId)),
      [mutateDay],
    ),

    discardProgram: useCallback(() => {
      clearProgram();
      setProgram(null);
      setSelection(null);
      setError(null);
    }, []),
  };
}

/** The selected week, falling back to the first one. */
function resolveWeek(program: Program | null, selection: Selection | null): Week | null {
  if (!program || program.weeks.length === 0) return null;
  const match = program.weeks.find((week) => week.number === selection?.weekNumber);
  return match ?? program.weeks[0] ?? null;
}

/** The selected day within the week, falling back to the first one. */
function resolveDay(week: Week | null, selection: Selection | null): Day | null {
  if (!week || week.days.length === 0) return null;
  const match = week.days.find((day) => day.number === selection?.dayNumber);
  return match ?? week.days[0] ?? null;
}

const XLSX_EXTENSIONS = ['.xlsx', '.xlsm'];

function validateFile(file: File): void {
  const name = file.name.toLowerCase();
  if (!XLSX_EXTENSIONS.some((extension) => name.endsWith(extension))) {
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
  if (cause instanceof TemplateError) return cause.message;
  if (cause instanceof Error) return `No se ha podido importar el archivo: ${cause.message}`;
  return 'No se ha podido importar el archivo.';
}
